// Async captures and saves read the same synchronous model snapshot as UI actions.
// React observes this store; queued React renders never become the source of truth.
class CameraModels {
  constructor(pages, {id = () => globalThis.crypto.randomUUID()} = {}) {
    const identities = new WeakMap();
    const normalize = items => {
      if (!Array.isArray(items) || !items.length) throw Error('At least one camera page must remain open.');
      const used = new Set();
      return items.map(item => {
        if (!item?.page || typeof item.page !== 'object') throw Error('Invalid camera page model.');
        const pageId = item.pageId || identities.get(item.page) || id();
        if (used.has(pageId)) throw Error('Duplicate camera page identity.');
        used.add(pageId); identities.set(item.page, pageId);
        return item.pageId === pageId ? item : {...item,pageId};
      });
    };
    this.pages = normalize(pages);
    this.listeners = new Set();
    this.getSnapshot = () => this.pages;
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.update = change => {
      const next = typeof change === 'function' ? change(this.pages) : change;
      if (next !== this.pages) { this.pages = normalize(next); for (const listener of this.listeners) listener(); }
      return this.pages;
    };
  }
  get current() { return this.pages; }
}
module.exports = {CameraModels};
