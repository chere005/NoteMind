// PDF pages become editable paragraph siblings; only the captured split is serialized once.
const cancelled=()=>Object.assign(Error('PDF import cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw cancelled();};
const trimStart=text=>text.replace(/^[\t\r\n]+/,''),trimEnd=text=>text.replace(/[\t\r\n\s]+$/,''),withoutStart=text=>text.replace(/^\n+/,''),withoutEnd=text=>text.replace(/\n+$/,'');
const postProcess=text=>trimEnd(trimStart(text));
function join(left,right){const a=withoutEnd(left),b=withoutStart(right);return a+'\n\n'.slice(0,Math.max(left.length-a.length,right.length-b.length))+b;}
const joinParts=parts=>parts.reduce(join,'');
const htmlOf=node=>node.outerHTML??String(node.nodeValue||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function blockText(html,serialize){let marker='NoteMindPdfBoundary';while(html.includes(marker))marker+='X';const left=marker+'Start',right=marker+'End',value=serialize('<p>'+left+'</p>'+html+'<p>'+right+'</p>');if(!value.startsWith(left)||!value.endsWith(right))throw Error('The Notepad page could not be serialized.');return value.slice(left.length,-right.length);}
function point(root,nodes,container,offset){if(container===root)return{boundary:offset};let top=container;const path=[];while(top&&top.parentNode!==root){const parent=top.parentNode;if(!parent)return null;path.unshift(Array.prototype.indexOf.call(parent.childNodes,top));top=parent;}const index=nodes.indexOf(top);return index<0?null:{index,path,offset};}
function atPath(node,path){for(const index of path)node=node.childNodes[index];return node;}
function split(node,container,offset){
 const left=node.cloneNode(false),right=node.cloneNode(false);
 if(node===container){if(node.nodeType===3){left.nodeValue=node.nodeValue.slice(0,offset);right.nodeValue=node.nodeValue.slice(offset);}else Array.from(node.childNodes).forEach((child,index)=>(index<offset?left:right).appendChild(child.cloneNode(true)));return[left,right];}
 let child=container;while(child.parentNode!==node){child=child.parentNode;if(!child)throw Error('The captured Notepad position changed.');}const position=Array.prototype.indexOf.call(node.childNodes,child),halves=split(child,container,offset);Array.from(node.childNodes).forEach((value,index)=>{if(index<position)left.appendChild(value.cloneNode(true));else if(index>position)right.appendChild(value.cloneNode(true));else{left.appendChild(halves[0]);right.appendChild(halves[1]);}});return[left,right];
}
function createPageImport(bridge){
 const document=bridge.document,serialize=bridge.serialize,initialRoot=bridge.root(),initialNodes=initialRoot?Array.from(initialRoot.childNodes):null,range=bridge.range?.(),initial=initialNodes&&range?{nodes:initialNodes,start:point(initialRoot,initialNodes,range.startContainer,range.startOffset),end:point(initialRoot,initialNodes,range.endContainer,range.endOffset)}:null;
 let initialCapture=initial?.start&&initial?.end?initial:null,expectedText=bridge.target.text,cursor=null,dropped='',anchors=null,closed=false,epoch=0,lastStamp,lastState,ownEpoch=0;
 const stats={serializedUnits:0,pages:0,rebuilds:0};const Observer=document.defaultView?.MutationObserver||globalThis.MutationObserver,observer=Observer&&initialRoot?new Observer(()=>{}):null;observer?.observe(initialRoot,{subtree:true,childList:true,characterData:true});
 const raw=node=>{const html=htmlOf(node);stats.serializedUnits+=html.length;return blockText(html,serialize);};
 const take=()=>{const records=observer?.takeRecords()||[];if(records.length&&bridge.root())epoch++;};
 const stampEqual=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);
 function readState(){if(closed)throw cancelled();take();const stamp=bridge.readStamp();if(lastState&&stampEqual(lastStamp,stamp)&&lastState.epoch===epoch)return lastState;const value=bridge.readState({forceVisual:!!bridge.root()&&epoch!==ownEpoch});lastStamp=stamp;lastState={...value,epoch};return lastState;}
 function nodesFor(page){const nodes=[];if(page.imageName){const p=document.createElement('p'),image=document.createElement('img');image.setAttribute('data-asset',page.imageName);image.setAttribute('alt','Image');p.appendChild(image);nodes.push(p);}if(page.text!==undefined){const p=document.createElement('p');String(page.text).split('\n').forEach((line,index)=>{if(index)p.appendChild(document.createElement('br'));p.appendChild(document.createTextNode(line));});nodes.push(p);}return nodes;}
 async function parts(nodes,{signal,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){const result=[];for(let at=0;at<nodes.length;at++){check(signal);result.push(raw(nodes[at]));if(at+1<nodes.length)await yieldTask();}check(signal);return result;}
 async function planPage(page,before=readState(),options={}){
  check(options.signal);const nodes=nodesFor(page),pageRaw=joinParts(nodes.map(raw)),root=bridge.root(),same=before.text===expectedText,add=page.assets||{},meta=page.meta||(page.imageName?{...before.meta,graphicsPanes:{...before.meta?.graphicsPanes,[page.imageName]:{version:1}}}:before.meta);let start,end,text,newCursor,newDropped,mutation;
  if(!same){cursor=before.text.length;dropped='';anchors=null;initialCapture=null;}
  if(initialCapture&&same){
   const capture=initialCapture,oldParts=await parts(capture.nodes,options),first=capture.start.boundary??capture.start.index,last=capture.end.boundary??capture.end.index+1,prefix=capture.start.boundary===undefined?split(capture.nodes[first],atPath(capture.nodes[first],capture.start.path),capture.start.offset)[0]:null,suffix=capture.end.boundary===undefined?split(capture.nodes[last-1],atPath(capture.nodes[last-1],capture.end.path),capture.end.offset)[1]:null;
   const replacements=[...(prefix?[prefix]:[]),...nodes,...(suffix?[suffix]:[])],replacementRaw=joinParts(replacements.map(raw)),leftRaw=joinParts(oldParts.slice(0,first)),rightRaw=joinParts(oldParts.slice(last)),left=withoutEnd(trimStart(leftRaw)),right=withoutStart(trimEnd(rightRaw)),canonical=postProcess(joinParts(oldParts)),next=postProcess(join(join(leftRaw,replacementRaw),rightRaw)),throughPage=join(join(leftRaw,prefix?raw(prefix):''),pageRaw),hasSuffix=!!postProcess(join(suffix?raw(suffix):'',rightRaw));
   if(before.text===canonical){start=left.length;end=canonical.length-right.length;text=next.slice(start,next.length-right.length);}else{start=0;end=before.text.length;text=next;}
   const rawCursor=withoutEnd(trimStart(throughPage));newCursor=hasSuffix?rawCursor.length:postProcess(throughPage).length;newDropped=hasSuffix?'':rawCursor.slice(newCursor);
   mutation={root:initialRoot,old:capture.nodes.slice(first,last),before:capture.nodes[last]||null,nodes:replacements,afterPage:nodes.at(-1)||prefix,beforeTail:suffix||capture.nodes[last]||null};
  }else{
   if(cursor===null)cursor=same&&bridge.target.start!==null?bridge.target.start:before.text.length;start=cursor;end=stats.pages===0&&same&&bridge.target.start!==null?(bridge.target.end??cursor):cursor;
   const left=before.text.slice(0,start),right=before.text.slice(end),atEnd=!right.length,pageCore=withoutEnd(withoutStart(pageRaw)),visible=atEnd?trimEnd(pageCore):pageCore,prefix=left.length&&!left.endsWith('\n\n')?(left.endsWith('\n')?'\n':'\n\n'):'',suffix=right.length&&!right.startsWith('\n\n')?(right.startsWith('\n')?'\n':'\n\n'):'';text=dropped+prefix+visible+suffix;newCursor=start+dropped.length+prefix.length+visible.length;newDropped=atEnd?pageCore.slice(visible.length):'';
   if(root){let beforeNode=anchors?.beforeTail,afterNode=anchors?.afterPage;if(!anchors||anchors.root!==root||afterNode&&afterNode.parentNode!==root||beforeNode&&beforeNode.parentNode!==root||epoch!==ownEpoch){const currentNodes=Array.from(root.childNodes),currentParts=await parts(currentNodes,options);stats.rebuilds++;let through='';beforeNode=null;for(let at=0;at<=currentNodes.length;at++){if(postProcess(through).length===cursor||withoutEnd(trimStart(through)).length===cursor){beforeNode=currentNodes[at]||null;break;}if(at<currentNodes.length)through=join(through,currentParts[at]);}if(beforeNode===null&&cursor!==before.text.length)throw Error('The captured Notepad page boundary changed.');}
    mutation={root,old:[],before:beforeNode||null,nodes,afterPage:nodes.at(-1),beforeTail:beforeNode||null};
   }
  }
  check(options.signal);const nextText=before.text.slice(0,start)+text+before.text.slice(end),documentValue={...before.document,text:nextText,assets:{...before.assets,...add},meta};return{before,start,end,text,add,meta,document:bridge.projectDocument?.(documentValue)||documentValue,pageNodes:nodes,mutation,cursor:newCursor,dropped:newDropped,independentBytes:start===end&&(!initialCapture||!same)?text:null};
 }
 function commitPage(plan){const current=readState();if(current!==plan.before)throw Object.assign(Error('The Notepad changed while a PDF page was being prepared.'),{code:'PDF_IMPORT_RETRY'});const mutation=plan.mutation,root=bridge.root();if(mutation&&root&&mutation.root===root&&(mutation.before&&mutation.before.parentNode!==root||mutation.old.some(node=>node.parentNode!==root)))mutation.rebuild=true;
  bridge.publish(plan,()=>{if(mutation&&root&&mutation.root===root&&!mutation.rebuild){const fragment=document.createDocumentFragment();for(const node of mutation.nodes)fragment.appendChild(node);for(const node of mutation.old)node.remove();root.insertBefore(fragment,mutation.before);return true;}return false;});
  observer?.takeRecords();ownEpoch=epoch;expectedText=plan.document.text;cursor=plan.cursor;dropped=plan.dropped;anchors=root&&mutation&&!mutation.rebuild?{root,afterPage:mutation.afterPage,beforeTail:mutation.beforeTail}:null;initialCapture=null;lastStamp=null;lastState=null;stats.pages++;const after=readState();expectedText=after.text;return after;
 }
 return{readState,planPage,commitPage,stats:()=>({...stats}),dispose(){closed=true;observer?.disconnect();initialCapture=null;anchors=null;lastState=null;lastStamp=null;}};
}
module.exports={createPageImport,blockText,join,postProcess};
