const zlib = require('node:zlib');
function crc32(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function pack(files) {
  let offset = 0; const local = [], central = [];
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(value), compressed = zlib.deflateRawSync(data), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
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
    if (original > 50 * 1024 * 1024 || size > 50 * 1024 * 1024) throw Error('Archive entry too large');
    total += original; if (total > 200 * 1024 * 1024) throw Error('Archive contents too large');
    if (buffer.readUInt32LE(off) !== 0x04034b50) throw Error('Invalid archive entry');
    const start = off + 30 + buffer.readUInt16LE(off + 26) + buffer.readUInt16LE(off + 28), bytes = buffer.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(bytes, { maxOutputLength: 50 * 1024 * 1024 }) : method === 0 ? bytes : (() => { throw Error('Unsupported compression'); })();
    if (data.length !== original || crc32(data) !== crc) throw Error('Corrupt archive entry');
    if (!name.startsWith('/') && !name.split('/').includes('..')) { if (Object.hasOwn(files, name)) throw Error('Duplicate archive entry'); files[name] = data; }
    p += 46 + nl + el + cl;
  }
  return files;
}
module.exports = { pack, unpack };
