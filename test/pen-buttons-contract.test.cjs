// The pen buttons' contract (docs/PEN-BUTTONS.md). Never weaken a case here without the owner's word.
const {test, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildSync} = require('esbuild');

const root = path.resolve(__dirname, '..');
const entry = `export * from './src/tablet/renderer/penButtons';
export {setChord, activeChord} from './src/tablet/renderer/penChord';
export {nativeSideMask} from './src/tablet/renderer/nativeButtons';`;
const built = buildSync({
  stdin: {contents: entry, resolveDir: root}, bundle: true, platform: 'node', format: 'cjs', write: false,
  alias: {'@notemind/core': path.join(root, 'src/tablet/core.js')},
});
const box = {exports: {}};
vm.runInNewContext(built.outputFiles[0].text, {module: box, exports: box.exports, window: {}, document: {}, require, performance});
const pen = box.exports;
// (the module ran in its own realm: compare plain copies)
const plain = value => JSON.parse(JSON.stringify(value));

const TIP = 1, LOWER = 2, UPPER = 4;
const settings = {eraser: false, selectTool: false, buttons: pen.DEFAULT_BUTTONS};
const event = (buttons, pressure = 0) => ({pointerType: 'pen', button: -1, buttons, pressure});

/** One pen, in time: events go through the real state machine and publish the chord as penActions.ts does. */
class Pen {
  constructor() { this.state = pen.noTap; this.now = 10000; this.fired = []; pen.setChord(null); }
  wait(ms) { this.now += ms; return this; }
  send(phase, buttons, pressure = 0) {
    const e = event(buttons, pressure);
    const step = pen.tapStep(this.state, phase, e, pen.DEFAULT_BUTTONS, this.now);
    this.state = step.state;
    pen.setChord(step.state.chord ?? null);
    if (step.fire) this.fired.push(step.fire);
    return e;
  }
  hover(buttons) { return this.send('move', buttons); }
  touch(buttons) { return this.send('down', buttons | TIP, 0.5); }
  drag(buttons) { return this.send('move', buttons | TIP, 0.5); }
  lift(buttons) { return this.send('up', buttons); }
  /** Press and release one button in the air: `held` ms down. */
  tap(button, held = 80) { this.hover(button); this.wait(held); this.hover(0); return this; }
  press(e) { return pen.resolvePress(e, settings); }
  get chord() { return pen.activeChord(); }
}

beforeEach(() => pen.setChord(null));

test('the standard jobs: bottom erases and undoes, top selects and redoes, by physical position', () => {
  assert.equal(pen.BUTTON_LAYOUT, 'physical-v1');
  assert.deepEqual(plain(pen.DEFAULT_BUTTONS.lower), {hold: 'erase', double: 'undo'});
  assert.deepEqual(plain(pen.DEFAULT_BUTTONS.upper), {hold: 'select', double: 'redo'});
  assert.equal(pen.nativeSideMask({lower: true, upper: false}), LOWER);
  assert.equal(pen.nativeSideMask({lower: false, upper: true}), UPPER);
  const saved = {buttonLayout: 'physical-v1', slots: {lower: {hold: 'erase', double: 'undo'}, upper: {hold: 'select', double: 'redo'}}};
  assert.deepEqual(plain(pen.migrateButtons(saved).lower), {hold: 'erase', double: 'undo'});
  assert.deepEqual(plain(pen.migrateButtons(saved).upper), {hold: 'select', double: 'redo'});
  assert.deepEqual(plain(pen.migrateButtons({}).lower), {hold: 'erase', double: 'undo'});
  assert.deepEqual(plain(pen.migrateButtons('unreadable').upper), {hold: 'select', double: 'redo'});
  // Settings saved before the physical layout named the buttons by pointer button: the same two jobs, the right way round.
  const legacy = {slots: {lower: {hold: 'select', double: 'redo'}, upper: {hold: 'erase', double: 'undo'}}};
  assert.deepEqual(plain(pen.migrateButtons(legacy).lower), {hold: 'erase', double: 'undo'});
  assert.deepEqual(plain(pen.migrateButtons(legacy).upper), {hold: 'select', double: 'redo'});
});

