#!/usr/bin/env node
'use strict';
// Read-only evidence extraction, or a test-only observer around an existing driver.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const argv = process.argv.slice(2), option = name => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1]; };
const repo = path.resolve(option('--repo') || path.join(__dirname, '..'));
if (option('--probe-sheet')) {
  void sheetProbe(Number(option('--probe-sheet'))).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
} else if (option('--trace-driver')) {
  const driver = path.resolve(repo, option('--trace-driver')), sourceRoot = path.resolve(option('--source-root') || path.join(repo, 'src'));
  const out = path.resolve(option('--out') || path.join(repo, 'test-results/performance-0.37/stage-observer'));
  if (!driver.startsWith(repo + path.sep) || !/\.cjs$/.test(driver)) throw Error('Driver must be a CJS file within the explicit NoteMind checkout.');
  fs.mkdirSync(out, { recursive: true });
  process.env.NOTEMIND_STAGE_TRACE_ROOT = sourceRoot; process.env.NOTEMIND_STAGE_TRACE_OUT = out;
  const head = require('node:child_process').execFileSync('git', ['-C', path.dirname(sourceRoot), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  process.env.NOTEMIND_STAGE_TRACE_HEAD = head;
  const helper = path.resolve(__dirname, '../test/helpers/pipeline-stage-metrics.cjs');
  fs.writeFileSync(path.join(out, 'observer-receipt.json'), JSON.stringify({ sourceRoot, sourceHead: head, driver, driverSHA: sha(fs.readFileSync(driver)), helper, helperSHA: sha(fs.readFileSync(helper)), runtime: process.versions, installedAppTouched: false, scope: 'Observed diagnostic; does not replace the existing uninstrumented acceptance driver or its guards.', unknownCoverage: true }, null, 2));
  require(helper).bootstrapFromEnvironment();
  const separator = argv.indexOf('--');
  process.argv = [process.execPath, driver, ...(separator < 0 ? [] : argv.slice(separator + 1))]; require(driver);
} else {
  const files = [
    'test-results/performance/drawing-stages-100000.json',
    'test-results/performance/sheet-delta-profile-100000.json',
    'test-results/performance/save-stages-before.json',
    'test-results/performance/save-stages-owned.json',
    'test-results/performance/save-stages-worker-cas.json',
    'test-results/performance/sparse-save-pair-c033df2-f7a18a6/comparison.json',
    'test-results/performance/sparse-save-pair-c033df2-f7a18a6/metadata-comparison.json',
    'test-results/performance/image-index-7527e5f-comparison.json',
    'test-results/performance/ocr-preprocessing-b58b5ab.json',
    'test-results/performance-0.37/real-raster-audit-web-full-mixed-8fa9d856.json',
    'test-results/performance-0.37/word-reference-images-c5c063bf.json',
    'test-results/performance-0.37/word-reference-table-d6aa102b.json',
    'test-results/performance-0.37/ocr-baseline.json',
    'test-results/performance-0.37/ocr-after.json',
  ];
  const report = { schema: 'notemind-existing-stage-evidence-v1', generatedAt: new Date().toISOString(), root: repo, coverage: 'Historical/inclusive observed values only. No complete final integrated per-stage top-three bottleneck ranking.', artifacts: [] };
  const top = (rows, field) => [...rows].sort((a, b) => (b[field] || 0) - (a[field] || 0)).slice(0, 3);
  function grouped(rows, key, field) {
    const groups = new Map(); for (const row of rows || []) { const label = row[key]; if (typeof label !== 'string' || !Number.isFinite(row[field])) continue; const value = groups.get(label) || { name: label, inclusiveWallMs: 0, calls: 0, maxMs: 0 }; value.inclusiveWallMs += row[field]; value.calls++; value.maxMs = Math.max(value.maxMs, row[field]); groups.set(label, value); }
    return [...groups.values()].sort((a, b) => b.inclusiveWallMs - a.inclusiveWallMs);
  }
  for (const relative of files) {
    const filename = path.join(repo, relative); if (!fs.existsSync(filename)) { report.artifacts.push({ file: relative, missing: true }); continue; }
    const bytes = fs.readFileSync(filename), value = JSON.parse(bytes), item = { file: relative, sha256: sha(bytes), sourceHead: value.sourceHead || value.source || null, runtime: value.runtime || (value.node ? { node: value.node, electron: value.electron || null } : null) };
    if (relative.includes('/drawing-stages-')) item.observedOperations = value.stages.map(row => ({ strokes: row.strokes, points: row.points, largestObserved: top(Object.entries(row).filter(([, data]) => Number.isFinite(data?.meanMs)).map(([name, data]) => ({ name, ...data })), 'meanMs') }));
    else if (relative.includes('/sheet-delta-')) item.observedStages = top(Object.entries(value.stages).map(([name, data]) => ({ name, ...data })), 'ms');
    else if (relative.includes('/save-stages-')) item.overlappingSaveWrappers = value.map(row => ({ assetMiB: row.assetMiB, samples: row.samples, observedInclusiveWrappers: grouped(row.stages, 'stage', 'ms').slice(0, 8), warning: 'Nested wrappers have no interval coordinates; do not sum or interpret as exclusive self-time.' }));
    else if (relative.includes('comparison.json')) item.pairedStageValues = value;
    else if (relative.includes('real-raster-audit')) {
      item.ok = value.ok; item.error = value.error?.split('\n')[0]; item.phaseCount = value.phases.length; item.metrics = value.metrics;
      item.largestObservedPhases = top(value.phases.map(({ name, wallMs, value: result }) => ({ name, wallMs, driverValue: result })), 'wallMs');
      item.archiveCallGroups = grouped(value.archiveStages, 'method', 'wallMs'); item.IPCCallGroups = grouped(value.traffic, 'channel', 'wallMs');
      const peak = top(value.memory, 'combinedWorkingSetBytes')[0]; item.peakSample = peak && { phase: peak.phase, at: peak.at, combinedWorkingSetBytes: peak.combinedWorkingSetBytes, processes: peak.processes };
      item.ocrLifecycle = value.ocrLifecycle?.totals; item.indexOperationResults = value.indexOperationResults;
      item.warning = 'Failed first OCR inference. Unobserved OCR tail and internal costs preclude complete ranking. Display waits/frame observers are included in phases.';
    } else if (relative.includes('/word-reference-')) {
      item.ok = value.ok; item.scope = value.scope; item.phaseCount = value.phases.length; item.peakCombined = value.peakCombined;
      item.largestObservedPhases = top(value.phases, 'ms'); item.trafficGroups = grouped(value.traffic, 'channel', 'ms');
      item.warning = 'UI phases include driver waits and independent pixel-oracle lifetimes; traffic is inclusive and may overlap. Parser/IO/layout self-time is not recorded.';
    } else if (value.rows) item.rows = value.rows;
    else { item.summary = value.summary || null; item.scope = value.scope || null; item.passed = value.passed ?? value.ok ?? null; }
    report.artifacts.push(item);
  }
  const traceDirectory = option('--trace-dir');
  if (traceDirectory) {
    report.observedTraces = fs.readdirSync(traceDirectory).filter(name => /^stage-[0-9]+-thread-[0-9]+\.json$/.test(name)).map(name => {
      const filename = path.resolve(traceDirectory, name), bytes = fs.readFileSync(filename), value = JSON.parse(bytes);
      return { file: filename, sha256: sha(bytes), sourceHead: value.sourceHead, clockScope: value.clockScope, finalProcessExitFlush: value.finalProcessExitFlush, coverage: value.coverage, largestObservedExclusive: top(value.groups, 'exclusiveObservedWallMs'), missingSeams: value.missingSeams, unobservedTargetModules: value.unobservedTargetModules, observerWrites: value.observerWrites, observerFlushWallMs: value.observerFlushWallMs };
    });
  }
  const destination = option('--out');
  if (destination) { fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2)); }
  process.stdout.write(JSON.stringify({ artifacts: report.artifacts.length, missing: report.artifacts.filter(row => row.missing).map(row => row.file), observedTraces: report.observedTraces?.length || 0, output: destination || null, coverage: report.coverage }) + '\n');
}

