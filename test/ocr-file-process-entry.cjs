// Test-only checked extension of the frozen native-process entry.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const original=process.env.NOTEMIND_OCR_ORIGINAL_PROCESS_ENTRY,expected=process.env.NOTEMIND_OCR_ORIGINAL_PROCESS_ENTRY_SHA;
let code=fs.readFileSync(original,'utf8');if(crypto.createHash('sha256').update(code).digest('hex')!==expected)throw Error('Original process entry identity changed.');
function once(needle,replacement){if(code.indexOf(needle)<0||code.indexOf(needle)!==code.lastIndexOf(needle))throw Error('Owned file entry boundary changed.');code=code.replace(needle,replacement);}
once("process.on('message',frame=>{try{","process.on('message',async frame=>{try{");
once('if(active||frame.sequence<=lastSequence)', 'if(__fileReading||active||frame.sequence<=lastSequence)');
once('const {packet,ack}=decodeInput(frame,generation);','__fileReading=true;const __materialized=await __fileFrame(frame,process.env.NOTEMIND_OCR_FILE_DIRECTORY);const {packet,ack}=decodeInput(__materialized,generation);__fileReading=false;');
code='const {fileFrame:__fileFrame}=require('+JSON.stringify(path.join(__dirname,'helpers/ocr-file-input.cjs'))+');let __fileReading=false;\n'+code;
const entry=new Module(original,module);entry.filename=original;entry.paths=Module._nodeModulePaths(path.dirname(original));entry._compile(code,original);
