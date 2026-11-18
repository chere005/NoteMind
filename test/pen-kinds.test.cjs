// The kinds of pen (Pen, Marker, Fountain Pen, Highlighter): what each captures, with the stroke format unchanged.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {load, surfaceHarness, pageModule} = require('./helpers/tablet-surface.cjs');
const kinds = load('src/tablet/renderer/penKinds.ts');
const {beneath, placeBeneath} = load('src/tablet/renderer/inkBeneath.ts');
const {createInkActionController} = require('../src/ink-mutations.js');
const {pressureScale} = require('../src/tablet/core.js');

const HEX = /^#[0-9a-f]{6}$/;
const luminance = hex => {
  const channel = at => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  };
  return .2126 * channel(1) + .7152 * channel(3) + .0722 * channel(5);
};
// A stroke of `count` samples going one way, `step` pixels and 8 ms apart.
const run = (nib, dx, dy, count, device = null) => {
  const pressures = [];
  for (let at = 0; at < count; at++) pressures.push(nib.next(dx, dy, 8, device));
  return pressures;
};
const settled = (dx, dy, device = null) => {
  const nib = kinds.createNib(10);
  nib.next(0, 0, 0, null);
  return run(nib, dx, dy, 60, device).at(-1);
};

test('the four kinds, and anything else is the pen', () => {
  assert.deepEqual(Array.from(kinds.PEN_KINDS, one => one.value), ['pen', 'marker', 'fountain', 'highlighter']);
  assert.deepEqual(Array.from(kinds.PEN_KINDS, one => one.label), ['Pen', 'Marker', 'Fountain Pen', 'Highlighter']);
  assert.equal(kinds.isPenKind('fountain'), true);
  for (const value of [undefined, null, 'brush', 3]) {
    assert.equal(kinds.isPenKind(value), false);
    assert.equal(kinds.kindOn(value, 'sheet'), 'pen');
  }
});

test('each kind has its width: pen as chosen, marker three times, nib one and a half, highlighter a band', () => {
  assert.equal(kinds.kindWidth('pen', 3), 3);
  assert.equal(kinds.kindWidth('marker', 3), 9);
  assert.equal(kinds.kindWidth('fountain', 3), 4.5);
  assert.equal(kinds.kindWidth('highlighter', 3), 18);
  assert.equal(kinds.kindWidth('highlighter', 1), 12);
  assert.equal(kinds.kindWidth('highlighter', 16), 96);
});

test('the highlighter needs a plain sheet, and camera ink is the pen', () => {
  for (const {value} of kinds.PEN_KINDS) assert.equal(kinds.kindOff(value, 'sheet'), null);
  assert.equal(kinds.kindOff('highlighter', 'picture'), 'Highlighter needs a plain sheet');
  assert.equal(kinds.kindOn('highlighter', 'picture'), 'pen');
  assert.equal(kinds.kindOn('marker', 'picture'), 'marker');
  assert.equal(kinds.kindOn('fountain', 'picture'), 'fountain');
  for (const value of ['marker', 'fountain', 'highlighter']) {
    assert.equal(typeof kinds.kindOff(value, 'camera'), 'string');
    assert.equal(kinds.kindOn(value, 'camera'), 'pen');
  }
  assert.equal(kinds.kindOff('pen', 'camera'), null);
});

test('a highlight is a valid colour: paler than the ink on light paper, darker than the ink on dark paper', () => {
  const inks = ['#1C1C1E', '#F2542D', '#2D7DD2', '#2FBF71', '#F5B700', '#8E44AD', '#000000', '#ffffff', '#F2F2F7'];
  for (const paper of ['#ffffff', '#f7f0dc', '#1e2025']) {
    for (const ink of inks) assert.match(kinds.tintToward(ink, paper), HEX, `${ink} on ${paper}`);
  }
  for (const ink of inks.slice(0, 6)) {
    const tint = kinds.tintToward(ink, '#ffffff');
    assert.ok(luminance(tint) > luminance(ink), `${tint} is paler than ${ink}`);
    assert.ok(luminance(tint) < 1, `${tint} is not the paper`);
  }
  // On dark paper the bright inks (and the near-white the black is shown as) are mixed down toward the paper.
  for (const ink of ['#F2542D', '#2FBF71', '#F5B700', '#F2F2F7', '#6DA9F0']) {
    const tint = kinds.tintToward(ink, '#1e2025');
    assert.ok(luminance(tint) < luminance(ink), `${tint} is darker than ${ink}`);
    assert.ok(luminance(tint) > luminance('#1e2025'), `${tint} still shows on the paper`);
  }
});

