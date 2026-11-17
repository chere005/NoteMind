const zlib = require('node:zlib');
const {createHash} = require('node:crypto');
const {maximumEntryBytes,validateEntry}=require('./archive-limits.cjs');
const crcTable = Uint32Array.from({length:256}, (_, value) => { let c=value; for(let bit=0;bit<8;bit++)c=(c>>>1)^(0xedb88320&-(c&1));return c>>>0; });
function crc32(data) { if(typeof zlib.crc32==='function')return zlib.crc32(data);let c=0xffffffff;for(const byte of data)c=(c>>>8)^crcTable[(c^byte)&255];return (c^0xffffffff)>>>0; }
// Autosaves and recovery snapshots share immutable assets. Retain only compressed bytes,
// with a fixed memory budget; changed content always gets a different cache key.
const compressedFiles = new Map(), CACHE_BYTES=32*1024*1024, CACHE_ENTRIES=512;
let cachedBytes=0;
const storedDecisions=new Map();
function alreadyCompressed(data){
  return (data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)
    ||data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii'))
    ||(data.subarray(0,4).toString('ascii')==='RIFF'&&data.subarray(8,12).toString('ascii')==='WEBP')
    ||data.subarray(4,8).toString('ascii')==='ftyp'
    ||(data[0]===0x50&&data[1]===0x4b&&[3,5,7].includes(data[2]))
    ||(data[0]===0x1f&&data[1]===0x8b)
    ||(data[0]===0x28&&data[1]===0xb5&&data[2]===0x2f&&data[3]===0xfd);
}
function storeWithoutCompression(data){
  if(alreadyCompressed(data))return true;
  if(data.length<64*1024)return false;
  const sample=Buffer.concat([data.subarray(0,4096),data.subarray(Math.floor(data.length/2),Math.floor(data.length/2)+4096),data.subarray(-4096)]);
  const key=createHash('sha256').update(String(data.length)).update(sample).digest('hex');
  if(storedDecisions.has(key))return storedDecisions.get(key);
  // Sample only the compression choice, never integrity: CRC still covers every original byte.
  const stored=zlib.deflateRawSync(sample,{level:1}).length>=sample.length*.98;
  storedDecisions.set(key,stored);if(storedDecisions.size>512)storedDecisions.delete(storedDecisions.keys().next().value);return stored;
}
function compressedFile(data) {
  if(storeWithoutCompression(data))return {bytes:data,crc:crc32(data),method:0};
  if(data.length<1024)return {bytes:zlib.deflateRawSync(data),crc:crc32(data),method:8};
  const key=createHash('sha256').update(data).digest('hex'),found=compressedFiles.get(key);
  if(found){compressedFiles.delete(key);compressedFiles.set(key,found);return found;}
  const entry={bytes:zlib.deflateRawSync(data),crc:crc32(data),method:8};
  if(entry.bytes.length<=CACHE_BYTES){
    while(compressedFiles.size&&(cachedBytes+entry.bytes.length>CACHE_BYTES||compressedFiles.size>=CACHE_ENTRIES)){
      const oldest=compressedFiles.keys().next().value;cachedBytes-=compressedFiles.get(oldest).bytes.length;compressedFiles.delete(oldest);
    }
    compressedFiles.set(key,entry);cachedBytes+=entry.bytes.length;
  }
  return entry;
}
function pack(files) {
  let offset = 0; const local = [], central = [];
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.isBuffer(value)?value:Buffer.from(value), stored=compressedFile(data), compressed=stored.bytes, crc=stored.crc;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt16LE(stored.method, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(stored.method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(l, n, compressed); central.push(c, n); offset += l.length + n.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function unpack(buffer) {
  let end = -1; for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('Invalid archive');
  const count = buffer.readUInt16LE(end + 10); let p = buffer.readUInt32LE(end + 16), total = 0; const files = Object.create(null);
  if (count > 10000) throw Error('Too many archive entries');
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw Error('Invalid archive directory');
    const method = buffer.readUInt16LE(p + 10), crc = buffer.readUInt32LE(p + 16), size = buffer.readUInt32LE(p + 20), original = buffer.readUInt32LE(p + 24), nl = buffer.readUInt16LE(p + 28), el = buffer.readUInt16LE(p + 30), cl = buffer.readUInt16LE(p + 32), off = buffer.readUInt32LE(p + 42), name = buffer.subarray(p + 46, p + 46 + nl).toString();
    const entryLimit=maximumEntryBytes(name);
    if (original > entryLimit || size > entryLimit) throw Error('Archive entry too large');
    total += original; if (total > 200 * 1024 * 1024) throw Error('Archive contents too large');
    if (buffer.readUInt32LE(off) !== 0x04034b50) throw Error('Invalid archive entry');
    const start = off + 30 + buffer.readUInt16LE(off + 26) + buffer.readUInt16LE(off + 28), bytes = buffer.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(bytes, { maxOutputLength: entryLimit }) : method === 0 ? bytes : (() => { throw Error('Unsupported compression'); })();
    if (data.length !== original || crc32(data) !== crc) throw Error('Corrupt archive entry');
    validateEntry(name,data);
    if (!name.startsWith('/') && !name.split('/').includes('..')) { if (Object.hasOwn(files, name)) throw Error('Duplicate archive entry'); files[name] = data; }
    p += 46 + nl + el + cl;
  }
  return files;
}
module.exports = { pack, unpack };
