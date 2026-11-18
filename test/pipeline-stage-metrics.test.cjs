'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { unionDuration, createStageMetrics, installCJSStageProbe } = require('./helpers/pipeline-stage-metrics.cjs');

test('exclusive wall subtracts clipped child interval union once', () => {
  assert.equal(unionDuration([[1, 7], [3, 9], [-4, 2], [12, 15]], 0, 10), 9);
  let now = 0; const metrics = createStageMetrics({ clock: () => now, cpu: () => ({ user: 0, system: 0 }) });
  metrics.span('outer', () => { now = 1; metrics.span('inner', () => { now = 7; }); now = 10; });
  const report = metrics.snapshot();
  assert.equal(report.groups.find(row => row.name === 'outer').exclusiveObservedWallMs, 4);
  assert.equal(report.ranking, null);
});
test('parallel children retain their shared parent and overlapping wall is not double subtracted', async () => {
  let now = 0, doneA, doneB; const metrics = createStageMetrics({ clock: () => now, cpu: () => ({ user: 0, system: 0 }) });
  const outer = metrics.span('outer', async () => {
    now = 1; const a = metrics.span('a', () => new Promise(resolve => doneA = resolve));
    now = 3; const b = metrics.span('b', () => new Promise(resolve => doneB = resolve));
    now = 7; doneA(); await a; now = 9; doneB(); await b; now = 10;
  });
  await outer;
  assert.equal(metrics.snapshot().groups.find(row => row.name === 'outer').exclusiveObservedWallMs, 2);
});
test('ranking requires explicit complete coverage proof, candidate presence and finished spans', () => {
  let now = 0; const metrics = createStageMetrics({ clock: () => now, cpu: () => ({ user: 0, system: 0 }) });
  for (const [name, duration] of [['a', 1], ['b', 4], ['c', 2]]) metrics.span(name, () => { now += duration; });
  const coverage = { status: 'complete', proof: 'All three isolated sibling operations entered and completed; no hidden candidate is in this scoped comparison.', expectedCandidates: ['a', 'b', 'c'] };
  assert.deepEqual(metrics.snapshot({ coverage }).ranking.map(row => row.name), ['b', 'c', 'a']);
  assert.equal(metrics.snapshot({ coverage: { ...coverage, proof: '' } }).ranking, null);
  assert.equal(metrics.snapshot({ coverage: { ...coverage, expectedCandidates: ['a', 'b', 'missing'] } }).ranking, null);
});
test('observer bounds, rejection and synchronous return semantics remain explicit', async () => {
  const metrics = createStageMetrics({ maxEvents: 2 });
  const value = {}; assert.equal(metrics.span('sync', () => value), value);
  const failure = Error('expected'); await assert.rejects(metrics.span('reject', () => Promise.reject(failure)), error => error === failure);
  assert.equal(metrics.span('dropped', () => 12), 12);
  assert.equal(metrics.snapshot().coverage.droppedEvents, 1);
  assert.equal(metrics.snapshot().groups.find(row => row.name === 'reject').outcomes.rejected, 1);
});
test('CJS probe instruments an exact allowed source file and restores it', async () => {
  const path = require('node:path'), sourceRoot = path.resolve(__dirname, '../src');
  const probe = installCJSStageProbe({ sourceRoot });
  const { ArchiveCodec } = require('../src/archive-codec.cjs');
  try {
    const codec = new ArchiveCodec({ workerFactory() { throw Error('expected-no-worker'); } });
    assert.equal(probe.receipts.some(row => row.file.endsWith('/archive-codec.cjs')), true);
    assert.equal(typeof ArchiveCodec.prototype.encode, 'function');
    await assert.rejects(codec.encode({ text: 'probe', assets: {} }), /expected-no-worker/);
    assert.equal(probe.snapshot().groups.some(row => row.name === 'archive-codec.cjs:ArchiveCodec.encode'), true);
  } finally { probe.restore(); }
});
test('isolated observer preserves Worker data and reports real JSON/held-file IO with actual exit', async () => {
  const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'notemind-stage-observer-test-'));
  try {
    const input = path.join(directory, 'input'); await fsp.writeFile(input, 'exact');
    const helper = require.resolve('./helpers/pipeline-stage-metrics.cjs');
    const source = `require(${JSON.stringify(helper)});const{Worker}=require('node:worker_threads');const worker=new Worker("const{parentPort,workerData}=require('node:worker_threads');parentPort.on('message',async function handlePacket(packet){const value=JSON.parse('{\\\"ok\\\":true}');const handle=await require('node:fs/promises').open(workerData.input,'r');const bytes=Buffer.alloc(5);await handle.read(bytes,0,5,0);await handle.close();parentPort.postMessage({marker:workerData.marker,text:bytes.toString(),ok:value.ok});parentPort.close();});",{eval:true,workerData:{input:${JSON.stringify(input)},marker:'preserved'}});worker.once('message',value=>{if(value.marker!=='preserved'||value.text!=='exact'||!value.ok)throw Error('Worker changed');});worker.once('error',error=>{throw error});worker.once('exit',code=>{if(code)throw Error('Worker exit'+code);});worker.postMessage({op:'focused-test'});`;
    await promisify(execFile)(process.execPath, ['-e', source], { timeout: 10000, env: { ...process.env, NOTEMIND_STAGE_TRACE_ROOT: path.resolve(__dirname, '../src'), NOTEMIND_STAGE_TRACE_OUT: directory } });
    const workerFile = fs.readdirSync(directory).find(name => /^stage-[0-9]+-thread-[1-9][0-9]*\.json$/.test(name)); assert.ok(workerFile);
    const report = JSON.parse(fs.readFileSync(path.join(directory, workerFile)));
    assert.equal(report.finalProcessExitFlush, true); assert.equal(report.coverage.unfinishedEvents.length, 0);
    assert.ok(report.groups.some(row => row.name === 'builtin:JSON.parse'));
    assert.equal(report.counters.find(row => row.name === 'file-read').value, 5);
    assert.equal(report.ranking, null);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});
