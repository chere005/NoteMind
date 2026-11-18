// Test-only file-control variant of the unchanged original100 mixed workload.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),{fileProcessClass}=require('./helpers/ocr-file-process.cjs');
const nativeRoot=process.env.NOTEMIND_NATIVE_RESEARCH_ROOT;if(!nativeRoot)throw Error('Exact native research root required.');
const baseFile=path.join(nativeRoot,'test/helpers/ocr-native-process.cjs'),mixedHelper=path.join(nativeRoot,'test/helpers/ocr-native-process-mixed.cjs'),driver=path.join(nativeRoot,'test/ocr-native-process-mixed-native.cjs');
const sources=Object.fromEntries([__filename,baseFile,mixedHelper,driver,path.join(nativeRoot,'test/ocr-native-process-entry.cjs'),path.join(__dirname,'helpers/ocr-file-process.cjs'),path.join(__dirname,'helpers/ocr-file-input.cjs'),path.join(__dirname,'ocr-file-process-entry.cjs')].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const base=require(baseFile),FileProcessWorker=fileProcessClass(base.NativeProcessWorker),load=Module._load;
const coldPerImage=process.env.NOTEMIND_NATIVE_PROCESS_COLD_PER_IMAGE==='1';
Module._load=function(name,parent,isMain){const value=load.call(this,name,parent,isMain);if(coldPerImage&&name==='./ocr.cjs'&&value?.TextReader)return{...value,TextReader:class extends value.TextReader{readPixels(pixels,options){return super.readPixels(pixels,{...options,retireOnCompletion:true});}}};if(name==='./ocr-native-process.cjs'&&parent?.filename===mixedHelper)return{...value,NativeProcessWorker:class extends FileProcessWorker{
 constructor(options){super({...options,entry:path.join(__dirname,'ocr-file-process-entry.cjs'),tempRoot:process.env.NOTEMIND_HOME,env:{...process.env,NOTEMIND_OCR_ORIGINAL_PROCESS_ENTRY:options.entry,NOTEMIND_OCR_ORIGINAL_PROCESS_ENTRY_SHA:sources[options.entry]}});}
 snapshot(){return{...super.snapshot(),fileTransportSources:sources,coldPerImage,scope:'Private file-control transport diagnostic; not product backend adoption'};}
}};return value;};
process.env.NOTEMIND_NATIVE_PROBE_TEST_ROOT=__dirname;require(driver);
