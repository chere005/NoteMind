const graphics = require("./graphics-pane.js");
const { thumbnailMetadata } = require("./overview-thumbnail-client.cjs");
const MAX_BYTES = 256 * 1024 * 1024;
const abort = () => Object.assign(Error("Page overview cancelled."), { name: "AbortError" });
const check = (signal) => {
  if (signal?.aborted) throw abort();
};
function captureOverviewPage(row) {
  if (!row || row.loaded === false) {
    if (row?.dirty) throw Error("The current page geometry is not loaded.");
    return null;
  }
  const page = row.page;
  if (!page || !Array.isArray(page.strokes)) {
    if (row.dirty) throw Error("The current page geometry is not loaded.");
    return null;
  }
  if (typeof row.pageId !== "string" || !row.pageId || row.pageId.length > 128) throw Error("Invalid overview page identity.");
  const metadata = thumbnailMetadata({ aspect: page.aspect, paper: row.paper ?? page.paper ?? row.metadata?.paper, extent: page.extent ?? row.metadata?.extent });
  graphics.validate({ ...metadata, strokes: [] });
  const sheet = Object.freeze({ name: String(row.name ?? row.metadata?.name ?? "Drawing").slice(0, 256), ...metadata, strokes: page.strokes, backdrop: null });
  return Object.freeze({ sheet, backdrop: page.backdrop ?? null, metadata: Object.freeze({ ...metadata, pageId: row.pageId, geometryRevision: row.geometryRevision, revision: row.revision, signature: row.signature }) });
}
async function backdropBytes(data, limit, { signal, yieldControl }) {
  if (data === null) return null;
  if (typeof data !== "string" || data.length > limit || !/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,/i.test(data.slice(0, 128))) throw Error("Invalid overview background.");
  const start = data.indexOf(",") + 1;
  if (start === data.length) throw Error("Invalid overview background.");
  const bytes = new Uint8Array(data.length), encoder = new TextEncoder();
  for (let at = 0; at < data.length; at += 65536) {
    check(signal);
    const text = data.slice(at, at + 65536);
    if (at + text.length > start && !/^[a-z0-9+/=\r\n]+$/i.test(text.slice(Math.max(0, start - at)))) throw Error("Invalid overview background.");
    encoder.encodeInto(text, bytes.subarray(at));
    await yieldControl();
  }
  check(signal);
  return bytes;
}
function createOverviewLoader({ getPage, loadSaved, encode = graphics.encodeBytesAsync, yieldControl = graphics.yieldTask, maxBytes = MAX_BYTES }) {
  if (typeof getPage !== "function" || typeof loadSaved !== "function" || typeof encode !== "function" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw Error("Invalid overview source adapter.");
  return async (pageId, { signal } = {}) => {
    check(signal);
    const row = getPage(pageId);
    if (row && row.pageId !== pageId) throw Error("Overview page ownership changed.");
    const captured = captureOverviewPage(row);
    if (!captured) {
      const saved = await loadSaved(pageId, { signal, background: true });
      check(signal);
      return saved;
    }
    const bytes = await encode(captured.sheet, { signal, yieldControl });
    check(signal);
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength > maxBytes) throw Error("Overview source exceeds its byte budget.");
    const background = await backdropBytes(captured.backdrop, maxBytes - bytes.byteLength, { signal, yieldControl });
    check(signal);
    return { metadata: captured.metadata, bytes, ...background ? { backdropBytes: background } : {}, owned: true };
  };
}
module.exports = { captureOverviewPage, createOverviewLoader };
