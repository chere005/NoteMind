// Saved camera pictures are immutable PNG sources. Decode only leased pictures;
// encoding a new capture happens once, away from render and autosave callbacks.
const PREFIX = 'data:image/png;base64,';
const MAX_PIXELS = 16 * 1024 * 1024;
const {yieldTask:pause} = require('./graphics-pane.js');
const abortError = () => Object.assign(Error('Camera picture loading cancelled.'), {name:'AbortError'});

function pictureRef(source, {maxPixels = MAX_PIXELS} = {}) {
  if (typeof source !== 'string' || !source.startsWith(PREFIX) || source.length > 200 * 1024 * 1024) throw Error('Invalid saved camera picture.');
  let bytes;
  try {
    const header = source.slice(PREFIX.length, PREFIX.length + 44);
    bytes = typeof Buffer === 'function' ? new Uint8Array(Buffer.from(header, 'base64')) : Uint8Array.from(atob(header), ch => ch.charCodeAt(0));
  } catch { throw Error('Invalid saved camera picture.'); }
  if (bytes.length < 24 || [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((byte,index) => bytes[index] !== byte)) throw Error('Invalid saved camera PNG header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 32768 || height > 32768 || width * height > maxPixels) throw Error('Camera picture dimensions are too large.');
  return Object.freeze({source, width, height});
}

async function pngDataURL(canvas) {
  const {width, height} = canvas;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw Error('Camera picture dimensions are too large.');
  const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('The camera picture could not be encoded.')), 'image/png'));
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || Error('The camera picture could not be read.'));
    reader.onabort = () => reject(abortError());
    reader.readAsDataURL(blob);
  });
}

async function decodePicture(ref, signal) {
  const data = ref.source.slice(PREFIX.length), parts = [];
  for (let offset = 0; offset < data.length; offset += 65536) {
    if (signal.aborted) throw abortError();
    const part = data.slice(offset, offset + 65536);
    parts.push(typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(part) : Uint8Array.from(atob(part), ch => ch.charCodeAt(0)));
    await pause();
  }
  if (signal.aborted) throw abortError();
  const image = await createImageBitmap(new Blob(parts, {type:'image/png'}));
  if (signal.aborted) { image.close(); throw abortError(); }
  if (image.width !== ref.width || image.height !== ref.height) { image.close(); throw Error('Camera picture dimensions changed while loading.'); }
  return image;
}

