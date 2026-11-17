const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DrawingResourceLedger } = require('../src/drawing-resource-ledger.js');

test('charges a shared key once and only history-exclusive bytes as extra', () => {
  const ledger = new DrawingResourceLedger({ pageSize: 2 }), a = {}, b = {};
  ledger.adjust(a, 64, 'current', 1);
  ledger.adjust(a, 64, 'history', 2);
  ledger.adjust(b, 32, 'history', 1);
  assert.deepEqual([ledger.total, ledger.extra, ledger.size], [96, 32, 2]);
  ledger.adjust(a, 64, 'current', -1);
  assert.equal(ledger.extra, 96);
  ledger.adjust(a, 64, 'history', -1);
  assert.equal(ledger.extra, 96);
  ledger.adjust(a, 64, 'history', -1);
  ledger.adjust(b, 32, 'history', -1);
  assert.deepEqual([ledger.total, ledger.extra, ledger.size, ledger.capacity, ledger.storageBytes], [0, 0, 0, 0, 0]);
});

test('reclaims empty pages and safely reuses weak keys and freed slots', () => {
  const ledger = new DrawingResourceLedger({ pageSize: 3 }), keys = Array.from({ length: 8 }, () => ({}));
  for (const key of keys) ledger.adjust(key, 16, 'current', 1);
  assert.equal(ledger.storageBytes, 9 * 16);
  for (const key of keys.slice(0, 3)) ledger.adjust(key, 16, 'current', -1);
  assert.equal(ledger.capacity, 6);
  const other = {};
  ledger.adjust(other, 24, 'history', 1);
  ledger.adjust(keys[0], 16, 'current', 1);
  assert.equal(ledger.total, 120);
  assert.equal(ledger.extra, 24);
  ledger.adjust(other, 24, 'history', -1);
  ledger.adjust(keys[0], 16, 'current', -1);
  for (const key of keys.slice(3)) ledger.adjust(key, 16, 'current', -1);
  assert.equal(ledger.capacity, 0);
  assert.equal(ledger.size, 0);
});

test('partial-page churn stays bounded without retaining a record per key', () => {
  const ledger = new DrawingResourceLedger({ pageSize: 4 }), anchor = {};
  ledger.adjust(anchor, 8, 'current', 1);
  for (let i = 0; i < 10000; i++) {
    const key = {};
    ledger.adjust(key, 48, 'history', 1);
    ledger.adjust(key, 48, 'history', -1);
  }
  assert.deepEqual([ledger.total, ledger.extra, ledger.size, ledger.capacity], [8, 0, 1, 4]);
  ledger.adjust(anchor, 8, 'current', -1);
  assert.equal(ledger.storageBytes, 0);
});

test('matches an independent reference union across mixed ownership transitions', () => {
  const ledger = new DrawingResourceLedger({ pageSize: 7 }), keys = Array.from({ length: 40 }, () => ({})), states = keys.map((_, i) => ({ current: 0, history: 0, bytes: i * 3 }));
  let seed = 0x9747b28c;
  for (let i = 0; i < 5000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const at = seed % keys.length, state = states[at], kind = seed & 256 ? 'history' : 'current', delta = state[kind] && seed & 512 ? -1 : 1;
    state[kind] += delta;
    ledger.adjust(keys[at], state.bytes, kind, delta);
    assert.equal(ledger.total, states.reduce((n, s) => n + (s.current || s.history ? s.bytes : 0), 0));
    assert.equal(ledger.extra, states.reduce((n, s) => n + (!s.current && s.history ? s.bytes : 0), 0));
  }
});

test('rejects invalid or inconsistent adjustments without changing live ownership', () => {
  const ledger = new DrawingResourceLedger(), key = {};
  assert.throws(() => ledger.adjust(key, 8, 'current', -1));
  assert.throws(() => ledger.adjust(null, 8, 'current', 1));
  assert.throws(() => ledger.adjust(key, 8, 'current', 0));
  assert.throws(() => ledger.adjust(key, 8, 'other', 1));
  assert.throws(() => ledger.adjust(key, Infinity, 'current', 1));
  ledger.adjust(key, 8, 'current', 1);
  assert.throws(() => ledger.adjust(key, 16, 'current', 1));
  assert.throws(() => ledger.adjust(key, 8, 'current', -2));
  assert.throws(() => ledger.adjust(key, 8, 'current', 0xffffffff));
  assert.deepEqual([ledger.total, ledger.extra, ledger.size], [8, 0, 1]);
  ledger.adjust(key, 8, 'current', -1);
  assert.equal(ledger.capacity, 0);
});