async function sheetProbe(count) {
  if (!Number.isSafeInteger(count) || count < 100 || count > 2000000) throw Error('Sheet count must be100–2000000.');
  const os = require('node:os'), fsp = require('node:fs/promises'), { performance } = require('node:perf_hooks');
  const sourceRoot = path.resolve(option('--source-root') || path.join(repo, 'src'));
  const out = path.resolve(option('--out') || path.join(repo, 'test-results/performance-0.37/stage-sheet'));
  fs.mkdirSync(out, { recursive: true });
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'notemind-stage-sheet-')), file = path.join(directory, 'sheets.json');
  const fixtureHelper = path.resolve(path.dirname(sourceRoot), 'test/helpers/sheet-native-fixture.cjs');
  const { SheetPersistence } = require(path.join(sourceRoot, 'sheet-persistence.cjs')), { spawn, execFileSync } = require('node:child_process');
  const pageId = '10000000-0000-0000-0000-000000000001', report = { schema: 'notemind-sheet-stage-probe-v1', count, shape: 'Exact existing sheet-native-fixture.cjs: repeated one-point#123456strokes at(.5,.5), distinct occurrence identities. Storage-only, not distinct-grid/App/paint acceptance.', sourceRoot, sourceHead: execFileSync('git', ['-C', path.dirname(sourceRoot), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixtureHelper: { file: fixtureHelper, sha256: sha(fs.readFileSync(fixtureHelper)) }, runtime: process.versions, guardBytes: 1024 ** 3, setupMs: 0, stages: [], peakSampledProcessRSS: 0, peakSampledOwnedRSS: 0, ok: false };
  let service, fixtureChild, guardFailure, lastBeat = performance.now(), maxTimerGapMs = 0;
  const sample = () => {
    const rss = process.memoryUsage().rss; let childRSS = 0;
    if (fixtureChild?.pid && fixtureChild.exitCode === null) try { childRSS = Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(fixtureChild.pid)], { encoding: 'utf8' }).trim()) * 1024; } catch (error) { if (error.status !== 1) guardFailure ||= Error('Owned fixture process could not be supervised.'); }
    const combined = rss + childRSS; report.peakSampledProcessRSS = Math.max(report.peakSampledProcessRSS, rss); report.peakSampledOwnedRSS = Math.max(report.peakSampledOwnedRSS, combined); maxTimerGapMs = Math.max(maxTimerGapMs, performance.now() - lastBeat); lastBeat = performance.now();
    if (combined > report.guardBytes) guardFailure ||= Error('Unchanged1GiB whole owned PID group RSS guard exceeded.');
    if (guardFailure) { fixtureChild?.kill('SIGTERM'); void service?.dispose().catch(() => {}); }
  };
  const timer = setInterval(sample, 25);
  try {
    const space = await fsp.statfs(directory); if (space.bavail * space.bsize - count * 256 < 2 * 1024 ** 3) throw Error('Original2GiB disk floor plus bounded fixture workspace unavailable.');
    const setup = performance.now(), childEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['NOTEMIND_STAGE_TRACE_ROOT', 'NOTEMIND_STAGE_TRACE_OUT', 'NOTEMIND_STAGE_TRACE_HEAD']) delete childEnvironment[name];
    report.expected = await new Promise((resolve, reject) => {
      const child = fixtureChild = spawn(process.execPath, ['--max-old-space-size=224', fixtureHelper, file, String(count)], { env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
      report.fixtureProcess = { pid: child.pid, actualExit: false, sameOriginalHeapFlagMiB: 224 };
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
      child.once('error', reject); child.once('exit', (code, signal) => { report.fixtureProcess.actualExit = true; report.fixtureProcess.code = code; report.fixtureProcess.signal = signal; fixtureChild = null; if (guardFailure) reject(guardFailure); else if (code) reject(Error('Original fixture failed: ' + stderr)); else try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); } });
    });
    report.setupMs = performance.now() - setup; sample(); if (guardFailure) throw guardFailure;
    process.env.NOTEMIND_STAGE_TRACE_ROOT = sourceRoot; process.env.NOTEMIND_STAGE_TRACE_OUT = out; process.env.NOTEMIND_STAGE_TRACE_HEAD = report.sourceHead;
    const probe = require('../test/helpers/pipeline-stage-metrics.cjs').bootstrapFromEnvironment();
    require(path.join(sourceRoot, 'sheet-persistence.cjs')); // Observe cached prototype seams after setup, before new workers.
    report.observedWorkers = [];
    service = new SheetPersistence(file, { timeout: 120000, workerFactory(entry, options) {
      const worker = new (require('node:worker_threads').Worker)(entry, options), row = { threadId: worker.threadId, exited: false };
      report.observedWorkers.push(row); worker.once('exit', code => { row.exited = true; row.exitCode = code; }); return worker;
    } }); service.scheduleMaintenance = () => {};
    async function measured(name, run) { maxTimerGapMs = 0; lastBeat = performance.now(); const start = performance.now(), cpu = process.cpuUsage(); const result = await probe.metrics.span(`pipeline:${name}`, run); sample(); const used = process.cpuUsage(cpu); report.stages.push({ name, wallMs: performance.now() - start, maxTimerGapMs, processCpuMs: (used.user + used.system) / 1000, includesWorkerThreadsCPU: true }); if (guardFailure) throw guardFailure; return result; }
    const catalog = await measured('catalog', () => service.listPages());
    const packet = await measured('load-page', () => service.loadPage(pageId));
    const raw = packet.encodedSheets[0], offset = 24 + new DataView(raw.bytes.buffer, raw.bytes.byteOffset, raw.bytes.byteLength).getUint32(8, true);
    report.exactLoadedBytes = sha(raw.bytes.subarray(offset)) === report.expected.geometryBody && sha(raw.identityBytes) === report.expected.identity; if (!report.exactLoadedBytes) throw Error('Original fixture geometry/identity bytes changed.');
    raw.bytes.buffer.transfer(0); raw.identityBytes.buffer.transfer(0);
    const current = catalog.pages[0]; await measured('metadata-save', () => service.saveMetadata({ requestId: crypto.randomUUID(), session: catalog.session, baseVersion: catalog.version, pages: [{ pageId, metadata: { ...current.metadata, name: 'Renamed original fixture' }, geometryRevision: current.geometryRevision }], deletedPageIds: [] }));
    await measured('close-worker', () => service.dispose()); service = null;
    if (!report.observedWorkers.length || report.observedWorkers.some(row => !row.exited)) throw Error('Owned storage worker actual exit missing.');
    report.metrics = probe.snapshot(); report.ok = true; probe.flush();
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    clearInterval(timer); const child = fixtureChild;
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    try { await service?.dispose(); } catch (error) { report.cleanupError = error.stack; report.ok = false; }
    try { await fsp.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch (error) { report.cleanupError ||= error.stack; report.ok = false; }
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, 'sheet-probe.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify({ ok: report.ok, count, stages: report.stages, peakSampledProcessRSS: report.peakSampledProcessRSS, peakSampledOwnedRSS: report.peakSampledOwnedRSS, out, error: report.error, cleanupError: report.cleanupError }) + '\n');
    if (!report.ok) process.exitCode = 1;
  }
}
