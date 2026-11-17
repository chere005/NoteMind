// Published slot pages/directories are immutable; local patches copy only touched paths.
// Packed locator/count pairs are safe integers. Every published lookup needs at most128 probes.
const { yieldTask } = require("./graphics-pane.js");
const MAX_COUNT = 2e6, COUNT_RADIX = MAX_COUNT + 1, MAX_LOCATOR = 513 * COUNT_RADIX, MAX_CAPACITY = 4194304, PAGE_SHIFT = 8, PAGE_SIZE = 1 << PAGE_SHIFT, DIRECTORY_LEVEL = 2, PROBES = 128;
const abort = () => Object.assign(Error("Ink identities cancelled."), { name: "AbortError" }), now = () => globalThis.performance?.now() ?? Date.now();
class Pacer {
  constructor({ signal, yieldControl = yieldTask } = {}) {
    this.signal = signal;
    this.yieldControl = yieldControl;
    if (typeof yieldControl !== "function") throw Error("Invalid ink yield function.");
    this.work = 0;
    this.time = now();
    this.check();
  }
  check() {
    if (this.signal?.aborted) throw abort();
  }
  poll(n = 1) {
    this.work += n;
    return this.work >= 4096 || this.work % 256 === 0 && now() - this.time >= 3;
  }
  async pause() {
    this.check();
    await this.yieldControl();
    this.check();
    this.work = 0;
    this.time = now();
  }
}
const validId = (id) => Number.isSafeInteger(id) && id > 0;
function packed(locator, count) {
  if (!Number.isSafeInteger(locator) || locator < 0 || locator > MAX_LOCATOR || !Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) throw Error("Invalid ink identity entry.");
  const value = locator * COUNT_RADIX + count;
  if (!Number.isSafeInteger(value)) throw Error("Ink identity exceeds exact numeric range.");
  return value;
}
const unpack = (value) => {
  const locator = Math.floor(value / COUNT_RADIX);
  return { locator, count: value - locator * COUNT_RADIX };
};
function hash(id, seed) {
  let value = id >>> 0 ^ Math.imul(Math.floor(id / 4294967296), 2654435761) ^ seed;
  value = Math.imul(value ^ value >>> 16, 2246822507);
  value = Math.imul(value ^ value >>> 13, 3266489909);
  return (value ^ value >>> 16) >>> 0;
}
const seedOf = () => Math.floor(Math.random() * 4294967296) >>> 0;
function pageAt(root, index) {
  let node = root;
  for (let level = DIRECTORY_LEVEL; level >= 0; level--) {
    if (!node) return null;
    node = node[index >>> level * 5 & 31];
  }
  return node || null;
}
function setPage(root, index, page, owned, level = DIRECTORY_LEVEL) {
  let node = root;
  if (!node || !owned.has(node)) {
    node = node ? node.slice() : [];
    owned.add(node);
  }
  const slot = index >>> level * 5 & 31;
  node[slot] = level ? setPage(node[slot], index, page, owned, level - 1) : page;
  return node;
}
function* pagesOf(node, level = DIRECTORY_LEVEL, prefix = 0) {
  if (!node) return;
  for (let slot = 0; slot < node.length; slot++) {
    const child = node[slot];
    if (!child) continue;
    const index = prefix | slot << level * 5;
    if (level) yield* pagesOf(child, level - 1, index);
    else yield { index, page: child };
  }
}
function result(out, slot, found, probes, value) {
  out.slot = slot;
  out.found = found;
  out.probes = probes;
  out.value = value;
  return out;
}
const locatorOf = (value) => Math.floor(value / COUNT_RADIX), countOf = (value) => value - locatorOf(value) * COUNT_RADIX;
function find(state, id, out = {}) {
  const mask = state.capacity - 1, start = hash(id, state.seed) & mask;
  let tombstone = -1;
  for (let probe = 0; probe < Math.min(PROBES, state.capacity); probe++) {
    const slot = start + probe & mask, page = pageAt(state.root, slot >>> PAGE_SHIFT), offset = slot & PAGE_SIZE - 1, key = page?.keys[offset] || 0;
    if (key === id) return result(out, slot, true, probe + 1, page.values[offset]);
    if (key === -1 && tombstone < 0) tombstone = slot;
    if (key === 0) return result(out, tombstone < 0 ? slot : tombstone, false, probe + 1, 0);
  }
  return result(out, tombstone, false, Math.min(PROBES, state.capacity), 0);
}
class Mutable {
  constructor(state) {
    Object.assign(this, { root: state.root, capacity: state.capacity, seed: state.seed, size: state.size, totalCount: state.totalCount, tombstones: state.tombstones, pageCount: state.pageCount, maxProbe: state.maxProbe });
    this.probe = {};
    this.ownedNodes = /* @__PURE__ */ new WeakSet();
    this.changedPages = /* @__PURE__ */ new Map();
    this.changed = false;
  }
  write(slot, key, value) {
    const index = slot >>> PAGE_SHIFT;
    let page = this.changedPages.get(index);
    if (!page) {
      const old = pageAt(this.root, index);
      page = { keys: old ? old.keys.slice() : new Float64Array(PAGE_SIZE), values: old ? old.values.slice() : new Float64Array(PAGE_SIZE) };
      if (!old) this.pageCount++;
      this.changedPages.set(index, page);
      this.root = setPage(this.root, index, page, this.ownedNodes);
    }
    const offset = slot & PAGE_SIZE - 1;
    page.keys[offset] = key;
    page.values[offset] = value;
    this.changed = true;
  }
  put(id, locator, count) {
    const found = find(this, id, this.probe);
    this.maxProbe = Math.max(this.maxProbe, found.probes);
    if (found.slot < 0) return false;
    if (found.found) {
      const previousCount = countOf(found.value);
      if (!count) {
        this.write(found.slot, -1, 0);
        this.size--;
        this.totalCount -= previousCount;
        this.tombstones++;
      } else {
        const value = packed(locator, count);
        if (value !== found.value) {
          this.write(found.slot, id, value);
          this.totalCount += count - previousCount;
        }
      }
    } else if (count) {
      const previousKey = pageAt(this.root, found.slot >>> PAGE_SHIFT)?.keys[found.slot & PAGE_SIZE - 1] || 0;
      this.write(found.slot, id, packed(locator, count));
      this.size++;
      this.totalCount += count;
      if (previousKey === -1) this.tombstones--;
    }
    return true;
  }
  finish() {
    if (!this.size) {
      Object.assign(this, empty(16, this.seed));
    }
    const next = Object.create(PersistentInkIdentity.prototype);
    for (const key of ["root", "capacity", "seed", "size", "totalCount", "tombstones", "pageCount", "maxProbe"]) next[key] = this[key];
    next.copiedPages = this.changedPages.size;
    return next;
  }
}
function empty(capacity = 16, seed = seedOf()) {
  return { root: null, capacity, seed: seed >>> 0, size: 0, totalCount: 0, tombstones: 0, pageCount: 0, maxProbe: 0 };
}
async function rehash(source, capacity, pacer) {
  if (capacity > MAX_CAPACITY) throw Error("Too many ink identities.");
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = new Mutable(empty(capacity, hash(source.seed + attempt + 1, seedOf())));
    let overflow = false;
    outer: for (const { page } of pagesOf(source.root)) for (let index = 0; index < PAGE_SIZE; index++) {
      const id = page.keys[index];
      if (id > 0) {
        const value = page.values[index];
        if (!target.put(id, locatorOf(value), countOf(value))) {
          overflow = true;
          break outer;
        }
      }
      if (pacer.poll()) await pacer.pause();
    }
    if (!overflow) {
      pacer.check();
      return target;
    }
  }
  throw Error("Ink identity collision budget exceeded.");
}
function paced(builder, pacer, work) {
  return pacer.poll(work) ? pacer.pause().then(() => builder) : builder;
}
function finishPut(builder, id, locator, count, pacer, work) {
  if (builder.put(id, locator, count)) return paced(builder, pacer, work);
  return rehash(builder, builder.capacity, pacer).then((next) => {
    if (!next.put(id, locator, count)) throw Error("Ink identity collision budget exceeded.");
    return paced(next, pacer, work);
  });
}
function putGrowing(builder, id, locator, count, pacer) {
  if (!validId(id) || !Number.isSafeInteger(count) || count < 0 || count > MAX_COUNT) throw Error("Invalid ink identity entry.");
  if (count) packed(locator, count);
  const found = find(builder, id, builder.probe), work = found.probes;
  if (!found.found && !count) return paced(builder, pacer, work);
  const oldCount = found.found ? countOf(found.value) : 0;
  if (builder.totalCount - oldCount + count > MAX_COUNT) throw Error("Too many ink identity occurrences.");
  if (!found.found && count && (builder.size + 1 > builder.capacity * 2 / 3 || builder.size + builder.tombstones + 1 > builder.capacity * 3 / 4)) {
    const capacity = builder.size + 1 > builder.capacity * 2 / 3 ? builder.capacity * 2 : builder.capacity;
    return rehash(builder, capacity, pacer).then((next) => finishPut(next, id, locator, count, pacer, work));
  }
  return finishPut(builder, id, locator, count, pacer, work);
}
class PersistentInkIdentity {
  static async build(entries, { idOf, seed = seedOf(), ...options } = {}) {
    if (!entries || typeof entries[Symbol.iterator] !== "function" || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw Error("Invalid ink identity entries.");
    const pacer = new Pacer(options);
    let capacity = 16;
    if (Number.isSafeInteger(entries.length)) {
      if (entries.length > MAX_COUNT) throw Error("Too many ink identity occurrences.");
      while (capacity < Math.max(1, entries.length) * 1.5) capacity *= 2;
    }
    let builder = new Mutable(empty(capacity, seed));
    for (const raw of entries) {
      let id, locator, count;
      if (typeof raw === "number") {
        if (typeof idOf !== "function") throw Error("Ink identity resolver is missing.");
        locator = raw;
        id = idOf(raw);
        count = 1;
      } else {
        if (!raw || typeof raw !== "object") throw Error("Invalid ink identity entry.");
        locator = raw.locator;
        id = raw.id ?? idOf?.(locator);
        count = raw.count ?? 1;
      }
      if (!validId(id) || !Number.isSafeInteger(count) || count < 0 || count > MAX_COUNT) throw Error("Invalid ink identity entry.");
      const old = find(builder, id, builder.probe);
      if (old.found) {
        if (locatorOf(old.value) !== locator) throw Error("An ink identity has conflicting locators.");
        count += countOf(old.value);
      }
      const pending = putGrowing(builder, id, locator, count, pacer);
      builder = typeof pending.then === "function" ? await pending : pending;
    }
    pacer.check();
    return builder.finish();
  }
  locator(id) {
    const value = this.value(id);
    return value ? Math.floor(value / COUNT_RADIX) : -1;
  }
  count(id) {
    const value = this.value(id);
    return value - Math.floor(value / COUNT_RADIX) * COUNT_RADIX;
  }
  value(id) {
    if (!validId(id)) return 0;
    const mask = this.capacity - 1, start = hash(id, this.seed) & mask;
    for (let probe = 0; probe < Math.min(PROBES, this.capacity); probe++) {
      const slot = start + probe & mask, page = pageAt(this.root, slot >>> PAGE_SHIFT), offset = slot & PAGE_SIZE - 1, key = page?.keys[offset] || 0;
      if (key === id) return page.values[offset];
      if (!key) return 0;
    }
    return 0;
  }
  async patch(changes, options = {}) {
    if (!changes || typeof changes[Symbol.iterator] !== "function") throw Error("Invalid ink identity patch.");
    const pacer = new Pacer(options);
    let builder = new Mutable(this);
    for (const entry of changes) {
      if (!entry || typeof entry !== "object") throw Error("Invalid ink identity patch.");
      const pending = putGrowing(builder, entry.id, entry.locator, entry.count, pacer);
      builder = typeof pending.then === "function" ? await pending : pending;
    }
    pacer.check();
    return builder.changed ? builder.finish() : this;
  }
  *entries() {
    for (const { page } of pagesOf(this.root)) for (let index = 0; index < PAGE_SIZE; index++) if (page.keys[index] > 0) {
      const value = unpack(page.values[index]);
      yield { id: page.keys[index], ...value };
    }
  }
  get stats() {
    return { capacity: this.capacity, pages: this.pageCount, typedBytes: this.pageCount * PAGE_SIZE * 16, tombstones: this.tombstones, maxProbe: this.maxProbe, copiedPages: this.copiedPages || 0 };
  }
}
module.exports = { PersistentInkIdentity, MAX_COUNT, MAX_LOCATOR, COUNT_RADIX, PAGE_SIZE, PROBES };