class CameraPictures {
  constructor({decode = decodePicture, encode = pngDataURL, maxBytes = 64 * 1024 * 1024, maxEntries = 2, maxPending = 2} = {}) {
    Object.assign(this, {decode, encode, maxBytes, maxEntries, maxPending});
    this.images = new Map(); this.jobs = new Map(); this.queue = []; this.bytes = 0; this.active = null; this.closed = false;
    this.encodings = new WeakMap();
  }
  capture(canvas) {
    if (this.closed) return Promise.reject(Error('Camera pictures are closing.'));
    let pending = this.encodings.get(canvas);
    if (!pending) {
      pending = Promise.resolve().then(() => this.encode(canvas)).then(source => {
        if (this.closed) throw abortError();
        return pictureRef(source);
      });
      this.encodings.set(canvas, pending);
      void pending.catch(() => { if (this.encodings.get(canvas) === pending) this.encodings.delete(canvas); });
    }
    return pending;
  }
  touch(ref, entry) { this.images.delete(ref); this.images.set(ref, entry); }
  evict(bytes = 0, count = 0) {
    for (const [ref,entry] of this.images) {
      if (this.bytes + bytes <= this.maxBytes && this.images.size + count <= this.maxEntries) break;
      if (entry.pins) continue;
      this.images.delete(ref); this.bytes -= entry.bytes; entry.image.close?.();
    }
    return this.bytes + bytes <= this.maxBytes && this.images.size + count <= this.maxEntries;
  }
  lease(ref, entry) {
    entry.pins++; this.touch(ref, entry);
    let released = false;
    return {image:entry.image, release:() => {
      if (released) return;
      released = true; entry.pins--;
      if (this.closed && !entry.pins && this.images.get(ref) === entry) { this.images.delete(ref); this.bytes -= entry.bytes; entry.image.close?.(); }
      this.pump();
    }};
  }
  acquire(ref, {signal} = {}) {
    if (this.closed) return Promise.reject(Error('Camera pictures are closing.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!ref || typeof ref.source !== 'string' || !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width <= 0 || ref.height <= 0 || ref.width * ref.height * 4 > this.maxBytes) return Promise.reject(Error('Camera picture exceeds the decoded image budget.'));
    const held = this.images.get(ref);
    if (held) return Promise.resolve(this.lease(ref, held));
    let job = this.jobs.get(ref);
    if (!job) {
      if (this.jobs.size >= this.maxPending) return Promise.reject(Error('Camera picture loading is busy.'));
      job = {ref, controller:new AbortController(), waiters:new Set()};
      this.jobs.set(ref, job); this.queue.push(job);
    }
    return new Promise((resolve,reject) => {
      const waiter = {resolve,reject,signal,cancel:null};
      const cancel = () => {
        if (!job.waiters.delete(waiter)) return;
        signal?.removeEventListener('abort',cancel); reject(abortError());
        if (!job.waiters.size) {
          if (this.jobs.get(ref) === job) this.jobs.delete(ref);
          job.controller.abort(); this.queue = this.queue.filter(value => value !== job);
        }
        this.pump();
      };
      waiter.cancel = cancel; job.waiters.add(waiter); signal?.addEventListener('abort',cancel,{once:true});
      this.pump();
    });
  }
  pump() {
    if (this.closed || this.active) return;
    while (this.queue.length && !this.queue[0].waiters.size) this.queue.shift();
    const job = this.queue[0];
    if (!job || !this.evict(job.ref.width * job.ref.height * 4, 1)) return;
    this.queue.shift(); this.active = job;
    void this.run(job);
  }
  async run(job) {
    try {
      const image = await this.decode(job.ref, job.controller.signal);
      if (this.closed || job.controller.signal.aborted || !job.waiters.size) { image.close?.(); throw abortError(); }
      const bytes = image.width * image.height * 4;
      if (image.width !== job.ref.width || image.height !== job.ref.height || !this.evict(bytes,1)) { image.close?.(); throw Error('Camera picture exceeded its reserved decode budget.'); }
      const entry = {image,bytes,pins:0}; this.images.set(job.ref,entry); this.bytes += bytes;
      for (const waiter of job.waiters) {
        waiter.signal?.removeEventListener('abort',waiter.cancel);
        if (waiter.signal?.aborted) waiter.reject(abortError());
        else waiter.resolve(this.lease(job.ref,entry));
      }
    } catch (error) {
      for (const waiter of job.waiters) { waiter.signal?.removeEventListener('abort',waiter.cancel); waiter.reject(error); }
    } finally {
      job.waiters.clear(); if (this.jobs.get(job.ref) === job) this.jobs.delete(job.ref);
      if (this.active === job) this.active = null;
      this.pump();
    }
  }
  forget(ref) {
    const entry = this.images.get(ref);
    if (entry && !entry.pins) { this.images.delete(ref); this.bytes -= entry.bytes; entry.image.close?.(); }
  }
  stats() { return {decodedBytes:this.bytes, decoded:this.images.size, pending:this.jobs.size, active:!!this.active}; }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
      for (const waiter of job.waiters) { waiter.signal?.removeEventListener('abort',waiter.cancel); waiter.reject(abortError()); }
      job.waiters.clear();
    }
    this.jobs.clear(); this.queue = [];
    for (const ref of [...this.images.keys()]) this.forget(ref);
  }
}
module.exports = {CameraPictures, pictureRef, pngDataURL, decodePicture, MAX_PIXELS};