test('the tint is the ink at 35 to 40 percent on the paper, whatever is given', () => {
  assert.ok(kinds.HIGHLIGHT_SHARE >= .35 && kinds.HIGHLIGHT_SHARE <= .4);
  assert.equal(kinds.tintToward('#000000', '#ffffff', .5), '#808080');
  assert.equal(kinds.tintToward('#ff0000', '#ffffff', 1), '#ff0000');
  assert.equal(kinds.tintToward('#ff0000', '#102030', 0), '#102030');
  assert.equal(kinds.tintToward('#FF0000', 'not a colour', 0), '#ffffff');
  assert.equal(kinds.tintToward('red', '#ffffff'), 'red');
  assert.match(kinds.tintToward('#123456', '#ffffff', NaN), HEX);
  assert.match(kinds.tintToward('#123456', '#ffffff', 7), HEX);
});

test('the nib is thin along its 45 degree edge and thick across it', () => {
  assert.ok(Math.abs(kinds.nibAcross(1, -1)) < 1e-12, 'up to the right is the hairline');
  assert.ok(Math.abs(kinds.nibAcross(-3, 3)) < 1e-12, 'and so is down to the left');
  assert.ok(Math.abs(kinds.nibAcross(1, 1) - 1) < 1e-12, 'down to the right is the full width');
  assert.ok(Math.abs(kinds.nibAcross(5, 0) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(kinds.nibAcross(0, 5) - Math.SQRT1_2) < 1e-12);
  assert.equal(kinds.nibAcross(0, 0), .5);
  const thin = settled(3, -3), across = settled(3, 3), level = settled(4, 0);
  assert.ok(thin < .15, `hairline ${thin}`);
  assert.ok(across > .8, `full width ${across}`);
  assert.ok(level > thin && level < across, `a level stroke is between: ${level}`);
  // What the renderer draws from those: a mouse (no pressure of its own) still writes thick and thin.
  assert.ok(pressureScale(across) / pressureScale(thin) > 3);
});

test('a ruled nib line is one width for the way it goes', () => {
  assert.ok(kinds.nibLineScale(1, 1) > kinds.nibLineScale(1, 0));
  assert.ok(kinds.nibLineScale(1, 0) > kinds.nibLineScale(1, -1));
  assert.equal(kinds.nibLineScale(1, -1), pressureScale(kinds.NIB_THIN));
});

test('the hand presses harder for thicker and moves faster for thinner', () => {
  const light = settled(4, 0, .15), even = settled(4, 0, .5), hard = settled(4, 0, .95);
  assert.ok(light < even && even < hard, `${light} < ${even} < ${hard}`);
  assert.ok(Math.abs(even - settled(4, 0, null)) < 1e-9, 'a pen at half pressure writes as a mouse does');
  const slow = kinds.createNib(10), fast = kinds.createNib(10);
  slow.next(0, 0, 0, null);
  fast.next(0, 0, 0, null);
  let slowLast = 0, fastLast = 0;
  for (let at = 0; at < 80; at++) {
    slowLast = slow.next(2, 0, 16, null);
    fastLast = fast.next(40, 0, 8, null);
  }
  assert.ok(fastLast < slowLast, `fast ${fastLast} is thinner than slow ${slowLast}`);
  // A pen feed hands samples over in bursts with no time between them: the pace is the burst's, not each sample's.
  const steady = kinds.createNib(10), burst = kinds.createNib(10);
  steady.next(0, 0, 0, null);
  burst.next(0, 0, 0, null);
  let evenLast = 0, burstLast = 0;
  for (let at = 0; at < 200; at++) {
    evenLast = steady.next(1, 0, 4, null);
    burstLast = burst.next(1, 0, at % 4 === 3 ? 16 : 0, null);
  }
  assert.ok(Math.abs(evenLast - burstLast) < .01, `burst ${burstLast} is paced as even ${evenLast}`);
});

test('the nib never jumps: one sample changes the pressure by a bounded step, whatever the hand does', () => {
  const nib = kinds.createNib(10);
  let last = nib.next(0, 0, 0, null), seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let at = 0; at < 4000; at++) {
    // Zigzags, stops, huge jumps, a pressure that flickers, time that stands still.
    const dx = at % 7 === 0 ? 0 : (random() - .5) * (at % 11 === 0 ? 400 : 12);
    const dy = at % 7 === 0 ? 0 : (random() - .5) * (at % 13 === 0 ? 400 : 12);
    const next = nib.next(dx, dy, at % 5 === 0 ? 0 : random() * 20, at % 3 === 0 ? null : random());
    assert.ok(next >= 0 && next <= 1, `pressure ${next}`);
    assert.ok(Math.abs(next - last) <= kinds.NIB_MAX_STEP + 1e-12, `step ${next - last} at ${at}`);
    last = next;
  }
  for (const bad of [[NaN, 1], [Infinity, 0], [1, NaN]]) assert.equal(nib.next(bad[0], bad[1], 8, null), last);
  // A pixel of mouse stair-step along a diagonal does not turn the nib thick and thin.
  const stairs = kinds.createNib(10);
  stairs.next(0, 0, 0, null);
  const steps = [];
  for (let at = 0; at < 200; at++) steps.push(stairs.next(at % 2 ? 1 : 0, at % 2 ? 0 : 1, 8, null));
  const tail = steps.slice(100);
  assert.ok(Math.max(...tail) - Math.min(...tail) < .12, `stair-step ripple ${Math.max(...tail) - Math.min(...tail)}`);
});

