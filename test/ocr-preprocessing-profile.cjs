// Manual, model-free stage profile. Run only with the shared heavy lane granted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { transformSync } = require('esbuild');

const sha = value => createHash('sha256').update(value).digest('hex');
const sourceAt = revision => execFileSync('git', ['show', `${revision}:src/ocr/pipeline.ts`], { encoding: 'utf8' });
const sourcePath = path.resolve('src/ocr/pipeline.ts');
const currentSource = fs.readFileSync(sourcePath, 'utf8');
const reportPath = path.resolve(process.argv[2] || 'test-results/performance/ocr-preprocessing-profile.json');
const report = {
  scope: 'Model-free detectorInput preprocessing only; synthetic fixed RGBA, no decode/inference/App claim',
  pid: process.pid, startedAt: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  runtime: { versions: process.versions, executable: process.execPath, executableSHA: sha(fs.readFileSync(process.execPath)) },
  guardBytes: 1024 ** 3, forcedGC: false, input: {}, variants: [], samples: [], passed: false,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
function receipt() { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
function guard() {
  const memory = process.memoryUsage();
  const highWaterRSS = process.resourceUsage().maxRSS * 1024;
  report.highWaterRSS = Math.max(report.highWaterRSS || 0, highWaterRSS);
  if (Math.max(memory.rss, highWaterRSS) > report.guardBytes) throw Error('Original 1 GiB RSS guard exceeded');
  return { ...memory, highWaterRSS };
}
function compile(name, source) {
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const loaded = new Module(`${sourcePath}.${name}.cjs`, module);
  loaded.filename = `${sourcePath}.${name}.cjs`;
  loaded.paths = module.paths;
  loaded._compile(compiled, loaded.filename);
  report.variants.push({ name, sourceSHA: sha(source), compiledSHA: sha(compiled) });
  return { name, ...loaded.exports };
}
function retire(array) {
  assert.equal(array.byteOffset, 0);
  assert.equal(array.byteLength, array.buffer.byteLength);
  array.buffer.transfer(0);
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
try {
  assert.equal(process.versions.node, '24.22.2', 'Use the pinned Electron-as-Node runtime');
  assert.equal(typeof ArrayBuffer.prototype.transfer, 'function');
  const variants = [compile('original', sourceAt('74805f9')), compile('streaming', sourceAt('6034294')), compile('cached-sampler', currentSource)];
  const image = { width: 1800, height: 2400, data: new Uint8Array(1800 * 2400 * 4) };
  let random = 0x12345678;
  for (let at = 0; at < image.data.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      image.data[at + channel] = random & 255;
    }
    image.data[at + 3] = 255;
  }
  const size = variants[0].detectorSize(image.width, image.height);
  assert.deepEqual(size, { width: 1216, height: 1600 });
  report.input = { width: image.width, height: image.height, bytes: image.data.byteLength, rgbaSHA: sha(image.data), output: size, alpha: 'opaque' };
  report.warmupRounds = 3; report.measuredRounds = 15;
  receipt();
  process.stdout.write(JSON.stringify({ event: 'start', pid: process.pid, source: report.source, reportPath, input: report.input }) + '\n');
  let authority;
  for (let round = -report.warmupRounds; round < report.measuredRounds; round++) {
    for (let slot = 0; slot < variants.length; slot++) {
      const variant = variants[(slot + round + report.warmupRounds) % variants.length];
      const before = guard(), cpu = process.cpuUsage(), start = performance.now();
      const out = variant.detectorInput(image, size, retire);
      const wallMs = performance.now() - start, used = process.cpuUsage(cpu), after = guard();
      try {
        const outputSHA = sha(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
        authority ??= outputSHA;
        assert.equal(outputSHA, authority, `${variant.name} full Float32 output`);
        if (round >= 0) report.samples.push({ round, slot, variant: variant.name, wallMs, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000, outputSHA, before, after });
      } finally { retire(out); }
      guard();
    }
    receipt();
    if (round >= 0 && round % 5 === 4) process.stdout.write(JSON.stringify({ event: 'progress', round: round + 1, rss: process.memoryUsage().rss }) + '\n');
  }
  assert.equal(sha(image.data), report.input.rgbaSHA, 'Borrowed source pixels stay exact');
  const outputBytes = size.width * size.height * 12;
  report.outputSHA = authority;
  report.allocationProof = {
    kind: 'Derived exact Float32 allocations, separately constructor-tracked in focused test; not measured RSS',
    outputBytes, originalPeak: outputBytes * 2, streamingPeak: outputBytes + 12,
    avoidedRGBBytes: outputBytes,
    limit: 'The original owned runtime already retired RGB before inference. This is preprocessing peak/traffic, not an inference live-memory reduction.',
  };
  report.summary = variants.map(({ name }) => {
    const samples = report.samples.filter(row => row.variant === name);
    const walls = samples.map(row => row.wallMs), cpus = samples.map(row => row.cpuUserMs + row.cpuSystemMs);
    return { name, count: samples.length, wallMedianMs: median(walls), wallMinMs: Math.min(...walls), wallMaxMs: Math.max(...walls), cpuMedianMs: median(cpus), maxSampledRSS: Math.max(...samples.flatMap(row => [row.before.rss, row.after.rss])) };
  });
  report.passed = true;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  try { guard(); } catch (error) { report.passed = false; report.error ??= { name: error.name, message: error.message }; process.exitCode = 1; }
  receipt();
  process.stdout.write(JSON.stringify({ event: 'complete', passed: report.passed, summary: report.summary, highWaterRSS: report.highWaterRSS, error: report.error }) + '\n');
}
