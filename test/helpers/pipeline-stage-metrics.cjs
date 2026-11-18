// Test-only CJS observer. Clock scopes and unknown coverage are deliberately explicit.
'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const { threadId } = require('node:worker_threads');

function unionDuration(intervals, begin, end) {
  const sorted = intervals.map(([a, b]) => [Math.max(begin, a), Math.min(end, b)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, last = begin;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(last, a)); last = Math.max(last, b); }
  return total;
}
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
};

function createStageMetrics({ clock = () => performance.now(), cpu = () => process.cpuUsage(), maxEvents = 20000, clockScope = `${process.pid}:${threadId}:${performance.timeOrigin}` } = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw Error('Invalid event bound.');
  const storage = new AsyncLocalStorage(), events = [], counters = new Map();
  let next = 0, dropped = 0, rootFinished = null;
  function span(name, run, metadata = {}) {
    if (typeof name !== 'string' || !name || typeof run !== 'function') throw Error('Invalid span.');
    if (events.length >= maxEvents) { dropped++; return run(); }
    const parent = storage.getStore(), event = { id: ++next, parent: parent?.id ?? null, name, start: clock(), cpuStart: cpu(), metadata, children: [], status: 'running' };
    events.push(event);
    const finish = status => {
      if (event.status !== 'running') return;
      event.end = clock(); event.status = status;
      const used = cpu(); event.processCpuUserMs = (used.user - event.cpuStart.user) / 1000; event.processCpuSystemMs = (used.system - event.cpuStart.system) / 1000;
      if (parent) parent.children.push([event.start, event.end]);
      else rootFinished?.();
    };
    return storage.run(event, () => {
      try {
        const result = run();
        if (result && typeof result.then === 'function') return result.then(value => { finish('fulfilled'); return value; }, error => { finish('rejected'); throw error; });
        finish('fulfilled'); return result;
      } catch (error) { finish('thrown'); throw error; }
    });
  }
  function count(name, amount = 1, unit = 'count') {
    if (!Number.isFinite(amount) || amount < 0) throw Error('Invalid counter.');
    const key = `${name}\0${unit}`, current = counters.get(key) || { name, unit, value: 0 };
    current.value += amount; counters.set(key, current);
  }
  function snapshot({ coverage = {}, includeEvents = false } = {}) {
    const observed = events.filter(event => event.end !== undefined), rows = new Map();
    for (const event of observed) {
      const wall = event.end - event.start, exclusive = Math.max(0, wall - unionDuration(event.children, event.start, event.end));
      const row = rows.get(event.name) || { name: event.name, count: 0, inclusiveWallMs: 0, exclusiveObservedWallMs: 0, processCpuUserMs: 0, processCpuSystemMs: 0, outcomes: {}, samples: [] };
      row.count++; row.inclusiveWallMs += wall; row.exclusiveObservedWallMs += exclusive;
      row.processCpuUserMs += event.processCpuUserMs; row.processCpuSystemMs += event.processCpuSystemMs;
      row.outcomes[event.status] = (row.outcomes[event.status] || 0) + 1; row.samples.push(wall); rows.set(event.name, row);
    }
    const grouped = [...rows.values()].map(({ samples, ...row }) => ({ ...row, inclusiveMedianMs: quantile(samples, .5), inclusiveP95Ms: quantile(samples, .95), inclusiveMaxMs: Math.max(...samples) }));
    const active = events.filter(event => event.end === undefined).map(({ id, name, parent, start }) => ({ id, name, parent, start }));
    const expected = Array.isArray(coverage.expectedCandidates) ? [...new Set(coverage.expectedCandidates)] : [], missing = expected.filter(name => !rows.has(name));
    const complete = coverage.status === 'complete' && typeof coverage.proof === 'string' && coverage.proof.trim().length > 0 && expected.length >= 3 && !missing.length && !active.length && !dropped;
    const ranking = complete ? grouped.filter(row => expected.includes(row.name)).sort((a, b) => b.exclusiveObservedWallMs - a.exclusiveObservedWallMs).slice(0, 3) : null;
    return {
      schema: 'notemind-stage-metrics-v1', clockScope, clockUnit: 'monotonic milliseconds', pid: process.pid, threadId,
      semantics: { inclusive: 'Elapsed wall includes waits and instrumented descendants.', exclusive: 'Elapsed wall minus union of directly observed child intervals in this clock scope; uninstrumented descendants remain attributed to caller. Concurrent sibling totals may overlap and are never a pipeline total.', cpu: 'Process-wide CPU deltas include other threads and concurrent spans; not self CPU, not added across nested spans or worker reports.', io: 'No inferred IO bytes. Only explicit counters report their stated unit.', gaps: 'Timer/frame gaps remain the existing workload driver measurements.', observer: 'Promise wrappers, AsyncLocalStorage, per-call clocks/CPU and bounded retained events change timing; repeat unobserved acceptance separately.' },
      coverage: { ...coverage, status: complete ? 'complete-by-explicit-proof' : 'unknown-or-incomplete', missingCandidates: missing, droppedEvents: dropped, unfinishedEvents: active },
      groups: grouped, counters: [...counters.values()], ranking,
      ...(includeEvents ? { events: observed.map(({ cpuStart, children, ...event }) => ({ ...event, childUnionMs: unionDuration(children, event.start, event.end) })) } : {}),
    };
  }
  return { span, count, snapshot, hasActiveSpan: () => !!storage.getStore(), onRootFinished(run) { rootFinished = run; } };
}