test('the switches are read the way the display reports them', () => {
  const swift = fs.readFileSync(path.join(root, 'tools/pen/wm-pen-display.swift'), 'utf8');
  assert.match(swift, /lower: range && status & 0x02 != 0, upper: range && status & 0x04 != 0/);
  const backend = fs.readFileSync(path.join(root, 'src/tablet/main/pen/macPenBackend.ts'), 'utf8');
  assert.match(backend, /0x04 upper switch, 0x02 lower switch/);
});

test('bottom button held: nothing while hovering, erase when the tip touches or drags', () => {
  const p = new Pen();
  assert.equal(p.press(p.hover(LOWER)).kind, 'ignore');
  assert.equal(p.press(event(LOWER)).kind, 'ignore');
  assert.equal(p.press(p.touch(LOWER)).kind, 'erase');
  assert.equal(p.press(p.drag(LOWER)).kind, 'erase');
});

test('top button held: nothing while hovering, a selection when the tip touches or drags', () => {
  const p = new Pen();
  assert.equal(p.press(p.hover(UPPER)).kind, 'ignore');
  const touched = p.press(p.touch(UPPER));
  assert.equal(touched.kind, 'select');
  assert.equal(touched.additive, false);
  assert.equal(touched.move, true);
  assert.equal(p.press(p.drag(UPPER)).kind, 'select');
});

test('the plain tip draws, and a button pressed mid-stroke changes nothing about the stroke the app already took', () => {
  const p = new Pen();
  assert.equal(p.press(p.touch(0)).kind, 'draw');
  assert.equal(p.press(event(TIP, 0.5)).kind, 'draw');
});

test('double-tapping the bottom button is Undo, the top button Redo', () => {
  const p = new Pen();
  p.tap(LOWER).wait(120).tap(LOWER);
  assert.deepEqual(plain(p.fired), ['undo']);
  const q = new Pen();
  q.tap(UPPER).wait(120).tap(UPPER);
  assert.deepEqual(plain(q.fired), ['redo']);
});

test('a double tap needs two clean taps close together', () => {
  const slow = new Pen();
  slow.tap(LOWER).wait(450).tap(LOWER);
  assert.deepEqual(slow.fired, [], 'the second press came too late');
  const long = new Pen();
  long.tap(LOWER, 700).wait(100).tap(LOWER);
  assert.deepEqual(long.fired, [], 'a press held that long is a hold, not a tap');
  const touched = new Pen();
  touched.tap(UPPER).wait(50);
  touched.touch(0);
  touched.lift(0);
  touched.wait(50).tap(UPPER);
  assert.deepEqual(touched.fired, [], 'the tip touching between the taps ends the pair');
  const duringTouch = new Pen();
  duringTouch.hover(LOWER);
  duringTouch.touch(LOWER);
  duringTouch.lift(LOWER);
  duringTouch.hover(0);
  duringTouch.wait(100).tap(LOWER);
  assert.deepEqual(duringTouch.fired, [], 'a press that touched is a hold');
  const both = new Pen();
  both.hover(LOWER | UPPER);
  both.wait(80).hover(0);
  both.wait(100).hover(LOWER | UPPER);
  both.wait(80).hover(0);
  assert.deepEqual(both.fired, []);
});

test('bottom then top, quickly, with the top held: zoom while it is held', () => {
  const p = new Pen();
  p.tap(LOWER).wait(150);
  p.hover(UPPER);
  assert.equal(p.chord, 'zoom');
  assert.equal(p.press(event(UPPER)).kind, 'ignore', 'hovering zooms nothing');
  assert.equal(p.press(p.touch(UPPER)).kind, 'zoom');
  assert.equal(p.press(p.drag(UPPER)).kind, 'zoom');
  p.lift(UPPER);
  assert.equal(p.chord, 'zoom', 'lifting the tip between drags keeps the chord');
  p.hover(UPPER);
  assert.equal(p.press(p.touch(UPPER)).kind, 'zoom', 'a second drag in the same hold');
  p.lift(UPPER);
  p.hover(0);
  assert.equal(p.chord, null, 'letting go of the top button ends it');
  assert.equal(p.press(event(TIP, 0.5)).kind, 'draw');
  assert.deepEqual(p.fired, []);
});

