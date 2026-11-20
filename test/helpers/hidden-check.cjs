// Runs one of the hidden Electron checks (test/hidden-runner.cjs <name>) and reads the report it writes.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function hiddenCheck(name, timeout) {
  const report = path.join(root, 'test-results', name + '.json');
  fs.rmSync(report, {force: true});
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const run = cp.spawnSync(require('electron'), ['test/hidden-runner.cjs', name], {cwd: root, env, encoding: 'utf8', timeout});
  let result = null;
  try { result = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { /* the run never got to write it */ }
  return {run, result};
}

module.exports = {hiddenCheck};
