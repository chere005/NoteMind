// Committed strokes are immutable. Weak references never keep an undo array alive.
const strokes = new WeakMap(), appends = new WeakMap(), decodedSheets = new WeakMap();
const PRIME_A = 16777619, PRIME_B = 2246822519;
function inverse(odd) { let value = odd;for (let i = 0; i < 5; i++) value = Math.imul(value, 2 - Math.imul(odd, value));return value; }
const INVERSE_A = inverse(PRIME_A), INVERSE_B = inverse(PRIME_B);
function hashText(text, hash) {
 let a = hash ? parseInt(hash.slice(0, 8), 16) : 2166136261, b = hash ? parseInt(hash.slice(8), 16) : 3335557771;
 for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i);a = Math.imul(a ^ code, PRIME_A);b = Math.imul(b ^ code, PRIME_B); }
 return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function removeSuffix(hash, suffix) {
 let a = parseInt(hash.slice(0, 8), 16), b = parseInt(hash.slice(8), 16);
 for (let i = suffix.length - 1; i >= 0; i--) { const code = suffix.charCodeAt(i);a = Math.imul(a, INVERSE_A) ^ code;b = Math.imul(b, INVERSE_B) ^ code; }
 return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function fingerprint(value) { return hashText(typeof value === 'string' ? value : JSON.stringify(value)); }
function strokeFingerprint(stroke) { let hash = strokes.get(stroke);if (!hash) { hash = fingerprint(stroke);strokes.set(stroke, hash); }return hash; }
function primeStrokeFingerprints(ink, hashes) {
 if (!Array.isArray(hashes) || hashes.length !== ink.length || !hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{16}$/.test(hash))) throw Error('Invalid drawing fingerprints.');
 ink.forEach((stroke, i) => strokes.set(stroke, hashes[i]));
}
function primeStrokeFingerprint(stroke,hash){if(typeof hash!=='string'||!/^[a-f0-9]{16}$/.test(hash))throw Error('Invalid drawing fingerprint.');strokes.set(stroke,hash);}
function recordStrokeAppend(previous, next, stroke) { appends.set(next, { previous: new WeakRef(previous), stroke }); }
function strokeAppend(next) { const link = appends.get(next), previous = link?.previous.deref();return previous && next.length === previous.length + 1 && next[next.length - 1] === link.stroke ? { previous, stroke: link.stroke } : null; }
async function canonicalStrokeFingerprintAsync(stroke,yieldControl){let hash=hashText('{"colorHex":'+JSON.stringify(stroke.colorHex)+',"width":'+JSON.stringify(stroke.width)+',"points":['),work=0;for(let i=0;i<stroke.points.length;i++){const point=stroke.points[i];hash=hashText((i?',':'')+JSON.stringify({x:point.x,y:point.y}),hash);if(++work%8192===0)await yieldControl();}hash=hashText(']',hash);if(stroke.pressures){hash=hashText(',"pressures":[',hash);for(let i=0;i<stroke.pressures.length;i++){hash=hashText((i?',':'')+JSON.stringify(stroke.pressures[i]),hash);if(++work%8192===0)await yieldControl();}hash=hashText(']',hash);}return hashText('}',hash);}
const api = { fingerprint, hashText, removeSuffix, strokeFingerprint, primeStrokeFingerprints, primeStrokeFingerprint, canonicalStrokeFingerprintAsync, recordStrokeAppend, strokeAppend, primeDecodedSheet:(sheet,hashes)=>decodedSheets.set(sheet,hashes), decodedSheet:sheet=>decodedSheets.get(sheet) };
module.exports = globalThis.NoteMindStrokeSignatures ||= api;