test('a nib stroke begins thin and swells over its taper, and a new stroke begins thin again', () => {
  const nib = kinds.createNib(12);
  const first = nib.next(0, 0, 0, null);
  assert.ok(first > 0 && first < .2, `the first point is thin: ${first}`);
  const pressures = run(nib, 1, 1, 60);
  assert.ok(pressures[2] < pressures[20], 'it swells');
  assert.ok(pressures.at(-1) > .8);
  nib.restart();
  assert.equal(nib.next(50, 50, 8, 1), first, 'the first point of the next stroke ignores how the pen got there');
  assert.equal(kinds.nibTaper(1.5), 6);
  assert.equal(kinds.nibTaper(4.5), 11.25);
  assert.equal(kinds.nibTaper(24), 28);
});

test('a nib stroke ends thin: only the last pixels of its path change, in place', () => {
  const sheet = {width: 400, height: 600};
  const points = Array.from({length: 41}, (_, at) => ({x: at / 400, y: .5}));
  const pressures = points.map(() => .8), before = pressures.slice();
  const made = kinds.nibTaperEnd(pressures, points, sheet, 10);
  assert.equal(made, pressures);
  for (let at = 0; at <= 30; at++) assert.equal(pressures[at], before[at], `point ${at} is ${40 - at} px from the end`);
  for (let at = 31; at < 41; at++) assert.ok(pressures[at] < before[at], `point ${at} thins`);
  for (let at = 32; at < 41; at++) assert.ok(pressures[at] < pressures[at - 1], 'steadily');
  assert.ok(Math.abs(pressures[40] - .8 * kinds.NIB_END) < 1e-12);
  // A copy shows the live stroke as it would end, without touching the stroke.
  const live = before.slice();
  assert.deepEqual(kinds.nibTaperEnd(live.slice(), points, sheet, 10), pressures);
  assert.deepEqual(live, before);
  assert.deepEqual(kinds.nibTaperEnd([.5], [{x: .1, y: .1}], sheet, 10), [.5 * kinds.NIB_END]);
  assert.deepEqual(kinds.nibTaperEnd([], [], sheet, 10), []);
});

test('the same samples always make the same stroke', () => {
  const write = () => {
    const nib = kinds.createNib(9);
    const pressures = [nib.next(0, 0, 0, null)];
    for (let at = 1; at < 300; at++) {
      const device = at % 4 ? .3 + (at % 10) / 20 : null;
      pressures.push(nib.next(Math.cos(at / 9) * 5, Math.sin(at / 5) * 5, 4 + at % 9, device));
    }
    return pressures;
  };
  assert.deepEqual(write(), write());
});

// MARK: - On a sheet

const stroke = (colorHex, ...points) => ({colorHex, width: 2, points: points.map(([x, y]) => ({x, y}))});
const settle = async () => { for (let at = 0; at < 40; at++) await new Promise(resolve => setImmediate(resolve)); };

test('beneath makes a new frozen list with the stroke first and leaves the list it was given alone', async () => {
  const a = stroke('#111111', [0, 0]), b = stroke('#222222', [.1, .1]), under = stroke('#eeeeee', [.2, .2]);
  const before = Object.freeze([a, b]);
  const next = await beneath(before, under);
  assert.notEqual(next, before);
  assert.deepEqual([...next], [under, a, b]);
  assert.ok(Object.isFrozen(next));
  assert.deepEqual([...before], [a, b]);
  assert.deepEqual([...await beneath([], under)], [under]);
});

