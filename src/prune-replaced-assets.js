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
 // Attachment records own their source and thumbnail even when their card is
 // temporarily absent from Markdown. A graphicsPanes decoration alone does not.
 for(const [name,info]of Object.entries(meta.attachments||{})){retain(name);retain(info?.thumbnail);}
 const removed=[...eligible].filter(name=>Object.hasOwn(assets,name)&&!live.has(name));
 if(!removed.length)return {assets,meta,removed};
 const nextAssets={...assets};for(const name of removed)delete nextAssets[name];
 let nextMeta=meta;
 if(meta.graphicsPanes&&removed.some(name=>Object.hasOwn(meta.graphicsPanes,name))){const graphicsPanes={...meta.graphicsPanes};for(const name of removed)delete graphicsPanes[name];nextMeta={...meta,graphicsPanes};}
 return {assets:nextAssets,meta:nextMeta,removed};
}
return prune;
});
