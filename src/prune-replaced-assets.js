(function(root,factory){const prune=factory();if(typeof module==='object'&&module.exports)module.exports=prune;else root.NoteMindPruneReplacedAssets=prune;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
// Only the explicitly replaced pair is eligible. The parser is the renderer's
// parser, so examples/code and unused reference definitions do not own assets.
function prune(md,doc,candidates){
 if(!md||typeof md.parse!=='function')throw TypeError('A Markdown parser is required.');
 const assets=doc?.assets||{},meta=doc?.meta||{},eligible=new Set();
 for(const value of typeof candidates==='string'?[candidates]:candidates||[]){if(typeof value!=='string'||!value)continue;eligible.add(value);eligible.add(value.endsWith('.json')?value.slice(0,-5):value+'.json');}
 if(!eligible.size)return {assets,meta,removed:[]};
 function key(value){
  if(typeof value!=='string')return null;
  let name=value;try{name=md.normalizeLink?md.normalizeLink(name):name;}catch{return null;}
  try{name=decodeURIComponent(name);}catch{return null;}
  // Relative path spelling and percent escapes may differ in parsed links.
  // Do not turn an absolute/external URL into a local attachment reference.
  if(/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(name))return name;
  const parts=[];for(const part of name.split('/')){if(part==='.')continue;if(part==='..'&&parts.length&&parts.at(-1)!=='..')parts.pop();else if(part)parts.push(part);}
  return parts.join('/');
 }
 const wanted=new Map();for(const name of eligible){const normalized=key(name);if(normalized!==null){let list=wanted.get(normalized);if(!list)wanted.set(normalized,list=[]);list.push(name);}}
 const live=new Set();
 function retain(value){const names=wanted.get(key(value));if(!names)return;for(const name of names){live.add(name);const pair=name.endsWith('.json')?name.slice(0,-5):name+'.json';if(eligible.has(pair))live.add(pair);}}
 const pending=[md.parse(String(doc?.text||''),{})];
 while(pending.length){for(const token of pending.pop()||[]){if(token.type==='image')retain(token.attrGet?.('src'));else if(token.type==='link_open')retain(token.attrGet?.('href'));if(token.children?.length)pending.push(token.children);}}
 // Attachment records also own portable PDF ink, independently of body links.
 // Ambiguous metadata cannot prove an asset unused; leave this cleanup intact.
 const attachments=meta.attachments;
 if(attachments!=null&&(typeof attachments!=='object'||Array.isArray(attachments)))return {assets,meta,removed:[]};
 for(const [name,info]of Object.entries(attachments||{})){
  if(info!=null&&(typeof info!=='object'||Array.isArray(info)))return {assets,meta,removed:[]};
  retain(name);retain(info?.thumbnail);
  const reference=info?.reference;if(reference==null)continue;
  if(typeof reference!=='object'||Array.isArray(reference)||!reference.pages||typeof reference.pages!=='object'||Array.isArray(reference.pages))return {assets,meta,removed:[]};
  for(const page of Object.values(reference.pages)){
   if(!page||typeof page!=='object'||typeof page.asset!=='string'||!page.asset)return {assets,meta,removed:[]};
   retain(page.asset);
  }
 }
 if(live.has('assets/drawing.svg'))retain('assets/drawing.json');
 const removed=[...eligible].filter(name=>Object.hasOwn(assets,name)&&!live.has(name));
 if(!removed.length)return {assets,meta,removed};
 const nextAssets={...assets};for(const name of removed)delete nextAssets[name];
 let nextMeta=meta;
 for(const key of ['graphicsPanes','imageWidths'])if(meta[key]&&removed.some(name=>Object.hasOwn(meta[key],name))){const entries={...meta[key]};for(const name of removed)delete entries[name];nextMeta={...nextMeta,[key]:entries};}
 return {assets:nextAssets,meta:nextMeta,removed};
}
return prune;
});