// Coarse public seams avoid one retained event per stroke/row/chunk. These are
// observed boundaries, not a declaration that all internal costs are covered.
const CJS_TARGETS = {
  'archive-codec.cjs': { ArchiveCodec: ['decode', 'encode', 'encodeFile', 'encodeWithDigest', 'inspectFile', 'publishVersion', 'publishVersionFromFile', 'exportWordFile', 'importWordFile', 'parseJson', 'stringifyJson', 'prepareSnapshot'] },
  'notepad-format.cjs': { $exports: ['encode', 'decode', 'encodeDrawingOwned'] },
  'notepad-file.cjs': { $exports: ['writeNotepadFile'] },
  'archive-version-source.cjs': { $exports: ['publishVersionFromFile'] },
  'version-publisher.cjs': { $exports: ['publishVersion'] },
  'guarded-write.cjs': { $exports: ['replaceIfUnchanged', 'fingerprintFile'] },
  'document-io.cjs': { $exports: ['convertImage', 'convertImageFile', 'convertIndexImageFile', 'importFile', 'exportFile'] },
  'document-asset-sessions.cjs': { DocumentAssetSessions: ['acquireRequest', 'runDocument', 'loadDocument', 'perform', 'dispose'] },
  'document-file-input.cjs': { $exports: ['withVerifiedFileInput', 'withVerifiedPDFFileInput'] },
  'document-worker-bytes.cjs': { $exports: ['executeBytes', 'withInput'] },
  'image-index-source.cjs': { $exports: ['prepareIndexSources'] },
  'image-index-working.cjs': { $exports: ['waitWorking'] },
  'ocr.cjs': { TextReader: ['read', 'readPixels', 'enqueue', 'awaitStopped', 'dispose'] },
  'ocr-asset.cjs': { $exports: ['readAsset'] },
  'notes-store.cjs': { NotesStore: ['draft', 'version', 'register', 'recordCommitIntent', 'committed'] },
  'sheet-persistence.cjs': { SheetPersistence: ['initialize', 'loadPage', 'loadStateCompact', 'saveDelta', 'saveMetadata', 'prepared', 'retryDurability', 'dispose'] },
  'sheet-store.cjs': { SheetStore: ['initialize', 'loadPage', 'compact', 'prepareDelta', 'prepareMetadata', 'commit', 'dispose'] },
  'sheet-geometry.cjs': { GeometryReader: ['compact'], $exports: ['publishStrokes', 'publishEncoded'] },
  'sheet-pack-store.cjs': { SheetPackStore: ['sync'] },
  'word-import-file.cjs': { $exports: ['importWordFile'] },
  'word-import-stream.cjs': { $exports: ['streamWordDocument'] },
  'word-import-source.cjs': { WordImportSource: ['open', 'directory', 'prime', 'readOwned', 'revision', 'close'] },
  'word-preview-builder.cjs': { $exports: ['buildWordPreview', 'materializePreviewAsset'] },
  'word-preview-html.cjs': { PreviewHTML: ['flush', 'finish'] },
  'word-preview-budget-files.cjs': { PreviewBudgetFiles: ['close'] },
  'word-export-media.cjs': { $exports: ['exportWordWithMedia', 'captureWordDocument', 'spoolImageInput', 'acquireImageWorking'] },
  'word-stream-package.cjs': { $exports: ['wordStreamPackage'] },
  'pdf-reference-export.cjs': { $exports: ['annotatePDF'] },
  'scan-pdf.cjs': { $exports: ['assemble'] },
  'pdf-page-import.cjs': { PageImportController: ['start', 'run', 'usableText', 'chargeText', 'dispose'] },
  'pdf-index-reader.cjs': { PDFIndexReader: ['read', 'run', 'dispose'] },
};

