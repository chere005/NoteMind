const {createHash}=require('node:crypto'),ink=require('./pdf-ink-codec.cjs');
const INK='assets/pdf-page.json',BASELINE='assets/pdf-baseline.json';
async function run(doc,options,{assetBytes,makeAsset,createStore=root=>new(require('./pdf-ink-store.cjs').PDFInkStore)(root)}={}){
 if(!doc||doc.text!==''||!doc.assets||Array.isArray(doc.assets)||!options||!['serialize','save','page'].includes(options.mode))throw Error('Invalid PDF ink document.');
 const names=Object.keys(doc.assets),allowed=options.mode==='page'?[]:options.mode==='save'?[INK,BASELINE]:[INK];
 if(names.some(name=>!allowed.includes(name))||options.mode!=='page'&&!Object.hasOwn(doc.assets,INK))throw Error('Invalid PDF ink assets.');
 const bytesOf=name=>{const value=doc.assets[name],resolved=assetBytes?.(name,value);if(resolved!==undefined)return resolved;if(typeof value!=='string'||value.length>200*1024*1024)throw Error('Invalid PDF ink bytes.');return Buffer.from(value,'base64');};
 if(options.mode==='serialize'){const bytes=bytesOf(INK);ink.validate(bytes);return{revision:createHash('sha256').update(bytes).digest('hex')};}
 const {mode,root,baselineRevision,...settings}=options,store=createStore(root);
 if(mode==='page'){const saved=await store.page(settings.identity,settings.sourceHash,settings.page);return{text:'',assets:saved?{[INK]:makeAsset?makeAsset(saved.bytes,{sha256:saved.revision}):saved.bytes.toString('base64')}:{},meta:{revision:saved?.revision||null}};}
 const bytes=bytesOf(INK),baseline=Object.hasOwn(doc.assets,BASELINE)?{revision:baselineRevision,bytes:bytesOf(BASELINE)}:null,result=await store.save({...settings,bytes,baseline});
 return{revision:result.revision,original:result.original,durabilityWarning:result.durabilityWarning};
}
module.exports={run,INK,BASELINE};
