const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortItems, reorder, remap } = require('../src/sidebar-order.js');
test('manual sibling order survives fresh directory listings and new entries', () => {
  const paths = ['C:\\notes\\b.wm', 'C:\\notes\\a.wm', 'C:\\notes\\c.wm'];
  const order = reorder(paths, paths[2], paths[0]);
  assert.deepEqual(order, [paths[2], paths[0], paths[1]]);
  const later = [paths[1], paths[0], paths[2], 'C:\\notes\\new.wm'].map(path => ({ path }));
  assert.deepEqual(sortItems(later, order).map(item => item.path), [...order, 'C:\\notes\\new.wm']);
});
test('renaming a section updates its stored order and descendants', () => {
  assert.deepEqual(remap({ 'C:\\notes': ['C:\\notes\\old'], 'C:\\notes\\old': ['C:\\notes\\old\\a.wm'] }, 'C:\\notes\\old', 'C:\\notes\\new'), { 'C:\\notes': ['C:\\notes\\new'], 'C:\\notes\\new': ['C:\\notes\\new\\a.wm'] });
});
