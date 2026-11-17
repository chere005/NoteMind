const graphics=require('./graphics-pane.js');
const HASH=/^[a-f0-9]{64}$/i;
function binding(value,expected={}){if(!value||value.version!==1||!HASH.test(value.sourceHash)||!Number.isInteger(value.page)||value.page<1||value.page>10000||!Number.isFinite(value.aspect)||value.aspect<=0||value.aspect>1000000||expected.sourceHash&&value.sourceHash!==expected.sourceHash||expected.page&&value.page!==expected.page)throw Error('This ink belongs to another PDF page or is damaged.');return value;}
function sheet({sourceHash,page,aspect,strokes}){const reference=binding({version:1,sourceHash,page,aspect});if(!Array.isArray(strokes)||strokes.some(stroke=>stroke.opacity!==undefined))throw Error('PDF ink uses opaque pen strokes.');return{name:'PDF page '+page,aspect:1,strokes,backdrop:null,extent:{x:0,y:0,width:1,height:1},paper:{kind:'blank',spacing:'medium',colour:'white',pdfReference:reference}};}
function decode(bytes,expected){const result=graphics.decode(bytes),reference=binding(result.paper?.pdfReference,expected);if(result.strokes.some(stroke=>stroke.opacity!==undefined))throw Error('PDF ink uses opaque pen strokes.');return{...reference,strokes:result.strokes};}
async function decodeAsync(bytes,expected,options={}){const result=graphics.decodeAsync?await graphics.decodeAsync(bytes,options):graphics.decode(bytes),reference=binding(result.paper?.pdfReference,expected);if(result.strokes.some(stroke=>stroke.opacity!==undefined))throw Error('PDF ink uses opaque pen strokes.');return{...reference,strokes:result.strokes};}
function encode(value){return graphics.encodeBytes(sheet(value));}
function encodeAsync(value,options={}){return graphics.encodeBytesAsync(sheet(value),options);}
module.exports={encode,encodeAsync,decode,decodeAsync};
