// Numeric resource ownership for immutable drawing keys. Empty pages are released.
// Keys stay weak; no per-resource object is retained and no numeric handle escapes.
class DrawingResourceLedger {
  constructor({ pageSize = 4096 } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 65536) throw TypeError('Invalid drawing resource page size.');
    this.pageSize = pageSize;
    this.keys = new WeakMap();
    this.pages = new Map();
    this.freePages = [];
    this.nextPage = 0;
    this.available = null;
    this._total = 0;
    this._extra = 0;
    this._size = 0;
  }
  get total() { return this._total; }
  get extra() { return this._extra; }
  get size() { return this._size; }
  get capacity() { return this.pages.size * this.pageSize; }
  get storageBytes() { return this.capacity * 16; }
  addAvailable(page) {
    page.previous = null;
    page.next = this.available;
    if (page.next) page.next.previous = page;
    this.available = page;
  }
  removeAvailable(page) {
    if (page.previous) page.previous.next = page.next;
    else this.available = page.next;
    if (page.next) page.next.previous = page.previous;
    page.previous = page.next = null;
  }
  allocate() {
    if (!this.available) {
      const id = this.freePages.length ? this.freePages.pop() : this.nextPage++;
      if (!Number.isSafeInteger(id * this.pageSize + this.pageSize - 1)) throw RangeError('Drawing resource capacity exceeded.');
      const page = { id, bytes: new Float64Array(this.pageSize), current: new Uint32Array(this.pageSize), history: new Uint32Array(this.pageSize), active: 0, free: 0, previous: null, next: null };
      // Free slots use their current field as a next-free link.
      for (let slot = 0; slot < this.pageSize; slot++) page.current[slot] = slot + 1;
      this.pages.set(id, page);
      this.addAvailable(page);
    }
    const page = this.available, slot = page.free;
    page.free = page.current[slot];
    page.current[slot] = 0;
    page.active++;
    if (page.free === this.pageSize) this.removeAvailable(page);
    return page.id * this.pageSize + slot;
  }
  adjust(key, bytes, kind, delta) {
    if ((typeof key !== 'object' || key === null) && typeof key !== 'function') throw TypeError('Invalid drawing resource key.');
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw TypeError('Invalid drawing resource byte size.');
    if (kind !== 'current' && kind !== 'history') throw TypeError('Invalid drawing resource owner.');
    if (!Number.isSafeInteger(delta) || !delta) throw TypeError('Invalid drawing resource ownership change.');
    let handle = this.keys.get(key), page, slot;
    if (handle === undefined) {
      if (delta < 0) throw Error('Invalid drawing resource release.');
      if (delta > 0xffffffff) throw RangeError('Drawing resource ownership overflow.');
      if (!Number.isSafeInteger(this._total + bytes)) throw RangeError('Drawing resource byte accounting overflow.');
      handle = this.allocate();
      page = this.pages.get(Math.floor(handle / this.pageSize));
      slot = handle % this.pageSize;
      page.bytes[slot] = bytes;
      this.keys.set(key, handle);
      this._size++;
    } else {
      page = this.pages.get(Math.floor(handle / this.pageSize));
      slot = handle % this.pageSize;
      if (page.bytes[slot] !== bytes) throw Error('Immutable drawing resource size changed.');
    }
    const beforeCurrent = page.current[slot], beforeHistory = page.history[slot], values = page[kind], next = values[slot] + delta;
    if (next < 0 || next > 0xffffffff) throw RangeError('Invalid drawing resource ownership count.');
    const beforeUsed = beforeCurrent > 0 || beforeHistory > 0;
    const beforeExtra = beforeCurrent === 0 && beforeHistory > 0;
    values[slot] = next;
    const afterCurrent = page.current[slot], afterHistory = page.history[slot];
    const afterUsed = afterCurrent > 0 || afterHistory > 0;
    const afterExtra = afterCurrent === 0 && afterHistory > 0;
    if (beforeUsed !== afterUsed) this._total += afterUsed ? bytes : -bytes;
    if (beforeExtra !== afterExtra) this._extra += afterExtra ? bytes : -bytes;
    if (!afterUsed) {
      this.keys.delete(key);
      this._size--;
      if (page.active === this.pageSize) this.addAvailable(page);
      page.bytes[slot] = 0;
      page.current[slot] = page.free;
      page.free = slot;
      page.active--;
      if (!page.active) {
        this.removeAvailable(page);
        this.pages.delete(page.id);
        this.freePages.push(page.id);
      }
    }
  }
}
module.exports = { DrawingResourceLedger };
