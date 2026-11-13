((root, factory) => { if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.sidebarOrder = factory(); })(globalThis, () => {
  const key = path => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  function sortItems(items, order = []) {
    const positions = new Map(order.map((path, index) => [key(path), index]));
    return items.map((item, index) => ({ item, index, position: positions.get(key(item.path)) })).sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.index - b.index).map(entry => entry.item);
  }
  function reorder(paths, source, target, after = false) {
    if (key(source) === key(target)) return [...paths];
    const result = paths.filter(path => key(path) !== key(source)), index = result.findIndex(path => key(path) === key(target));
    if (index < 0) return [...paths];
    result.splice(index + (after ? 1 : 0), 0, source); return result;
  }
  function remap(orders, from, to) {
    const source = key(from); const change = path => { const normal = key(path); return normal === source || normal.startsWith(source + '/') ? to + path.slice(from.length) : path; };
    return Object.fromEntries(Object.entries(orders).map(([parent, paths]) => [change(parent), paths.map(change)]));
  }
  return { sortItems, reorder, remap };
});
