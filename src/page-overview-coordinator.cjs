const { yieldTask } = require("./graphics-pane.js");
const { thumbnailMetadata } = require("./overview-thumbnail-client.cjs");
const abort = () => Object.assign(Error("Page overview cancelled."), { name: "AbortError" }), check = (signal) => {
  if (signal?.aborted) throw abort();
};
const idOf = (page) => page?.pageId;
function validPages(pages) {
  if (!Array.isArray(pages) || pages.length > 4096) throw Error("Invalid page overview.");
  const ids = /* @__PURE__ */ new Set();
  for (const page of pages) {
    const id = idOf(page);
    if (typeof id !== "string" || !id || id.length > 128 || /[\x00-\x1f]/.test(id) || ids.has(id)) throw Error("Invalid page overview identity.");
    ids.add(id);
  }
  return ids;
}
function reorderPages(pages, id, beforeId) {
  validPages(pages);
  if (id === beforeId) return pages;
  const from = pages.findIndex((page) => idOf(page) === id);
  if (from < 0 || beforeId !== null && !pages.some((page) => idOf(page) === beforeId)) return pages;
  const next = pages.filter((page) => idOf(page) !== id), at = beforeId === null ? next.length : next.findIndex((page) => idOf(page) === beforeId);
  next.splice(at, 0, pages[from]);
  return next.every((page, index) => page === pages[index]) ? pages : next;
}
function stepBefore(pages, id, delta) {
  const at = pages.findIndex((page) => idOf(page) === id);
  if (at < 0 || !Number.isInteger(delta) || !delta) return void 0;
  const target = Math.max(0, Math.min(pages.length - 1, at + delta));
  if (target === at) return void 0;
  const rest = pages.filter((page) => idOf(page) !== id);
  return rest[target]?.pageId ?? null;
}
function visibleWindow(count, { scrollTop = 0, height = 600, width = 600, rowHeight = 190, minWidth = 160, gap = 12, overscan = 1 } = {}) {
  if (!Number.isInteger(count) || count < 0 || count > 4096 || ![scrollTop, height, width, rowHeight, minWidth, gap, overscan].every(Number.isFinite) || height < 0 || width < 0 || rowHeight <= 0 || minWidth <= 0 || gap < 0 || overscan < 0) throw Error("Invalid overview viewport.");
  const columns = Math.max(1, Math.min(12, Math.floor((width + gap) / (minWidth + gap)))), rows = Math.ceil(count / columns), first = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - Math.floor(overscan)), last = Math.min(rows, Math.ceil((Math.max(0, scrollTop) + height) / rowHeight) + Math.floor(overscan));
  return { columns, rows, firstRow: first, lastRow: last, start: Math.min(count, first * columns), end: Math.min(count, last * columns), totalHeight: rows * rowHeight, rowHeight };
}
async function loadOverviewPage(api, pageId, { signal, maxBytes = 256 * 1024 * 1024, yieldControl = yieldTask } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) throw Error("Invalid overview source budget.");
  check(signal);
  const chunks = !!(api.loadSheetChunk && api.finishSheetLoad), state = await api.loadSheetPage(pageId, chunks ? { chunks: true, background: true } : void 0), session = state.transferSession;
  try {
    check(signal);
    if (!Array.isArray(state.encodedSheets) || state.encodedSheets.length !== 1) throw Error("Invalid overview page response.");
    const source = state.encodedSheets[0];
    if (source.metadata?.pageId && source.metadata.pageId !== pageId) throw Error("Overview page ownership changed.");
    const packet = { metadata: source.metadata, owned: true };
    let total = 0;
    for (const key of ["bytes", "backdropBytes"]) {
      const value = source[key];
      if (value == null) continue;
      if (session) {
        if (!value.chunked || typeof value.key !== "string" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || (total += value.bytes) > maxBytes || !Number.isSafeInteger(state.chunkBytes) || state.chunkBytes < 1 || state.chunkBytes > 1024 * 1024) throw Error("Invalid overview page size.");
        const bytes = new Uint8Array(value.bytes);
        for (let at = 0; at < bytes.length; ) {
          check(signal);
          const part = await api.loadSheetChunk(session, value.key, at);
          check(signal);
          if (!ArrayBuffer.isView(part) || part.byteLength !== Math.min(state.chunkBytes, bytes.length - at)) throw Error("Invalid overview page chunk.");
          bytes.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), at);
          at += part.byteLength;
          await yieldControl();
        }
        packet[key] = bytes;
      } else {
        if (!ArrayBuffer.isView(value) || (total += value.byteLength) > maxBytes) throw Error("Invalid overview page size.");
        packet[key] = value;
        packet.owned = false;
      }
    }
    if (!packet.bytes) throw Error("Overview geometry is missing.");
    check(signal);
    return packet;
  } finally {
    if (session) await api.finishSheetLoad(session).catch(() => {
    });
  }
}
function smallExistingPreview(page) {
  const preview = page.preview, expected = page.revision ?? page.signature ?? page.geometryRevision;
  if (expected == null || !preview || preview.revision !== expected || typeof preview.data !== "string" || preview.data.length > 512 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]*={0,2}$/i.test(preview.data)) return null;
  try {
    const data = preview.data.slice(preview.data.indexOf(",") + 1), bytes = typeof Uint8Array.fromBase64 === "function" ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), size = require("image-size").imageSize(bytes);
    if (!size?.width || !size?.height || size.width > 1024 || size.height > 1024 || size.width * size.height > 256 * 256) return null;
    return { url: preview.data, width: size.width, height: size.height, bytes: preview.data.length * 2 };
  } catch {
    return null;
  }
}
class OverviewCoordinator {
  constructor({ load, render, existingPreview = smallExistingPreview, urls = URL, maxBytes = 32 * 1024 * 1024, maxEntries = 256, onError = () => {
  } }) {
    if (typeof load !== "function" || typeof render !== "function" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw Error("Invalid overview cache.");
    Object.assign(this, { load, render, existingPreview, urls, maxBytes, maxEntries, onError });
    this.pages = /* @__PURE__ */ new Map();
    this.desired = /* @__PURE__ */ new Map();
    this.leases = /* @__PURE__ */ new Map();
    this.cache = /* @__PURE__ */ new Map();
    this.failures = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    this.fallbackKeys = /* @__PURE__ */ new WeakMap();
    this.serial = 0;
    this.version = 0;
    this.bytes = 0;
    this.active = null;
    this.closed = false;
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.version;
  emit() {
    this.version++;
    for (const listener of this.listeners) try {
      listener();
    } catch {
    }
  }
  key(page) {
    let revisions = [page.geometryRevision ?? null, page.revision ?? null, page.signature ?? null];
    if (revisions.every((value) => value === null)) {
      let fallback = this.fallbackKeys.get(page);
      if (!fallback) {
        fallback = "local-" + ++this.serial;
        this.fallbackKeys.set(page, fallback);
      }
      revisions = [null, fallback, null];
    }
    for (const revision of revisions) if (revision !== null && (typeof revision !== "string" && typeof revision !== "number" || typeof revision === "number" && !Number.isFinite(revision) || String(revision).length > 256)) throw Error("Invalid overview revision.");
    const meta = thumbnailMetadata(page.metadata || page), paper = meta.paper || {}, extent = meta.extent || {}, backdrop = page.backdropHash ?? page.backdropId ?? null;
    if (backdrop !== null && (typeof backdrop !== "string" || backdrop.length > 256)) throw Error("Invalid overview background identity.");
    return JSON.stringify([page.pageId, revisions, backdrop, meta.aspect ?? 1, paper.kind, paper.spacing, paper.colour, extent.x, extent.y, extent.width, extent.height]);
  }
  setPages(pages) {
    validPages(pages);
    const next = /* @__PURE__ */ new Map();
    for (const page of pages) next.set(page.pageId, { page, key: this.key(page) });
    this.pages = next;
    const keep = new Set([...next.values()].map((row) => row.key));
    for (const key of this.failures.keys()) if (!keep.has(key)) this.failures.delete(key);
    this.updateDesired();
  }
  setVisible(owner, ids) {
    if (this.closed) return;
    const values = [...new Set(ids)];
    if (values.length > 4096) throw Error("Too many visible overview pages.");
    this.leases.set(owner, values);
    this.updateDesired();
  }
  releaseVisible(owner) {
    this.leases.delete(owner);
    this.updateDesired();
  }
  updateDesired() {
    if (this.closed) return;
    const next = /* @__PURE__ */ new Map();
    for (const ids of this.leases.values()) for (const id of ids) {
      const row = this.pages.get(id);
      if (row) next.set(id, row);
    }
    this.desired = next;
    for (const [key, error] of this.failures) if (!error) this.failures.delete(key);
    if (this.active && next.get(this.active.id)?.key !== this.active.key) this.active.controller.abort();
    this.trim();
    void this.pump();
    this.emit();
  }
  trim(required = 0) {
    for (const [key, entry] of this.cache) {
      if (this.bytes + required <= this.maxBytes && this.cache.size + (required ? 1 : 0) <= this.maxEntries) break;
      let pinned = false;
      for (const row of this.desired.values()) if (row.key === key) {
        pinned = true;
        break;
      }
      if (pinned) continue;
      this.cache.delete(key);
      this.bytes -= entry.bytes;
      entry.dispose?.();
    }
    return this.bytes + required <= this.maxBytes && this.cache.size + (required ? 1 : 0) <= this.maxEntries;
  }
  get(id) {
    const row = this.pages.get(id);
    if (!row) return null;
    const entry = this.cache.get(row.key);
    if (entry) {
      this.cache.delete(row.key);
      this.cache.set(row.key, entry);
      return entry;
    }
    return this.failures.has(row.key) ? { error: this.failures.get(row.key) } : null;
  }
  async pump() {
    if (this.active || this.closed) return;
    while (!this.closed) {
      const pending = [...this.desired].find(([, row2]) => !this.cache.has(row2.key) && !this.failures.has(row2.key));
      if (!pending) return;
      const [id, row] = pending;
      const controller = new AbortController(), job = this.active = { id, key: row.key, controller };
      let resource;
      try {
        resource = await this.existingPreview(row.page, { signal: controller.signal });
        check(controller.signal);
        if (!resource) {
          const packet = await this.load(id, { signal: controller.signal, background: true });
          check(controller.signal);
          if (packet.metadata?.geometryRevision && row.page.geometryRevision && packet.metadata.geometryRevision !== row.page.geometryRevision) throw Error("The overview page changed while loading.");
          resource = await this.render(packet, { signal: controller.signal });
          check(controller.signal);
        }
        if (this.closed || this.desired.get(id)?.key !== row.key) throw abort();
        if (!resource || !Number.isSafeInteger(resource.width) || !Number.isSafeInteger(resource.height) || resource.width <= 0 || resource.height <= 0 || resource.width * resource.height > 256 * 256 || resource.width > 1024 || resource.height > 1024) throw Error("Invalid overview thumbnail.");
        const blob = resource.blob, encoded = blob?.size ?? resource.bytes;
        if (!Number.isSafeInteger(encoded) || encoded < 0 || encoded > 512 * 1024) throw Error("Overview thumbnail exceeds its budget.");
        const bytes = encoded + resource.width * resource.height * 4;
        if (!this.trim(bytes)) {
          this.failures.set(row.key, "");
          resource.dispose?.();
          resource = null;
          continue;
        }
        const url = resource.url || this.urls.createObjectURL(blob), dispose = resource.url ? resource.dispose : () => this.urls.revokeObjectURL(url);
        this.cache.set(row.key, { url, width: resource.width, height: resource.height, bytes, dispose });
        this.bytes += bytes;
        resource = null;
        this.emit();
      } catch (error) {
        resource?.dispose?.();
        if (error.name !== "AbortError" && !controller.signal.aborted && !this.closed) {
          this.failures.set(row.key, String(error.message).slice(0, 1e3));
          try {
            this.onError(error, id);
          } catch {
          }
          this.emit();
        }
      } finally {
        if (this.active === job) this.active = null;
      }
    }
  }
  retry(id) {
    const row = this.pages.get(id);
    if (row) this.failures.delete(row.key);
    void this.pump();
  }
  stats() {
    return { bytes: this.bytes, entries: this.cache.size, pinned: this.desired.size, active: !!this.active };
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.active?.controller.abort();
    this.leases.clear();
    this.desired.clear();
    this.pages.clear();
    for (const entry of this.cache.values()) entry.dispose?.();
    this.cache.clear();
    this.bytes = 0;
    this.failures.clear();
    this.listeners.clear();
    this.render.dispose?.();
  }
}
module.exports = { OverviewCoordinator, reorderPages, stepBefore, visibleWindow, loadOverviewPage, smallExistingPreview };