test('a stroke placed beneath is one undo, and redo puts it back beneath', async () => {
  const page = new pageModule.TabletPage(1);
  const a = stroke('#111111', [.1, .1], [.2, .2]), b = stroke('#222222', [.3, .3], [.4, .4]);
  page.add(a);
  page.add(b);
  let edited = 0;
  const actions = createInkActionController(page, {onEdited: () => { edited++; }});
  const under = stroke('#fbe49e', [.1, .3], [.4, .3]);
  const inked = page.strokes;
  assert.equal(await placeBeneath(actions, page, under), true);
  assert.deepEqual([...page.strokes], [under, a, b]);
  assert.deepEqual([...inked], [a, b], 'the list that was there is untouched');
  assert.equal(edited, 1, 'the sheet says it was edited');
  const made = page.strokes;
  await actions.undo();
  assert.equal(page.strokes, inked, 'one Undo takes the highlight away');
  await actions.redo();
  assert.equal(page.strokes, made, 'Redo restores the same list');
  assert.equal(page.strokes[0], under);
  // Ink written after it stays above it.
  const c = stroke('#333333', [.5, .5]);
  page.add(c);
  assert.deepEqual([...page.strokes], [under, a, b, c]);
  // The eraser takes it like any stroke.
  assert.equal(pageModule.strokeUnder(page.strokes, {x: .25, y: .3}, {width: 400, height: 400}, 8, .4), 0);
});

test('a stroke is finished before it is placed, and a sheet that changes under it is not overwritten', async () => {
  const page = new pageModule.TabletPage(1);
  const a = stroke('#111111', [.1, .1]);
  page.add(a);
  const actions = createInkActionController(page, {onError() {}});
  const under = stroke('#fbe49e', [.1, .3], [.4, .35]), ruled = {...under, points: [{x: .1, y: .3}, {x: .4, y: .3}]};
  await placeBeneath(actions, page, under, async given => { assert.equal(given, under); return ruled; });
  assert.deepEqual([...page.strokes], [ruled, a]);
  const late = stroke('#afceee', [.2, .2]), b = stroke('#222222', [.6, .6]);
  const meanwhile = async given => { page.add(b); return given; };
  await assert.rejects(placeBeneath(actions, page, late, meanwhile), {name: 'AbortError'});
  assert.deepEqual([...page.strokes], [ruled, a, b]);
});

const draw = (h, from, to) => {
  h.pointer('pointerdown', ...from, 1, 'mouse');
  for (let at = 1; at <= 12; at++) {
    h.pointer('pointermove', from[0] + (to[0] - from[0]) * at / 12, from[1] + (to[1] - from[1]) * at / 12, 1, 'mouse');
  }
  h.pointer('pointerup', ...to, 0, 'mouse');
};

test('drawing with each kind on a sheet keeps the stroke format and puts the highlight under the ink', async () => {
  const h = surfaceHarness({size: {width: 500, height: 700}, page: new pageModule.TabletPage(500 / 700)});
  const unit = 1000 / 500;
  draw(h, [100, 100], [300, 100]);
  await settle();
  assert.equal(h.page.strokes.length, 1);
  const pen = h.page.strokes[0];
  assert.deepEqual(Object.keys(pen), ['colorHex', 'width', 'points']);
  assert.equal(pen.width, 3 * unit);

  h.tools.kind = 'marker';
  draw(h, [100, 60], [300, 140]);
  await settle();
  const marker = h.page.strokes[1];
  assert.deepEqual(Object.keys(marker), ['colorHex', 'width', 'points']);
  assert.equal(marker.width, 9 * unit);
  assert.equal(marker.colorHex, '#123456');

  h.tools.kind = 'fountain';
  draw(h, [100, 220], [260, 60]);
  draw(h, [120, 60], [280, 220]);
  await settle();
  const thin = h.page.strokes[2], thick = h.page.strokes[3];
  for (const nib of [thin, thick]) {
    assert.deepEqual(Object.keys(nib), ['colorHex', 'width', 'points', 'pressures']);
    assert.equal(nib.width, 4.5 * unit);
    assert.equal(nib.pressures.length, nib.points.length);
    assert.ok(nib.pressures.every(value => value >= 0 && value <= 1));
    assert.ok(new Set(nib.pressures).size > 3, 'the pressures vary');
    assert.ok(nib.pressures.at(-1) < Math.max(...nib.pressures), 'it ends thinner than its widest');
  }
  assert.ok(Math.max(...thick.pressures) > 2 * Math.max(...thin.pressures), 'thick across the nib, thin along it');

  h.tools.kind = 'highlighter';
  const inked = h.page.strokes;
  draw(h, [80, 100], [320, 100]);
  await settle();
  assert.equal(h.page.strokes.length, 5);
  const highlight = h.page.strokes[0];
  assert.deepEqual([...h.page.strokes.slice(1)], [...inked], 'the ink is as it was, above it');
  assert.deepEqual(Object.keys(highlight), ['colorHex', 'width', 'points']);
  assert.equal(highlight.width, 18 * unit);
  assert.equal(highlight.colorHex, kinds.tintToward('#123456', '#ffffff'));
  assert.match(highlight.colorHex, HEX);

  await h.handle.current.undo();
  await settle();
  assert.equal(h.page.strokes, inked, 'one Undo removes the highlight');
  await h.handle.current.redo();
  await settle();
  assert.equal(h.page.strokes[0], highlight, 'Redo restores it under the ink');
  assert.equal(h.page.strokes.length, 5);
});