function installCJSStageProbe({ sourceRoot, metrics = createStageMetrics() } = {}) {
  const Module = require('node:module'), fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
  sourceRoot = path.resolve(sourceRoot); const previous = Module._load, seen = new Set(), receipts = [], missing = [], restorations = [];
  function wrap(object, key, label) {
    if (typeof object?.[key] !== 'function') { missing.push(label); return; }
    const original = object[key];
    if (original.constructor?.name === 'AsyncGeneratorFunction' || original.constructor?.name === 'GeneratorFunction') { missing.push(`${label}:iterator-not-observed`); return; }
    const replacement = function (...args) { return metrics.span(label, () => original.apply(this, args)); };
    object[key] = replacement; restorations.push(() => { if (object[key] === replacement) object[key] = original; });
  }
  const installedLoad = function (request, parent, isMain) {
    const value = previous.apply(this, arguments); let filename;
    try { filename = Module._resolveFilename(request, parent, isMain); } catch { return value; }
    if (typeof filename !== 'string' || path.dirname(filename) !== sourceRoot || seen.has(filename)) return value;
    const basename = path.basename(filename), spec = CJS_TARGETS[basename]; if (!spec) return value; seen.add(filename);
    const bytes = fs.readFileSync(filename); receipts.push({ file: filename, sha256: createHash('sha256').update(bytes).digest('hex') });
    for (const [owner, methods] of Object.entries(spec)) for (const method of methods) {
      if (owner === '$exports') wrap(value, method, `${basename}:${method}`);
      else {
        const kind = value[owner], object = typeof kind?.[method] === 'function' ? kind : kind?.prototype;
        wrap(object, method, `${basename}:${owner}.${method}`);
      }
    }
    return value;
  };
  Module._load = installedLoad;
  return { metrics, receipts, missing, restore() { if (Module._load === installedLoad) Module._load = previous; for (const restore of restorations.reverse()) restore(); }, snapshot(options) {
    const result = metrics.snapshot(options);
    if (missing.length || result.counters.some(row => row.name === 'unobserved-worker-entry' && row.value > 0)) { result.ranking = null; result.coverage.status = 'unknown-or-incomplete'; }
    return { ...result, sourceRoot, sourceFiles: receipts, missingSeams: missing, unobservedTargetModules: Object.keys(CJS_TARGETS).filter(name => !receipts.some(item => path.basename(item.file) === name)) };
  } };
}

