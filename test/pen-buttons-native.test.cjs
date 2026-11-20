// The same contract (docs/PEN-BUTTONS.md) the way a Wacom pen display delivers it: its own button reports and contact points.
// The hidden app check is test/pen-buttons-native.cjs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {hiddenCheck} = require('./helpers/hidden-check.cjs');

test('the pen buttons do what docs/PEN-BUTTONS.md says when the Wacom display reports them', {
  skip: process.platform === 'darwin' ? false : 'the hidden app check needs the Mac app',
  timeout: 240000,
}, () => {
  const {run, result} = hiddenCheck('pen-buttons-native', 200000);
  assert.ok(result, 'the check wrote no report: ' + (run.stderr || run.error || '').toString().slice(0, 600));
  assert.equal(result.ok, true, result.error);
  assert.equal(run.status, 0);
  assert.ok(result.checks.length >= 25, 'every step of the contract ran: ' + result.checks.length);
});
