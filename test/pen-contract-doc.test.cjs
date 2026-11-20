// The pen buttons are a fixed contract (docs/PEN-BUTTONS.md): it must never break. This keeps the page stating it, and keeps the
// tests that hold it from being removed, renamed away or cut short. Changing a row here needs Sean's explicit word, with the page
// and the behaviour tests in the same change.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the pen-button page states the contract, row by row', () => {
  const page = read('docs/PEN-BUTTONS.md');
  for (const row of [
    '| **Lower held, tip taps or drags** | **Delete:** erases the whole strokes the tip touches. |',
    '| **Lower double-tap** | **Undo** |',
    '| **Upper held, tip taps or drags** | **Selection box.** A tap selects the stroke under the tip. |',
    '| **Upper double-tap** | **Redo** |',
    '| **Lower tapped, then upper held, tip drags** | **Zoom** around where the tip touched: drag up to zoom in, down to zoom out. |',
    '| **Upper tapped, then lower held, tip drags** | **Scroll:** pans the page. It only does something when the page is zoomed in. |',
  ]) assert.ok(page.includes(row), row);
  for (const rule of ['It must never break.', '**Holding a button alone does nothing.**', '**A held button is a mode until it is let go.**']) {
    assert.ok(page.includes(rule), rule);
  }
});

test('the state-machine contract tests are all still there', () => {
  const contract = read('test/pen-buttons-contract.test.cjs');
  for (const title of [
    'the standard jobs: bottom erases and undoes, top selects and redoes, by physical position',
    'bottom button held: nothing while hovering, erase when the tip touches or drags',
    'top button held: nothing while hovering, a selection when the tip touches or drags',
    'the plain tip draws, and a button pressed mid-stroke changes nothing about the stroke the app already took',
    'double-tapping the bottom button is Undo, the top button Redo',
    'a double tap needs two clean taps close together',
    'bottom then top, quickly, with the top held: zoom while it is held',
    'top then bottom, quickly, with the bottom held: scroll while it is held',
    'what is not a chord',
    'a chord never leaves half a double tap behind, and the double taps still work after it',
  ]) assert.ok(contract.includes(`test('${title}'`), title);
});

test('the app checks still walk every gesture, with the display and the driver both reporting', () => {
  const native = read('test/pen-buttons-native.cjs');
  for (const step of [
    "Bottom button pressed while hovering, the driver\\'s click arriving first: nothing is erased and nothing is drawn",
    "Bottom button held while hovering over ink, with the driver\\'s right click: nothing is erased",
    'Bottom button held, tip tapped on a stroke: that stroke (and only it) is deleted',
    'Bottom button double-tap is Undo: the deleted stroke is back',
    'Top button double-tap is Redo: the stroke is deleted again',
    'Top button held while hovering selects nothing',
    'Top button held, tip dragged over a stroke: the stroke is selected',
    "The selection box is the pen\\'s drag",
    'Scroll chord on a page that is not zoomed in changes nothing and erases nothing',
    'Zoom chord while hovering zooms nothing',
    'Zoom chord, tip dragged up: zoomed in',
    'A second drag in the same hold, tip dragged down: zoomed out',
    'Scroll chord on a zoomed page moves the view',
    'After the chord, the bottom button held and tapped deletes again',
    'After the chord, the bottom button double-tap is still Undo',
  ]) assert.ok(native.includes(step), step);
  // The wrappers refuse a run that stopped short.
  assert.match(read('test/pen-buttons-native.test.cjs'), /result\.checks\.length >= 25/);
  assert.match(read('test/pen-buttons-app.test.cjs'), /result\.checks\.length >= 21/);
  assert.match(JSON.parse(read('package.json')).scripts.test, /test\/\*\.test\.cjs/, 'npm test runs every test file');
});

test('the agent rules point at the contract', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('docs/PEN-BUTTONS.md'));
  assert.ok(agents.includes('test/pen-contract-doc.test.cjs'));
});
