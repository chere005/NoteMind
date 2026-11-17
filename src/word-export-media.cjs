// Main stages immutable media in bounded private spools; live document assets stay unchanged.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), { createHash } = require("node:crypto");
const { imageSize } = require("image-size"), { isRawAsset } = require("./archive-raw-assets.cjs"), { ENTRY_BYTES, TOTAL_BYTES } = require("./archive-limits.cjs");
const CHUNK = 196608, WORKING = 256 * 1024 * 1024, MAX_PIXELS = 64 * 1024 * 1024, MAX_OUTPUT_PIXELS = 16 * 1024 * 1024;
const abort = () => Object.assign(Error("Word export cancelled."), { name: "AbortError" }), check = (signal) => {
  if (signal?.aborted) throw abort();
}, task = () => new Promise(setImmediate);
async function write(handle, bytes) {
  let at = 0;
  while (at < bytes.length) {
    const result = await handle.write(bytes, at, bytes.length - at);
    if (!result.bytesWritten) throw Error("Word image spool write stopped.");
    at += result.bytesWritten;
  }
}
async function waitWorking(storage, signal, bytes=WORKING) {
  for (; ; ) {
    check(signal);
    let wake;
    const changed = new Promise((resolve) => wake = resolve), off = storage.subscribeRawCapacity(wake);
    try {
      return await storage.acquireScopedRawWorking(bytes);
    } catch (error) {
      if (error.code !== "ARCHIVE_RAW_BUSY") throw error;
      await new Promise((resolve, reject) => {
        const stop = () => {
          signal?.removeEventListener("abort", stop);
          reject(abort());
        };
        signal?.addEventListener("abort", stop, { once: true });
        changed.then(() => {
          signal?.removeEventListener("abort", stop);
          resolve();
        });
        if (signal?.aborted) stop();
      });
    } finally {
      off();
    }
  }
}
function dimensions(header) {
  const info = imageSize(header);
  if (!Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0 || info.width * info.height > MAX_PIXELS) throw Error("A Word image exceeds the safe 64 Mi pixel source limit.");
  const rotated = info.orientation >= 5 && info.orientation <= 8;
  return { ...info, width: rotated ? info.height : info.width, height: rotated ? info.width : info.height };
}
async function spool(value, file, storage, signal, {handle:borrowedHandle}={}) {
  let bytes = isRawAsset(value) ? value.bytes : ArrayBuffer.isView(value) ? value.byteLength : typeof value === "string" ? value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) : NaN;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > ENTRY_BYTES) throw Error("Word images must be at most 50 MiB.");
  const handle = borrowedHandle||await fs.open(file, "wx", 384), hash = createHash("sha256"), header = Buffer.allocUnsafe(Math.min(bytes, 1024 * 1024));
  let at = 0;
  try {
    while (at < bytes) {
      check(signal);
      const end = Math.min(bytes, at + CHUNK), part = isRawAsset(value) ? await storage.readRawAsset(value, { offset: at, length: end - at }) : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset + at, end - at) : Buffer.from(value.slice(at / 3 * 4, Math.min(value.length, (at + CHUNK) / 3 * 4)), "base64");
      if (part.length !== end - at) throw Error("Word image source changed.");
      if (at < header.length) Buffer.from(part.buffer, part.byteOffset, Math.min(part.length, header.length - at)).copy(header, at);
      hash.update(part);
      await write(handle, part);
      at = end;
      await task();
    }
    const stat = await handle.stat({ bigint: true }), sha256 = hash.digest("hex");
    return { file, bytes, sha256, identity: require("./word-file.cjs").identity(stat), info: dimensions(header) };
  } finally {
    if(!borrowedHandle)await handle.close();
  }
}
function discard(bytes) {
  if (bytes?.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && typeof bytes.buffer.transfer === "function") bytes.buffer.transfer(0);
}
async function exportInScope(doc, file, options, services, expected) {
  const { storage, convertImageFile } = services, controller = new AbortController(), links = [], link = (signal2) => {
    if (!signal2) return;
    const stop = () => controller.abort();
    signal2.addEventListener("abort", stop, { once: true });
    links.push(() => signal2.removeEventListener("abort", stop));
    if (signal2.aborted) stop();
  };
  link(options.signal);
  const signal = controller.signal;
  let directory, working, receipt, failure;
  try {
    check(signal);
    const metadata = { ...doc, assets: Object.fromEntries(Object.keys(doc.assets || {}).map((name) => [name, ""])) }, names = await storage.wordImageNames(metadata);
    check(signal);
    directory = await fs.mkdtemp(path.join(services.tempRoot, "notemind-word-media-"));
    const images = /* @__PURE__ */ Object.create(null), sources = /* @__PURE__ */ new Map();
    let total = 0, index = 0;
    for (const name of names) {
      check(signal);
      if (typeof name !== "string" || !Object.hasOwn(doc.assets || {}, name)) throw Error("A Word image is missing.");
      const value = doc.assets[name], key = isRawAsset(value) ? value.rawAssetToken : ArrayBuffer.isView(value) ? value : {};
      let source = sources.get(key);
      if (!source) {
        source = await spool(value, path.join(directory, "source-" + ++index), storage, signal);
        if ((total += source.bytes) > TOTAL_BYTES) throw Error("The Word source images exceed the document limit.");
        sources.set(key, source);
      }
      images[name] = { source, info: source.info };
    }
    const consumed = [...new Map(Object.values(doc.assets || {}).filter(isRawAsset).map((value) => [value.rawAssetToken, value])).values()];
    if (consumed.length) await storage.unpinScopedRawAssets(consumed);
    const converted = /* @__PURE__ */ new Map();
    for (const [name, image] of Object.entries(images)) {
      check(signal);
      const info = image.info, type = info.type === "jpeg" ? "jpg" : info.type, compatible = ["png", "jpg", "gif", "bmp"].includes(type) && (!info.orientation || info.orientation === 1) && !options.clean;
      if (compatible) {
        images[name] = { source: image.source, width: info.width, height: info.height, type, contentHash: image.source.sha256 };
        continue;
      }
      let result = converted.get(image.source.file);
      if (!result) {
        working = await waitWorking(storage, signal);
        link(working.signal);
        let output;
        try {
          check(signal);
          output = await convertImageFile(image.source.file, require("./document-renderer.cjs").mime(name), { root: directory, bytes: image.source.bytes, sha256: image.source.sha256, signal, clean: !!options.clean, dimensions: { width: info.width, height: info.height }, maxDimension: 4096, maxRSSBytes: 384 * 1024 * 1024, timeoutMs: 3e4 });
          check(signal);
          const bytes = output?.bytes || output?.data, parsed = bytes instanceof Uint8Array ? imageSize(bytes) : null;
          if (!parsed || parsed.type !== "png" || !Number.isSafeInteger(output.width) || !Number.isSafeInteger(output.height) || output.width < 1 || output.height < 1 || output.width > 4096 || output.height > 4096 || output.width * output.height > MAX_OUTPUT_PIXELS || parsed.width !== output.width || parsed.height !== output.height || bytes.byteLength > 80 * 1024 * 1024) throw Error("A converted Word image exceeded its output limit.");
          const target = path.join(directory, "converted-" + ++index + ".png"), handle = await fs.open(target, "wx", 384);
          try {
            const hash = createHash("sha256");
            for (let at = 0; at < bytes.length; at += CHUNK) {
              check(signal);
              const part = bytes.subarray(at, Math.min(bytes.length, at + CHUNK));
              hash.update(part);
              await write(handle, part);
              await task();
            }
            const stat = await handle.stat({ bigint: true });
            result = { source: { file: target, bytes: bytes.length, sha256: hash.digest("hex"), converted: true, identity: require("./word-file.cjs").identity(stat) }, width: output.width, height: output.height, type: "png" };
            result.contentHash = result.source.sha256;
            converted.set(image.source.file, result);
          } finally {
            await handle.close();
          }
        } finally {
          discard(output?.bytes || output?.data);
          output = null;
          await working();
          working = null;
        }
      }
      images[name] = result;
    }
    check(signal);
    const { signal: _, clean: __, onWarning: ___, ...wireOptions } = options;
    receipt = await storage.exportWordFile({ ...doc, assets: {} }, images, wireOptions, { file, spoolRoot: directory, expected, signal });
    return receipt;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    controller.abort();
    for (const off of links) off();
    const errors = [];
    try {
      await working?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      const message = errors.map((error) => error.message).join("; ");
      if (receipt?.committed) (receipt.warnings ||= []).push("The Word document was saved, but temporary-image cleanup could not be confirmed: " + message);
      else if (failure) failure.wordCleanupError = message;
      else throw errors[0];
    }
  }
}
async function exportWordWithMedia(doc, file, options = {}, services = {}) {
  const storage = services.storage || require("./archive-codec.cjs"), settings = { ...services, storage, tempRoot: services.tempRoot || os.tmpdir() }, snapshot = { ...structuredClone({ ...doc, assets: void 0 }), assets: { ...doc.assets } }, expected = await (services.guard || require("./guarded-write.cjs")).fingerprintFile(file);
  check(options.signal);
  if (storage.hasRawAssetScope()) return exportInScope(snapshot, file, options, settings, expected);
  const owner = require("node:crypto").randomUUID(), lease = await storage.preflightRawAssets([], { owner });
  let receipt, failure;
  try {
    receipt = await lease.run(() => exportInScope(snapshot, file, options, settings, expected));
    return receipt;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors = [];
    try {
      await lease.release();
    } catch (error) {
      errors.push(error);
    }
    try {
      await storage.releaseRawAssets(owner);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      const message = errors.map((error) => error.message).join("; ");
      if (receipt?.committed) (receipt.warnings ||= []).push("The Word document was saved, but its temporary asset lease could not be released: " + message);
      else if (failure) failure.wordCleanupError = message;
      else throw errors[0];
    }
  }
}
module.exports = { exportWordWithMedia,spoolImageInput:spool,acquireImageWorking:waitWorking };
