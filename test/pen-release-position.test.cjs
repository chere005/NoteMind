const { test } = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./helpers/tablet-surface.cjs');
const { createDispatcher } = load('src/tablet/renderer/penFeed.ts', { window: { addEventListener() {}, notemind: { preferenceGet: async () => null, onPreference() {} } } });

function dispatcher() {
  const events = [], target = { isConnected: true };
  return { events, feed: createDispatcher({
    sheetRect: () => ({ left: 10, top: 20, width: 1000, height: 800 }), turns: () => 0,
    elementAt: () => target, fallbackTarget: () => target, modifiers: () => ({}), clickable: () => null,
    dispatch(_target, event) { events.push(event); },
  }) };
}
const sample = (x, y, tip, inRange = true) => ({ t: 1, x, y, p: tip ? .6 : 0, tip, inRange, lower: false, upper: false, eraser: false });

test('out-of-range reports release at the last valid coordinate, including invalid zeroed HID fields', () => {
  for (const [x, y] of [[0, 0], [NaN, Infinity]]) {
    const { feed, events } = dispatcher();
    feed.batch([sample(.3, .4, true), sample(x, y, false, false)]);
    const up = events.find(event => event.type === 'pointerup');
    assert.equal(up.clientX, 310);assert.equal(up.clientY, 340);assert.equal(feed.inRange, false);
  }
});

test('a valid in-range lift retains its new endpoint while an explicit reset retains the last position', () => {
  const { feed, events } = dispatcher();feed.batch([sample(.3, .4, true), sample(.6, .7, false)]);
  let up = events.find(event => event.type === 'pointerup');assert.equal(up.clientX, 610);assert.equal(up.clientY, 580);
  events.length = 0;feed.batch([sample(.2, .5, true)]);feed.reset();
  up = events.find(event => event.type === 'pointerup');assert.equal(up.clientX, 210);assert.equal(up.clientY, 420);
});
