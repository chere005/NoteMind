// Runs the hidden app check of the pen buttons' contract (docs/PEN-BUTTONS.md): the real drawing sheet, pen events that carry
// the side buttons. It is part of `npm test` so the behaviour is confirmed on every run.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {hiddenCheck} = require('./helpers/hidden-check.cjs');

test('the pen buttons do what docs/PEN-BUTTONS.md says on a real drawing sheet', {
  skip: process.platform === 'darwin' ? false : 'the hidden app check needs the Mac app',
  timeout: 240000,
}, () => {
  const {run, result} = hiddenCheck('pen-buttons-app', 200000);
  assert.ok(result, 'the check wrote no report: ' + (run.stderr || run.error || '').toString().slice(0, 600));
  assert.equal(result.ok, true, result.error);
  assert.equal(run.status, 0);
  assert.ok(result.checks.length >= 21, 'every step of the contract ran: ' + result.checks.length);
});
