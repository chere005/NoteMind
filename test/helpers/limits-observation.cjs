const { setTimeout: delay } = require('node:timers/promises');

const enabled = process.env.NOTEMIND_LIMITS_4_GIB === '1';
const aggregateLimit = (enabled ? 4 : 1) * 1024 ** 3;

async function observeIdle(app, result) {
  const start = performance.now();
  result.workloadMs = start;
  const until = start + 60000;
  let bytes;
  do {
    await delay(Math.min(1000, Math.max(1, until - performance.now())));
    bytes = app.getAppMetrics().reduce((total, row) => total + row.memory.workingSetSize * 1024, 0);
    result.idlePeakBytes = Math.max(result.idlePeakBytes || 0, bytes);
    if (bytes > aggregateLimit) throw Error('Aggregate memory guard exceeded during idle observation.');
  } while (performance.now() < until);
  result.after60SecondsBytes = bytes;
}

module.exports = { enabled, aggregateLimit, observeIdle };
