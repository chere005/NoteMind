// Only buffers allocated by our compact reader/encoder are eligible for retirement.
// An arbitrary loader's `owned` flag never grants this cleanup authority.
const privateBackings=new WeakSet(),dependencies=new WeakMap();
function ownOverviewBytes(bytes,packet){if(ArrayBuffer.isView(bytes)&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength){privateBackings.add(bytes.buffer);if(packet){let held=dependencies.get(packet);if(!held)dependencies.set(packet,held=new Set());held.add(bytes.buffer);}}return bytes;}
function discardOverviewPacket(packet){const buffers=new Set(dependencies.get(packet));dependencies.delete(packet);for(const bytes of [packet?.bytes,packet?.backdropBytes])if(ArrayBuffer.isView(bytes)&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&privateBackings.has(bytes.buffer))buffers.add(bytes.buffer);for(const buffer of buffers){privateBackings.delete(buffer);if(buffer.byteLength&&typeof buffer.transfer==='function')try{buffer.transfer(0);}catch{}}}
module.exports={ownOverviewBytes,discardOverviewPacket};
