const ENTRY_BYTES=50*1024*1024,GRAPHICS_BYTES=150*1024*1024,TOTAL_BYTES=199*1024*1024;
const graphicsName=name=>/^assets\/.*\.json$/i.test(name);
const maximumEntryBytes=name=>graphicsName(name)?GRAPHICS_BYTES:ENTRY_BYTES;
function validateEntry(name,bytes){
 if(bytes.length>GRAPHICS_BYTES)throw Error('Archive entry too large');
 if(graphicsName(name)){
  const graphics=require('./graphics-pane.js');
  if(graphics.isBinary(bytes)){graphics.validateBinary(bytes);return;}
 }
 if(bytes.length>ENTRY_BYTES)throw Error('Archive entry too large');
}
module.exports={ENTRY_BYTES,GRAPHICS_BYTES,TOTAL_BYTES,maximumEntryBytes,validateEntry};
