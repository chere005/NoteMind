// "Writing" with nothing boxed brings in the page's width and the ink's height, not the whole sheet.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {load} = require('./helpers/tablet-surface.cjs');
const {writingRegion} = load('src/tablet/renderer/drawingSnapshot.ts');
const stroke = (...points) => ({colorHex: '#000000', width: 2, points: points.map(([x, y]) => ({x, y}))});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a sheet with no ink has no writing region', () => {
  assert.equal(writingRegion([], 1.4), null);
});

test('the region keeps the page width and crops to the ink with a margin of 2% of the page width', () => {
  const region = writingRegion([stroke([.3, .3], [.5, .4])], 2);
  near(region.x, 0);
  near(region.width, 1);
  near(region.y, .3 - .04);
  near(region.height, .1 + .08);
});

test('ink at the page edge keeps the full region margin', () => {
  const region = writingRegion([stroke([-.1, .01], [1.2, .99])], 1);
  near(region.x, -.12);
  near(region.x + region.width, 1.22);
  near(region.y, -.01);
  near(region.y + region.height, 1.01);
});