test('top then bottom, quickly, with the bottom held: scroll while it is held', () => {
  const p = new Pen();
  p.tap(UPPER).wait(150);
  p.hover(LOWER);
  assert.equal(p.chord, 'scroll');
  assert.equal(p.press(event(LOWER)).kind, 'ignore', 'hovering scrolls nothing');
  assert.equal(p.press(p.touch(LOWER)).kind, 'pan');
  assert.equal(p.press(p.drag(LOWER)).kind, 'pan');
  p.lift(LOWER);
  p.hover(0);
  assert.equal(p.chord, null);
  assert.equal(p.press(p.touch(LOWER)).kind, 'erase', 'the bottom button is the eraser again');
});

test('what is not a chord', () => {
  const late = new Pen();
  late.tap(LOWER).wait(450);
  late.hover(UPPER);
  assert.equal(late.chord, null, 'the second press came too late');
  const long = new Pen();
  long.tap(LOWER, 700).wait(100);
  long.hover(UPPER);
  assert.equal(long.chord, null, 'the first press was a hold');
  const touched = new Pen();
  touched.hover(LOWER);
  touched.touch(LOWER);
  touched.lift(LOWER);
  touched.hover(0);
  touched.wait(100);
  touched.hover(UPPER);
  assert.equal(touched.chord, null, 'the first press touched');
  const together = new Pen();
  together.hover(LOWER | UPPER);
  assert.equal(together.chord, null, 'both at the same moment');
  const sameButton = new Pen();
  sameButton.tap(UPPER).wait(100);
  sameButton.hover(UPPER);
  assert.equal(sameButton.chord, null, 'the same button twice is a double tap');
  const withTouch = new Pen();
  withTouch.tap(LOWER).wait(100);
  withTouch.touch(UPPER);
  assert.equal(withTouch.chord, null, 'the second button pressed with the tip already touching is a hold');
  assert.equal(withTouch.press(event(UPPER | TIP, 0.5)).kind, 'select');
});

test('a chord never leaves half a double tap behind, and the double taps still work after it', () => {
  const p = new Pen();
  p.tap(LOWER).wait(100);
  p.hover(UPPER);
  assert.equal(p.chord, 'zoom');
  p.wait(80).hover(0);
  assert.equal(p.chord, null);
  p.wait(100).tap(UPPER);
  assert.deepEqual(p.fired, [], 'one tap after a chord is a first tap, not a Redo');
  p.wait(900).tap(LOWER).wait(100).tap(LOWER);
  assert.deepEqual(plain(p.fired), ['undo']);
});

test('a cancelled pen clears every state', () => {
  const p = new Pen();
  p.tap(LOWER).wait(100);
  p.hover(UPPER);
  assert.equal(p.chord, 'zoom');
  const cancelled = pen.tapStep(p.state, 'cancel', event(0), pen.DEFAULT_BUTTONS, p.now);
  assert.equal(cancelled.state.chord, null);
  assert.deepEqual(plain(cancelled.state), plain(pen.noTap));
});

test('a mouse or touch never starts a chord or a pen hold', () => {
  const mouse = {pointerType: 'mouse', button: 0, buttons: UPPER, pressure: 0};
  const step = pen.tapStep(pen.noTap, 'move', mouse, pen.DEFAULT_BUTTONS, 1000);
  assert.deepEqual(plain(step.state), plain(pen.noTap));
  pen.setChord('zoom');
  assert.equal(pen.resolvePress({pointerType: 'mouse', button: 0, buttons: TIP, pressure: 0.5}, settings).kind, 'draw');
});