test('a sheet with a picture under the ink falls back to the pen for the highlighter', async () => {
  const page = new pageModule.TabletPage(500 / 700);
  page.backdrop = 'picture.png';
  const h = surfaceHarness({size: {width: 500, height: 700}, page});
  h.tools.kind = 'highlighter';
  draw(h, [100, 100], [300, 100]);
  await settle();
  assert.equal(h.page.strokes.length, 1);
  assert.equal(h.page.strokes[0].colorHex, '#123456');
  assert.equal(h.page.strokes[0].width, 3 * 1000 / 500);
});

// A line drawn with Shift held: ruled straight when the pen lifts (ink-constraints.cjs).
const rule = (h, from, to) => {
  const send = (type, x, y, buttons) => {
    const event = {type, pointerId: 4242, pointerType: 'mouse', button: type === 'pointerdown' ? 0 : -1, buttons,
      pressure: buttons ? .6 : 0, timeStamp: 100, clientX: x, clientY: y, shiftKey: true, preventDefault() {}};
    const handler = {pointerdown: 'onPointerDown', pointermove: 'onPointerMove', pointerup: 'onPointerUp'}[type];
    h.find('tablet').props[handler]({nativeEvent: event, ...event});
    h.render();
  };
  send('pointerdown', ...from, 1);
  for (let at = 1; at <= 8; at++) {
    const wobble = at % 2 ? 3 : -3;
    send('pointermove', from[0] + (to[0] - from[0]) * at / 8, from[1] + (to[1] - from[1]) * at / 8 + wobble, 1);
  }
  send('pointerup', ...to, 0);
};

test('a ruled line keeps the kind: the nib one even width, the highlighter a straight band under the ink', async () => {
  const h = surfaceHarness({size: {width: 500, height: 700}, page: new pageModule.TabletPage(500 / 700)});
  draw(h, [100, 400], [300, 400]);
  await settle();
  const pen = h.page.strokes[0];

  h.tools.kind = 'fountain';
  rule(h, [100, 300], [300, 306]);
  await settle();
  assert.equal(h.page.strokes.length, 2);
  const line = h.page.strokes[1];
  assert.deepEqual(Object.keys(line), ['colorHex', 'width', 'points'], 'a ruled nib line has no pressures');
  const level = stroke => stroke.points.every(point => Math.abs(point.y - stroke.points[0].y) < 1e-12);
  assert.ok(line.points.length > 2 && level(line), 'it is straight and level');
  const levelWidth = 4.5 * 2 * kinds.nibLineScale(1, 0);
  assert.ok(Math.abs(line.width - levelWidth) < 1e-9, `the nib's width for a level line: ${line.width}`);

  h.tools.kind = 'highlighter';
  rule(h, [80, 400], [320, 396]);
  await settle();
  assert.equal(h.page.strokes.length, 3);
  const band = h.page.strokes[0];
  assert.deepEqual([...h.page.strokes.slice(1)], [pen, line]);
  assert.deepEqual(Object.keys(band), ['colorHex', 'width', 'points']);
  assert.ok(band.points.length > 2 && level(band), 'the band is ruled straight');
  assert.equal(band.colorHex, kinds.tintToward('#123456', '#ffffff'));
  assert.equal(band.width, 18 * 2);
});
