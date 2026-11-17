const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { surfaceHarness, load, pageModule, viewportModule, paperModule } = require('./helpers/tablet-surface.cjs');
const { TabletPage } = pageModule, { pointOnView, pointOnPage, pagePixelSize } = viewportModule;
const { snapshotDrawing, svgDrawing, rasterDrawing } = load('src/tablet/renderer/drawingSnapshot.ts');
const { paintBackdrop, backdropRect } = load('src/tablet/renderer/tabletBackdrop.ts');
const graphics = require('../src/graphics-pane.js');
const stage = { width: 1080, height: 1788 }, paper = { kind: 'dots', spacing: 'medium', colour: 'white' };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} equals ${b}`);
const stroke = points => ({ colorHex: '#123456', width: 3, points });

test('the actual surface fills both tablet-stage dimensions and writes every corner in all four rotations', () => {
  for (let turns = 0; turns < 4; turns++) {
    const h = surfaceHarness({ turns, size: stage });
    const style = h.find('tablet').props.style;
    assert.equal(style.left, 0);assert.equal(style.top, 0);assert.equal(style.width, stage.width);assert.equal(style.height, stage.height);
    for (const [x, y] of [[.5, .5], [1079.5, .5], [.5, 1787.5], [1079.5, 1787.5]]) {
      h.pointer('pointerdown', x, y);h.pointer('pointerup', x, y);
      const point = pointOnView(h.page.strokes.at(-1).points[0], h.page.viewport);
      near(point.x, x / stage.width);near(point.y, y / stage.height);
    }
    assert.equal(h.page.strokes.length, 4);
    assert.ok(h.page.strokes.some(s => s.points.some(p => p.y < 0 || p.y > 1)), 'the added margin is real ink, beyond the old A5 paper');
    const saved = graphics.decode(graphics.encode({ name: 'Corners', aspect: h.page.aspect, strokes: h.page.strokes, extent: h.page.extent }));
    const restored = new TabletPage(saved.aspect);restored.strokes = saved.strokes;restored.restoreExtent(saved.extent);
    const after = restored.fitViewport(stage);
    near(after.x, h.page.viewport.x);near(after.y, h.page.viewport.y);near(after.width, h.page.viewport.width);near(after.height, h.page.viewport.height);
    h.unmount();
  }
});

test('repeated viewport changes preserve handwriting shape, stroke identity and undo snapshots', () => {
  const page = new TabletPage(.6494444444444445);
  const square = stroke([{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .2 + .2 * page.aspect }]);
  for (const point of square.points) Object.freeze(point);Object.freeze(square.points);Object.freeze(square);
  page.add(square);const state = page.exportState(), extent = page.extent, h = surfaceHarness({ page }), original = { ...page.viewport };
  for (let i = 0; i < 10; i++) for (const size of [{ width: 1788, height: 1080 }, { width: 460, height: 700 }, stage]) {
    h.resize(size);
    const pixels = pagePixelSize(size, page.viewport);
    near(.2 * pixels.width, .2 * page.aspect * pixels.height);
    assert.equal(page.strokes, state.strokes);assert.equal(page.strokes[0], square);assert.equal(page.extent, extent);
    assert.equal(page.exportState().past, state.past);assert.equal(page.exportState().future, state.future);
  }
  near(page.viewport.x, original.x);near(page.viewport.y, original.y);near(page.viewport.width, original.width);near(page.viewport.height, original.height);
  assert.equal(page.aspect, .6494444444444445);assert.equal(page.undo(), true);assert.equal(page.strokes.length, 0);assert.equal(page.redo(), true);assert.equal(page.strokes[0], square);
  h.unmount();
});

test('selection and erasing use the newly exposed paper in every rotation', () => {
  for (let turns = 0; turns < 4; turns++) {
    const h = surfaceHarness({ turns });
    h.pointer('pointerdown', 40, 10);h.pointer('pointermove', 100, 25);h.pointer('pointerup', 180, 30);
    assert.equal(h.page.strokes.length, 1);assert.equal(h.page.strokes[0].points.length, 3, 'the final lift position is retained');
    h.tools.select = true;h.pointer('pointerdown', 10, 1);h.pointer('pointermove', 220, 55);h.pointer('pointerup', 220, 55);
    assert.ok(h.props.box.y < 0);const shown = h.find('box').props.style;
    near(parseFloat(shown.left), 10 / 1080 * 100);near(parseFloat(shown.top), 1 / 1788 * 100);
    h.tools.eraser = true;h.pointer('pointerdown', 100, 25);h.pointer('pointerup', 100, 25);assert.equal(h.page.strokes.length, 0);
    h.unmount();
  }
});

test('removing the tablet surface commits its in-flight stroke on its original sheet', () => {
  const h = surfaceHarness();h.pointer('pointerdown', 20, 20);h.pointer('pointermove', 400, 900);
  assert.equal(h.page.strokes.length, 0);h.unmount();assert.equal(h.page.strokes.length, 1);assert.equal(h.page.strokes[0].points.length, 2);
  assert.equal(h.page.undo(), true);assert.equal(h.page.strokes.length, 0);
});

test('pointer cancellation keeps existing ink without appending arbitrary cancellation coordinates', () => {
  for (const pointerType of ['mouse', 'pen']) {
    const h = surfaceHarness();h.pointer('pointerdown', 200, 300, 1, pointerType);h.pointer('pointermove', 500, 800, 1, pointerType);
    h.pointer('pointercancel', 0, 0, 0, pointerType);
    assert.equal(h.page.strokes.length, 1);assert.equal(h.page.strokes[0].points.length, 2);
    const end = pointOnView(h.page.strokes[0].points[1], h.page.viewport);near(end.x, 500 / 1080);near(end.y, 800 / 1788);
    h.unmount();
  }
});

test('exports, editable sidecars and a differently shaped backdrop share the full-paper transform', async () => {
  const h = surfaceHarness(), page = h.page;
  page.backdrop = 'data:image/png;base64,aGVsbG8=';
  const image = { naturalWidth: 2000, naturalHeight: 1000 }, picture = backdropRect(page.aspect, 2);
  page.add(stroke([{ x: picture.x, y: picture.y }, { x: picture.x + picture.width, y: picture.y + picture.height }]));
  const corner = pointOnPage({ x: .01, y: .01 }, page.viewport);page.add(stroke([corner]));
  const snapshot = snapshotDrawing({ name: 'Expanded', aspect: page.aspect, strokes: page.strokes, viewport: page.viewport, backdrop: page.backdrop, paper });
  const svg = svgDrawing(snapshot), viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  near(viewBox[2] / viewBox[3], stage.width / stage.height);
  const images = [], ink = [], ctx = { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, drawImage(...args) { images.push(args); } };
  const canvas = { getContext: () => ctx };
  await rasterDrawing(snapshot, true, { canvas: () => canvas, paintPaper: paperModule.paintPaper, backdropReady: async () => image, paintBackdrop,
    paintStrokes(_ctx, strokes, toPixel) { for (const s of strokes) ink.push(...s.points.map(toPixel)); }, inkOn: (_p, c) => c });
  assert.ok(Math.abs(canvas.width / canvas.height - stage.width / stage.height) <= 1 / canvas.height, 'raster dimensions differ only by whole-pixel rounding');
  const area = snapshot.region, shown = pointOnView({ x: picture.x, y: picture.y }, area);
  near(images[0][1], shown.x * canvas.width);near(images[0][2], shown.y * canvas.height);
  near(ink[0].x, picture.x * 1000);near(ink[0].y, picture.y * 1000 / page.aspect);

  const source = fs.readFileSync('src/tablet-entry.tsx', 'utf8'), implementation = source.slice(source.indexOf(' const editableSheet='), source.indexOf(' const insert='));
  const context = { graphics, btoa: value => Buffer.from(value).toString('base64') };
  vm.runInNewContext(implementation + ';globalThis.editable = editableSheet;', context);
  const editable = context.editable(true, snapshot), restored = graphics.decode(graphics.encode(editable));
  near(restored.aspect, stage.width / stage.height);
  near(restored.strokes[0].points[0].x, shown.x);near(restored.strokes[0].points[0].y, shown.y);
  near(restored.strokes[1].points[0].x, .01);near(restored.strokes[1].points[0].y, .01);
  const backdrop = Buffer.from(restored.backdrop.split(',')[1], 'base64').toString();
  assert.ok(backdrop.includes(`viewBox="${viewBox.join(' ')}"`));assert.match(backdrop, /preserveAspectRatio="xMidYMid meet"/);
  h.unmount();
});

test('paper marks continue into writable margins without changing their original phase', () => {
  for (const kind of ['dots', 'isometric', 'grid', 'lines']) {
    const marks = paperModule.paperMarks({ ...paper, kind }, { width: 1000, height: 1500 }, { x: -100, y: -100, width: 1200, height: 1700 });
    if (marks.dots.length) assert.ok(marks.dots.some(p => p.x < 0 || p.y < 0));
    else assert.ok(marks.lines.some(line => line.x0 < 0 || line.y0 < 0));
  }
});

test('a rescan repaints a changed backdrop on the same page without requiring a resize', () => {
  const h = surfaceHarness(), context = h.find('paper').props.ref.current.getContext('2d');
  let paints = 0;const fill = context.fillRect;context.fillRect = (...args) => { paints++;fill(...args); };
  h.page.backdrop = 'data:image/png;base64,bmV3';h.render();
  assert.ok(paints > 0, 'the paper effect follows backdrop identity as well as page identity');
  h.unmount();
});
