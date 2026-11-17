// Decoder-owned metadata lives in bounded pages, never one token per stroke.
const MAX_PAGE = 4096;
let nextRasterId = 1;
function reserveIds(count) {
 if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(nextRasterId + count)) throw RangeError('Ink identity range exceeded.');
 const first = nextRasterId; nextRasterId += count; return first;
}
const isWord = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
class MetadataRange {
 #count; #first; #claimed;
 constructor(count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 2000000) throw TypeError('Invalid owned ink range.');
  this.#count = count; this.#first = reserveIds(count); this.#claimed = new Uint8Array(Math.ceil(Math.ceil(count / MAX_PAGE) / 8)); Object.freeze(this);
 }
 static claim(range, offset, count) {
  if (!range || typeof range !== 'object' || !(#count in range) || !Number.isSafeInteger(offset) || offset < 0 || offset % MAX_PAGE || count !== Math.min(MAX_PAGE, range.#count - offset) || !count) throw TypeError('Invalid owned ink range page.');
  const page = offset / MAX_PAGE, mask = 1 << (page & 7), byte = page >>> 3;
  if (range.#claimed[byte] & mask) throw Error('Owned ink range page was already assigned.');range.#claimed[byte] |= mask; return range.#first + offset;
 }
}
class MetadataPage {
 #count; #namespace; #view; #known; #used; #first; #stride; #storedFirst; #storedStep;
 constructor(count, { namespace = null, identityBytes = null, hashBytes = null, rasterRange = null, rasterOffset = 0 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_PAGE) throw TypeError('Invalid owned ink metadata page.');
  if (identityBytes && hashBytes || identityBytes && (typeof namespace !== 'string' || !namespace)) throw TypeError('Invalid owned ink metadata source.');
  const input = identityBytes || hashBytes, inputStride = identityBytes ? 16 : 8;
  if (input && (!ArrayBuffer.isView(input) || input.byteLength !== count * inputStride)) throw TypeError('Invalid owned ink metadata size.');
  let storedFirst = null, storedStep = 0, source, snapshot;
  if (identityBytes) {
   snapshot = new Uint8Array(input.byteLength); snapshot.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
   source = new DataView(snapshot.buffer);
   const first = count ? source.getFloat64(0, true) : 0, step = count > 1 ? source.getFloat64(16, true) - first : 0;
   let affine = Number.isSafeInteger(step * Math.max(0, count - 1)) && Number.isSafeInteger(first + step * Math.max(0, count - 1));
   for (let index = 0; index < count; index++) {
    const id = source.getFloat64(index * 16, true);
    if (!Number.isSafeInteger(id) || id <= 0) { snapshot.buffer.transfer?.(0); throw TypeError('Invalid owned ink stored identity.'); }
    if (id !== first + step * index) affine = false;
   }
   if (affine) { storedFirst = first; storedStep = step; }
  }
  const stride = identityBytes && storedFirst === null ? 16 : 8;
  const bytes = !input ? null : identityBytes && storedFirst === null ? snapshot : new Uint8Array(count * stride);
  if (identityBytes && storedFirst !== null) {
   const output = new DataView(bytes.buffer);
   for (let index = 0; index < count; index++) { output.setUint32(index * 8, source.getUint32(index * 16 + 8, true), true); output.setUint32(index * 8 + 4, source.getUint32(index * 16 + 12, true), true); }
   snapshot.buffer.transfer?.(0);
  } else if (input && !identityBytes) bytes.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  this.#view = bytes ? new DataView(bytes.buffer) : null; this.#stride = stride; this.#count = count; this.#namespace = identityBytes ? namespace : null;
  this.#storedFirst = storedFirst; this.#storedStep = storedStep;
  this.#known = new Uint8Array(Math.ceil(count / 8)); if (input) this.#known.fill(255);
  this.#used = new Uint8Array(Math.ceil(count / 8)); this.#first = rasterRange ? MetadataRange.claim(rasterRange, rasterOffset, count) : reserveIds(count); Object.freeze(this);
 }
 get count() { return this.#count; }
 get storageBytes() { return (this.#view?.byteLength || 0) + this.#known.byteLength + this.#used.byteLength; }
 static claim(page, index) {
  if (!page || typeof page !== 'object' || !(#count in page) || !Number.isInteger(index) || index < 0 || index >= page.#count) throw TypeError('Invalid owned ink ordinal.');
  const mask = 1 << (index & 7), byte = index >>> 3;
  if (page.#used[byte] & mask) throw Error('Owned ink ordinal was already assigned.'); page.#used[byte] |= mask;
 }
 static id(page, index) { return page.#first + index; }
 static storedId(page, index, namespace) {
  if (page.#namespace === null || page.#namespace !== namespace) return null;
  return page.#storedFirst === null ? page.#view.getFloat64(index * page.#stride, true) : page.#storedFirst + page.#storedStep * index;
 }
 static known(page, index) { return !!(page.#known[index >>> 3] & 1 << (index & 7)); }
 static words(page, index, output, at) {
  if (!MetadataPage.known(page, index)) return false;
  const offset = index * page.#stride + (page.#stride === 16 ? 8 : 0);
  output.setUint32(at, page.#view.getUint32(offset, true), true); output.setUint32(at + 4, page.#view.getUint32(offset + 4, true), true); return true;
 }
 static prime(page, index, high, low) {
  if (!isWord(high) || !isWord(low)) throw TypeError('Invalid owned ink fingerprint.');
  page.#view ||= new DataView(new ArrayBuffer(page.#count * page.#stride));
  const at = index * page.#stride + (page.#stride === 16 ? 8 : 0);
  page.#view.setUint32(at, high, true); page.#view.setUint32(at + 4, low, true); page.#known[index >>> 3] |= 1 << (index & 7);
 }
 static text(page, index) {
  if (!MetadataPage.known(page, index)) return null;
  const at = index * page.#stride + (page.#stride === 16 ? 8 : 0);
  return page.#view.getUint32(at, true).toString(16).padStart(8, '0') + page.#view.getUint32(at + 4, true).toString(16).padStart(8, '0');
 }
}
class OwnedStroke {
 #page; #ordinal;
 constructor(page, ordinal, colour, width, points, pressures) {
  this.#page = page; this.#ordinal = ordinal;
  this.colorHex = colour; this.width = width; this.points = points; if (pressures != null) this.pressures = pressures;
  // Preserve plain-object APIs while private brands cannot spread/clone an ID.
  Object.setPrototypeOf(this, Object.prototype); Object.freeze(this);
 }
 static owns(stroke) { return !!stroke && typeof stroke === 'object' && #page in stroke; }
 static id(stroke) { return OwnedStroke.owns(stroke) ? MetadataPage.id(stroke.#page, stroke.#ordinal) : null; }
 static storedId(stroke, namespace) { return OwnedStroke.owns(stroke) ? MetadataPage.storedId(stroke.#page, stroke.#ordinal, namespace) : null; }
 static text(stroke) { return OwnedStroke.owns(stroke) ? MetadataPage.text(stroke.#page, stroke.#ordinal) : null; }
 static words(stroke, output, at) { return OwnedStroke.owns(stroke) && MetadataPage.words(stroke.#page, stroke.#ordinal, output, at); }
 static prime(stroke, high, low) { if (!OwnedStroke.owns(stroke)) return false; MetadataPage.prime(stroke.#page, stroke.#ordinal, high, low); return true; }
}
function createOwnedInkStroke(page, ordinal, colour, width, points, pressures) {
 if (typeof colour !== 'string' || !/^#[0-9a-f]{6}$/i.test(colour) || typeof width !== 'number' || !Number.isFinite(width * 10000) || width <= 0 || !Array.isArray(points) || pressures != null && (!Array.isArray(pressures) || pressures.length !== points.length)) throw TypeError('Invalid owned ink stroke.');
 MetadataPage.claim(page, ordinal); return new OwnedStroke(page, ordinal, colour, width, points, pressures);
}
function writeOwnedFingerprintWords(stroke, output, at = 0) {
 if (!output || typeof output.setUint32 !== 'function' || !Number.isSafeInteger(at) || at < 0 || at + 8 > output.byteLength) throw TypeError('Invalid owned ink fingerprint destination.');
 return OwnedStroke.words(stroke, output, at);
}
const api = { MAX_OWNED_INK_PAGE: MAX_PAGE, reserveOwnedInkRange: count => new MetadataRange(count), createOwnedInkMetadataPage: (count, options) => new MetadataPage(count, options), createOwnedInkStroke, ownedInkId: OwnedStroke.id, ownedStoredId: OwnedStroke.storedId, knownOwnedFingerprint: OwnedStroke.text, primeOwnedFingerprintWords: OwnedStroke.prime, writeOwnedFingerprintWords, allocateInkId: () => reserveIds(1) };
module.exports = globalThis.NoteMindOwnedInkMetadata ||= api;
