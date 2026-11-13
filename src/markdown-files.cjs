const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {md,mime}=require('./document-renderer.cjs');
function references(text){const env={},tokens=md.parse(text,env),urls=new Set();for(const t of tokens)for(const c of t.children||[])if(c.type==='image'||c.type==='link_open')urls.add(c.attrGet(c.type==='image'?'src':'href'));return [...urls];}
function rewrite(text,from,to){const choices=new Set([from,decodeURI(from)]);for(const key of choices){text=text.split(']('+key+')').join(']('+to+')').split('](<'+key+'>)').join(']('+to+')').split(']('+key+' ').join(']('+to+' ');const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp('(^\\s*\\[[^\\]]+\\]:\\s*)<?'+escaped+'>?(?=\\s|$)','gm'),'$1'+to);}return text;}
function remapMeta(meta,mapping){meta=structuredClone(meta||{});const attachments={};for(const [name,info]of Object.entries(meta.attachments||{}))attachments[mapping[name]||name]={...info,thumbnail:mapping[info.thumbnail]||info.thumbnail};meta.attachments=attachments;if(meta.graphicsPanes)meta.graphicsPanes=Object.fromEntries(Object.entries(meta.graphicsPanes).map(([name,info])=>[mapping[name]||name,info]));return meta;}
function assetMapping(assets,target){const mapping={};const map=name=>{if(mapping[name])return mapping[name];const preview=name.endsWith('.json')&&name.slice(0,-5);return mapping[name]=preview&&Object.hasOwn(assets,preview)?map(preview)+'.json':target(name)};for(const name of Object.keys(assets))map(name);return mapping;}
function assetHash(assets,name){const hash=crypto.createHash('sha256').update(Buffer.from(assets[name],'base64'));if(assets[name+'.json'])hash.update('\0').update(Buffer.from(assets[name+'.json'],'base64'));return hash.digest('hex');}
function canonical(doc){let text=doc.text;const assets={},mapping=assetMapping(doc.assets||{},name=>name.startsWith('assets/')?name:'assets/'+assetHash(doc.assets,name).slice(0,16)+path.extname(name).toLowerCase());for(const [name,data]of Object.entries(doc.assets||{})){const next=mapping[name];text=rewrite(text,name,next);assets[next]=data;}return {...doc,text,assets,meta:remapMeta(doc.meta,mapping)};}
const sidecarFolder=file=>path.basename(file,path.extname(file)).replace(/[^\p{L}\p{N}_.-]/gu,'-')+'.assets';
async function read(file,text){
 const assets={},base=await fs.realpath(path.dirname(file));let total=0,metadata={};
 try{metadata=JSON.parse(await fs.readFile(path.join(base,sidecarFolder(file),'notemind.json'),'utf8'));}catch{}
 const refs=new Set([...references(text),...Object.values(metadata.meta?.attachments||{}).map(i=>i.thumbnail).filter(Boolean),...(metadata.extraAssets||[])]);
 for(const url of refs){if(typeof url!=='string'||/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(url))continue;let decoded;try{decoded=decodeURIComponent(url)}catch{continue;}
  try{const target=await fs.realpath(path.resolve(base,decoded)),relative=path.relative(base,target);if(relative.startsWith('..')||path.isAbsolute(relative))continue;const stat=await fs.stat(target);if(!stat.isFile()||stat.size>50*1024*1024||total+stat.size>199*1024*1024)continue;const bytes=await fs.readFile(target);total+=bytes.length;assets[url]=bytes.toString('base64');}catch{}
 }
 return {path:file,text,assets,id:metadata.id,title:metadata.title,created:metadata.created,meta:metadata.meta||{}};
}
async function prepare(doc,file){let text=doc.text;const assets={},dir=path.dirname(file),folder=sidecarFolder(file),mapping=assetMapping(doc.assets||{},name=>folder+'/'+assetHash(doc.assets,name).slice(0,24)+path.extname(name).toLowerCase());
 for(const [name,data]of Object.entries(doc.assets||{})){const bytes=Buffer.from(data,'base64'),targetName=mapping[name];await fs.mkdir(path.join(dir,folder),{recursive:true});const target=path.join(dir,targetName);try{await fs.writeFile(target,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;if(!Buffer.from(await fs.readFile(target)).equals(bytes))throw Error('An attachment with this filename already exists.');}text=rewrite(text,name,targetName);assets[targetName]=data;}
 const next={...doc,text,assets,meta:remapMeta(doc.meta,mapping)};
 await require('./notes-store.cjs').atomic(path.join(dir,folder,'notemind.json'),JSON.stringify({id:doc.id,title:doc.title,created:doc.created,meta:next.meta,extraAssets:Object.keys(assets).filter(n=>n.endsWith('.json'))}));
 return next;
}
module.exports={read,prepare,canonical,references,rewrite};
