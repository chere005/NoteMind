const { test } = require('node:test');
const assert = require('node:assert/strict');
const graphics = require('../src/graphics-pane.js');
const renderer = require('../src/document-renderer.cjs');
const stroke = (points, extra = {}) => ({ colorHex: '#112233', width: 3, points, ...extra });

test('compact graphics storage preserves thousands of points, widths and pressures', () => {
  const points = Array.from({ length: 5000 }, (_, i) => ({ x: i / 5000, y: .5 }));
  const sheet = { name: 'Drawing', aspect: 1.5, strokes: [stroke(points, { pressures: points.map(() => .7) })], backdrop: null };
  const encoded = graphics.encode(sheet), decoded = graphics.decode(encoded);
  assert.deepEqual(decoded.strokes, sheet.strokes);
  assert.ok(encoded.length < JSON.stringify(sheet).length * .8);
  assert.throws(() => graphics.decode({ format: 'notemind-graphics', version: 2, strokes: [] }), /Unsupported/);
  assert.throws(() => graphics.encode({ ...sheet, strokes: [stroke([{ x: NaN, y: 0 }])] }), /Invalid/);
  assert.throws(() => graphics.encode({ ...sheet, strokes: [stroke(points, { pressures: [] })] }), /Invalid/);
});

test('moving and resizing selected ink leaves other strokes and the original data intact', () => {
  const chosen = stroke([{ x: .2, y: .2 }, { x: .3, y: .3 }]), outside = stroke([{ x: .8, y: .8 }]);
  const box = { x: .1, y: .1, width: .3, height: .3 };
  const moved = graphics.transform([chosen, outside], box, { ...box, x: .3 });
  assert.ok(Math.abs(moved[0].points[0].x - .4) < 1e-9);
  assert.equal(moved[1], outside);
  assert.equal(chosen.points[0].x, .2);
  assert.equal(moved[0].width, 3);
});

test('selection capture clips crossing strokes and retains pressure at the boundaries', () => {
  const sheet = { name: 'Drawing', aspect: 1, strokes: [stroke([{ x: 0, y: .5 }, { x: 1, y: .5 }], { pressures: [0, 1] })] };
  const cropped = graphics.crop(sheet, { x: .25, y: .25, width: .5, height: .5 });
  assert.deepEqual(cropped.strokes[0].points, [{ x: 0, y: .5 }, { x: 1, y: .5 }]);
  assert.deepEqual(cropped.strokes[0].pressures, [.25, .75]);
  assert.equal(cropped.strokes[0].width, 6);
});

test('a pane renders as one preview and keeps only its Markdown image when serialized', () => {
  const name = 'assets/drawing.svg', text = 'Before\n\n![Drawing](' + name + ')\n\nAfter';
  const html = renderer.render(text, { [name]: Buffer.from('<svg/>').toString('base64'), [name + '.json']: '{}' }, {});
  assert.match(html, /class="graphics-pane"/);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.match(html, /Edit in Wacom/);
  assert.equal(renderer.toMarkdown(html).trim(), text);
});

test('library recovery and Markdown exports preserve pane metadata and preview-sidecar pairs', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { NotesStore } = require('../src/notes-store.cjs'), markdown = require('../src/markdown-files.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notemind-graphics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const name = 'assets/drawing.svg', sheet = { name: 'Drawing', aspect: .75, strokes: [stroke([{ x: .2, y: .3 }])] };
  const original = { text: '![Drawing](' + name + ')', assets: { [name]: Buffer.from('<svg/>').toString('base64'), [name + '.json']: Buffer.from(graphics.encode(sheet)).toString('base64') }, meta: { graphicsPanes: { [name]: { version: 1 } } } };
  const store = new NotesStore(path.join(root, 'library'));
  const registered = await store.draft(original), recovered = await store.loadDraft(registered.id);
  assert.deepEqual(recovered.meta.graphicsPanes, original.meta.graphicsPanes);
  const file = path.join(root, 'Export.md'), saved = await markdown.prepare(recovered, file);
  await fs.writeFile(file, saved.text);
  const reopened = await markdown.read(file, saved.text), canonical = markdown.canonical(reopened);
  for (const doc of [reopened, canonical]) {
    const preview = markdown.references(doc.text)[0];
    assert.equal(doc.meta.graphicsPanes[preview].version, 1);
    assert.deepEqual(graphics.decode(Buffer.from(doc.assets[preview + '.json'], 'base64').toString()).strokes, sheet.strokes);
    assert.match(renderer.render(doc.text, doc.assets, doc.meta), /graphics-pane/);
  }
});