function bootstrapFromEnvironment() {
  if (!process.env.NOTEMIND_STAGE_TRACE_ROOT || !process.env.NOTEMIND_STAGE_TRACE_OUT || globalThis.__noteMindStageProbe) return globalThis.__noteMindStageProbe;
  const fs = require('node:fs'), path = require('node:path'), workers = require('node:worker_threads');
  const probe = installCJSStageProbe({ sourceRoot: process.env.NOTEMIND_STAGE_TRACE_ROOT }); globalThis.__noteMindStageProbe = probe;
  if (threadId !== 0) installWorkerInternals(probe.metrics);
  const directory = path.resolve(process.env.NOTEMIND_STAGE_TRACE_OUT); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `stage-${process.pid}-thread-${threadId}.json`); let flushing = false, writes = 0, flushWallMs = 0; const observerErrors = [];
  function flush(final = false) {
    if (flushing) return; flushing = true; const begin = performance.now();
    try { const report = { ...probe.snapshot(), finalProcessExitFlush: final, runtime: process.versions, sourceHead: process.env.NOTEMIND_STAGE_TRACE_HEAD || null, observerWrites: writes + 1, observerFlushWallMs: flushWallMs, observerCostDefinition: 'Wall time of previously completed flushes only; excludes this flush and per-call/AsyncLocalStorage CPU overhead.', observerErrors, generatedAt: new Date().toISOString() }; fs.writeFileSync(file + '.tmp', JSON.stringify(report)); fs.renameSync(file + '.tmp', file); writes++; } catch (error) { observerErrors.push({ message: error.message, code: error.code }); } finally { flushWallMs += performance.now() - begin; flushing = false; }
  }
  const timer = setInterval(() => flush(), 1000); timer.unref(); process.once('exit', () => { clearInterval(timer); flush(true); });
  if (threadId !== 0) probe.metrics.onRootFinished(() => flush());
  // This changes only test-host worker bootstraps. Existing worker options, data,
  // thread limits and lifetime decisions are preserved. ESM is explicitly skipped.
  const OriginalWorker = workers.Worker;
  workers.Worker = class StageObservedWorker extends OriginalWorker {
    constructor(entry, options = {}) {
      const commonJS = options.type !== 'module' && (options.eval || typeof entry === 'string' && /\.cjs$/.test(entry));
      if (!commonJS) { probe.metrics.count('unobserved-worker-entry', 1); super(entry, options); return; }
      const preload = `require(${JSON.stringify(__filename)});`, source = options.eval ? preload + '\n' + entry : preload + '\nrequire(' + JSON.stringify(path.resolve(entry)) + ');';
      super(source, { ...options, eval: true });
    }
  };
  probe.flush = flush; probe.reportFile = file; return probe;
}

module.exports = { unionDuration, createStageMetrics, installCJSStageProbe, bootstrapFromEnvironment, CJS_TARGETS };
bootstrapFromEnvironment();

function installWorkerInternals(metrics) {
  const { parentPort } = require('node:worker_threads'), fs = require('node:fs/promises');
  // Only the source archive dispatcher's named callback is wrapped. Arbitrary
  // event listeners and ESM OCR workers keep their original registration path.
  const originalOn = parentPort.on;
  parentPort.on = function (event, listener) {
    if (event === 'message' && listener.name === 'handlePacket') {
      const original = listener;
      listener = function (packet) { const operation = typeof packet?.op === 'string' ? packet.op : 'unknown'; return metrics.span(`archive-worker:${operation}`, () => original.call(this, packet)); };
    }
    return originalOn.call(this, event, listener);
  };
  for (const name of ['parse', 'stringify']) {
    const original = JSON[name];
    JSON[name] = function (...args) { return metrics.hasActiveSpan() ? metrics.span(`builtin:JSON.${name}`, () => original.apply(this, args)) : original.apply(this, args); };
  }
  const open = fs.open, handles = new WeakSet();
  fs.open = function (...args) {
    const active = metrics.hasActiveSpan(), pending = active ? metrics.span('io:open', () => open.apply(this, args)) : open.apply(this, args);
    return pending.then(handle => {
      if (handles.has(handle)) return handle; handles.add(handle);
      for (const name of ['read', 'write', 'sync', 'datasync', 'stat', 'close']) {
        const original = handle[name]; if (typeof original !== 'function') continue;
        handle[name] = function (...values) {
          if (!metrics.hasActiveSpan()) return original.apply(this, values);
          return metrics.span(`io:FileHandle.${name}`, () => Promise.resolve(original.apply(this, values)).then(result => {
            if (Number.isSafeInteger(result?.bytesRead)) metrics.count('file-read', result.bytesRead, 'bytes');
            if (Number.isSafeInteger(result?.bytesWritten)) metrics.count('file-write', result.bytesWritten, 'bytes');
            return result;
          }));
        };
      }
      return handle;
    });
  };
}
