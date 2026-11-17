// Async captures and saves read the same synchronous model snapshot as UI actions.
// React observes this store; queued React renders never become the source of truth.
class CameraModels {
  constructor(pages) {
    this.pages = pages;
    this.listeners = new Set();
    this.getSnapshot = () => this.pages;
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.update = change => {
      const next = typeof change === 'function' ? change(this.pages) : change;
      if (!Array.isArray(next) || !next.length) throw Error('At least one camera page must remain open.');
      if (next !== this.pages) { this.pages = next; for (const listener of this.listeners) listener(); }
      return this.pages;
    };
  }
  get current() { return this.pages; }
}
module.exports = {CameraModels};
