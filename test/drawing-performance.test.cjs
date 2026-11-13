const { test } = require('node:test'), assert = require('node:assert/strict');
const { buildSync } = require('esbuild'), vm = require('node:vm'), path = require('node:path');
const result = buildSync({ entryPoints: ['src/tablet/renderer/tabletPage.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, alias: { '@notemind/core': path.resolve('src/tablet/core.js') } });
const moduleValue = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module: moduleValue, exports: moduleValue.exports, require, process });
const { paintStrokes, strokeUnder } = moduleValue.exports;

test('a long stroke paints only newly received samples and preserves pressure indices', () => {
  const points = Array.from({ length: 100000 }, (_, i) => ({ x: i / 100000, y: .5 })), widths = [];
  const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() { widths.push(this.lineWidth); } };
  let converted = 0;
  paintStrokes(ctx, [{ colorHex: '#111111', width: 3, points, pressures: points.map((_, i) => i < 99998 ? 0 : .75) }], p => { converted++; return p; }, 1, undefined, 99999);
  assert.equal(converted, 2);
  assert.equal(widths.length, 1);
  assert.ok(widths[0] > 3);
});

test('cached hit testing avoids scanning points outside nearby stroke bounds', t => {
  let reads = 0;
  const strokes = Array.from({ length: 10000 }, () => ({ colorHex: '#111111', width: 2, points: Array.from({ length: 20 }, (_, i) => ({ get x() { reads++; return .1 + i / 1000; }, y: .1 })) }));
  strokeUnder(strokes, { x: .9, y: .9 }, { width: 1000, height: 1000 }, 8);
  reads = 0;
  const started = performance.now();
  for (let i = 0; i < 60; i++) assert.equal(strokeUnder(strokes, { x: .9, y: .9 }, { width: 1000, height: 1000 }, 8), -1);
  assert.equal(reads, 0);
  t.diagnostic('10,000 strokes / 200,000 points: ' + ((performance.now() - started) / 60).toFixed(2) + ' ms per cached eraser miss');
});

test('image previews reuse binary URLs, release unused assets and keep large data out of editor markup', () => {
  const previews = require('../src/image-previews.js').create(), render = require('../src/document-renderer.cjs');
  const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(1000000) + '</svg>').toString('base64');
  const url = previews.url('assets/a.svg', data, 'image/svg+xml');
  assert.equal(previews.url('assets/b.svg', data, 'image/svg+xml'), url);
  const html = render.render('![A](assets/a.svg)\n\n![B](assets/b.svg)', { 'assets/a.svg': data, 'assets/b.svg': data }, {}, previews.url);
  assert.ok(html.length < 1000);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /base64/);
  previews.retain({});
  assert.notEqual(previews.url('assets/a.svg', data, 'image/svg+xml'), url);
  previews.clear();
});

test('dirty-state signatures reuse old stroke fingerprints and replace duplicated ink snapshots', () => {
  const output = buildSync({ entryPoints: ['src/tablet/renderer/sheetSignature.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports });
  const { sheetSignature, savedSignature } = module.exports;
  let reads = 0;
  const stroke = { colorHex: '#111111', width: 3, get points() { reads++;return [{ x: .2, y: .3 }]; } };
  const sheet = { name: 'Dense sheet', page: { aspect: 1.5, strokes: Array(10000).fill(stroke), backdrop: null }, paper: {} };
  const original = sheetSignature(sheet);reads = 0;
  assert.equal(sheetSignature(sheet), original);
  sheet.page.strokes = [...sheet.page.strokes, { ...stroke, width: 4 }];reads = 0;
  assert.notEqual(sheetSignature(sheet), original);
  assert.equal(reads, 0);
  assert.ok(original.length < 30);
  const legacy = JSON.stringify({ name: sheet.name, aspect: sheet.page.aspect, strokes: sheet.page.strokes, backdrop: null, paper: {} });
  assert.equal(savedSignature(legacy, sheet), sheetSignature(sheet));
});
