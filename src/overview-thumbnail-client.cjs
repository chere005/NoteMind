const { yieldTask } = require("./graphics-pane.js");
const abort = () => Object.assign(Error("Thumbnail cancelled."), { name: "AbortError" }), MAX_BYTES = 256 * 1024 * 1024;
function thumbnailMetadata(source) {
  const out = {};
  if (source?.aspect !== void 0) {
    if (!Number.isFinite(source.aspect) || source.aspect < 0.1 || source.aspect > 10) throw Error("Invalid overview aspect.");
    out.aspect = source.aspect;
  }
  if (source?.paper !== void 0) {
    const paper = source.paper;
    if (!paper || !["kind", "spacing", "colour"].every((key) => typeof paper[key] === "string" && paper[key].length <= 32)) throw Error("Invalid overview paper.");
    out.paper = { kind: paper.kind, spacing: paper.spacing, colour: paper.colour };
  }
  if (source?.extent !== void 0) {
    const extent = source.extent;
    if (!extent || !["x", "y", "width", "height"].every((key) => typeof extent[key] === "number" && Number.isFinite(extent[key]))) throw Error("Invalid overview extent.");
    out.extent = { x: extent.x, y: extent.y, width: extent.width, height: extent.height };
  }
  if(source?.camera!==undefined){const camera=require('./camera-schema.cjs').cameraMetadata({...source.camera,name:'Overview'}).camera;out.camera={rotation:camera.rotation,aspect:camera.aspect,inkRotation:camera.inkRotation,inkAspect:camera.inkAspect};}
  return out;
}
class OverviewThumbnailClient {
  constructor({ workerFactory = () => new Worker(new URL("overview-thumbnail-worker.js", document.baseURI)), timeout = 3e4, idleMs = 1e4 } = {}) {
    Object.assign(this, { workerFactory, timeout, idleMs });
    this.worker = null;
    this.active = null;
    this.next = 0;
    this.closed = false;
  }
  start() {
    if (this.worker) return this.worker;
    const worker = this.worker = this.workerFactory();
    worker.onmessage = (event) => {
      const packet = event.data, job = this.active;
      if (!job || packet?.id !== job.id) return;
      if (packet.error) this.complete(job, Object.assign(Error(packet.error.message), { name: packet.error.name }));
      else this.complete(job, null, packet.value);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.stop(Error(event.message || "Thumbnail worker stopped."));
    };
    worker.onmessageerror = () => this.stop(Error("Thumbnail response could not be read."));
    return worker;
  }
  async render(input, { signal } = {}) {
    if (this.closed) throw Error("Page thumbnails are closed.");
    if (this.active) throw Error("A thumbnail is already rendering.");
    if (signal?.aborted) throw abort();
    clearTimeout(this.idleTimer);
    const id = ++this.next, job = { id, signal, resolve: null, reject: null, abort: null, timer: null };
    this.active = job;
    const pending = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    void pending.catch(() => {
    });
    job.abort = () => {
      if (this.active !== job) return;
      if (job.posted) this.worker?.postMessage({ cancel: id });
    };
    signal?.addEventListener("abort", job.abort, { once: true });
    job.timer = setTimeout(() => this.stop(Error("Page thumbnail timed out.")), this.timeout);
    try {
      let total = 0;
      const packet = { metadata: thumbnailMetadata(input.metadata) }, transfers = [];
      for (const key of ["bytes", "backdropBytes"]) {
        const value = input[key];
        if (value == null) continue;
        if (!ArrayBuffer.isView(value) || (total += value.byteLength) > MAX_BYTES) throw Error("Overview source exceeds its byte budget.");
        let bytes;
        if (input.owned && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) bytes = value;
        else {
          bytes = new Uint8Array(value.byteLength);
          for (let at = 0; at < bytes.length; at += 65536) {
            if (signal?.aborted) throw abort();
            if (this.active !== job || this.closed) throw Error("Page thumbnails are closed.");
            bytes.set(new Uint8Array(value.buffer, value.byteOffset + at, Math.min(65536, bytes.length - at)), at);
            await yieldTask();
          }
        }
        packet[key] = bytes;
        transfers.push(bytes.buffer);
      }
      if (!packet.bytes) throw Error("Thumbnail geometry is missing.");
      if (signal?.aborted) throw abort();
      if (this.active !== job) throw Error("Thumbnail worker stopped.");
      job.posted = true;
      this.start().postMessage({ id, packet }, transfers);
    } catch (error) {
      this.complete(job, error);
    }
    return pending;
  }
  complete(job, error, value) {
    if (this.active !== job) return;
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.abort);
    this.active = null;
    error ? job.reject(error) : job.signal?.aborted ? job.reject(abort()) : job.resolve(value);
    this.idleTimer = setTimeout(() => {
      this.worker?.terminate();
      this.worker = null;
    }, this.idleMs);
    this.idleTimer.unref?.();
  }
  stop(error) {
    const job = this.active;
    this.worker?.terminate();
    this.worker = null;
    if (job) this.complete(job, error);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.stop(Error("Page thumbnails are closed."));
    clearTimeout(this.idleTimer);
  }
}
module.exports = { OverviewThumbnailClient, thumbnailMetadata };
