// Worker-only: packets here have crossed a transfer boundary and belong to this
// receiver. Generic InkRaster callers retain their own buffers unchanged.
function releaseOwnedInkPacket(packet, batches = []) {
 const retained = new Set();for (const batch of batches) if (batch) retained.add(batch.bytes.buffer);
 const buffers = new Set();for (const view of [packet.order, packet.addIds, packet.additions, ...(packet.patches || []).map(patch => patch.insert)]) if (ArrayBuffer.isView(view)) buffers.add(view.buffer);
 packet.order = packet.addIds = packet.additions = null;for (const patch of packet.patches || []) patch.insert = null;packet.patches = null;
 for (const buffer of buffers) if (!retained.has(buffer) && buffer.byteLength && typeof buffer.transfer === 'function') buffer.transfer(0);
}
module.exports = {releaseOwnedInkPacket};
