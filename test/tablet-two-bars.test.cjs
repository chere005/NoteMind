// The drawing pane's two bars (docs/PEN-BUTTONS.md for the pen menu's Pen Buttons row): Undo and Redo side by side, every colour on
// the bar at every pane width, the pen kinds, Writing as a strip. The hidden app check is test/tablet-two-bars.cjs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {hiddenCheck} = require('./helpers/hidden-check.cjs');

test('the drawing pane keeps its two bars, Redo beside Undo, and the pen menu reaches the pen buttons', {
  skip: process.platform === 'darwin' ? false : 'the hidden app check needs the Mac app',
  timeout: 240000,
}, () => {
  const {run, result} = hiddenCheck('tablet-two-bars', 200000);
  assert.ok(result, 'the check wrote no report: ' + (run.stderr || run.error || '').toString().slice(0, 600));
  assert.equal(result.ok, true, result.error);
  assert.equal(run.status, 0);
  assert.ok(result.checks.length >= 90, 'every step ran: ' + result.checks.length);
});
