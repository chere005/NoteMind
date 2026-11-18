(() => {
 // Count a bounded text slice at a time, preserving textContent concatenation
 // across nodes while skipping folded content and editor controls.
 const letters=/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu,continuation=/^[\p{L}\p{N}'’-]+/u;
 function scan(text,state){
  text=state.carry+text;state.carry='';const last=text.charCodeAt(text.length-1);
  if(last>=0xd800&&last<=0xdbff){state.carry=text.at(-1);text=text.slice(0,-1);}
  if(!text)return;let at=0;
  if(state.inWord){const prefix=text.match(continuation);if(prefix)at=prefix[0].length;else state.inWord=false;if(at===text.length)return;}
  letters.lastIndex=at;let match,end=-1;while((match=letters.exec(text))){state.count++;end=letters.lastIndex;}state.inWord=end===text.length;
 }
 function countHTML(html){
  const state={count:0,inWord:false,carry:''},tokens=/<[^>]*>|&(?:amp|lt|gt|quot|#39|#x27);/g,entities={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'"};let from=0,skip=0,match;
  while((match=tokens.exec(html))){if(!skip)scan(html.slice(from,match.index),state);const token=match[0];
   if(token[0]==='&'){if(!skip)scan(entities[token],state);}
   else if(skip){if(/^<\//.test(token))skip--;else if(!/^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(token)&&!/^<!/.test(token))skip++;}
   else if(/^<span\b[^>]*class="missing-image"/.test(token))skip=1;
   from=tokens.lastIndex;
  }
  if(!skip)scan(html.slice(from),state);return state.count;
 }
 if(typeof module==='object'&&module.exports){module.exports={scan,countHTML};return;}
 if(typeof document==='undefined'&&typeof importScripts==='function'){
  importScripts('document-renderer.js');
  self.onmessage=event=>{const {id,text}=event.data;try{self.postMessage({id,count:countHTML(NoteMindDocument.render(text))});}catch(error){self.postMessage({id,error:String(error.message||error)});}};return;
 }

 // The footer: a word count of the words you can see, when the Notepad was last saved, and the page zoom.
 const footer=document.querySelector('main footer'),levels=[50,75,90,100,110,125,150,175,200];
 const make=(tag,id)=>{const element=document.createElement(tag);element.id=id;footer.insertBefore(element,$('modeLabel'));return element;};
 const words=make('span','wordCount'),saved=make('span','savedAt'),zoom=make('select','zoomBox');
 zoom.title='Zoom the page';zoom.setAttribute('aria-label','Zoom');
 for(const level of levels){const option=document.createElement('option');option.value=level;option.textContent=level+'%';zoom.append(option);}
 zoom.value='100';
 function* pieces(root){
  let node=root.firstChild;
  while(node){
   if(node.nodeType===3){for(let at=0;at<node.length;at+=8192)yield node.substringData(at,8192);}
   const skip=node.nodeType===1&&node.matches('.missing-image,[data-editor-control],.heading-folded');
   if(!skip&&node.firstChild){node=node.firstChild;yield null;continue;}
   while(node!==root&&!node.nextSibling)node=node.parentNode;
   node=node===root?null:node.nextSibling;yield null;
  }
 }
 let revision=0,timer=null,job=null,worker=null,workerTimer=null;
 const stopWorker=()=>{clearTimeout(workerTimer);workerTimer=null;worker?.terminate();worker=null;};
 function update(){revision++;stopWorker();clearTimeout(timer);timer=setTimeout(run,80);}
 function run(){
  timer=null;const stamp=revision,tab=activeTab,mode=visual,state={count:0,inWord:false,carry:''};
  const work=job={stamp,tab,mode},current=()=>job===work&&revision===stamp&&activeTab===tab&&visual===mode;
  const publish=count=>{if(current())words.textContent=count+(count===1?' word':' words');if(job===work)job=null;};
  if(!mode){
   try{
    const currentWorker=worker=new Worker(new URL('notes-footer.js',document.baseURI));
    const fail=()=>{if(worker!==currentWorker)return;stopWorker();if(current()){words.textContent='Word count unavailable';job=null;}};
    worker.onmessage=event=>{if(worker!==currentWorker||event.data?.id!==stamp)return;const value=event.data;stopWorker();if(value.error||!Number.isSafeInteger(value.count)||value.count<0){if(current()){words.textContent='Word count unavailable';job=null;}}else publish(value.count);};
    worker.onerror=event=>{event.preventDefault?.();fail();};worker.onmessageerror=fail;workerTimer=setTimeout(fail,30000);worker.postMessage({id:stamp,text:source.value});
   }catch{stopWorker();if(current()){words.textContent='Word count unavailable';job=null;}}return;
  }
  const iterator=pieces(rich);
  function step(){
   if(!current())return;let nodes=0,chars=0,next;
   while(nodes<256&&chars<32768){next=iterator.next();if(next.done){publish(state.count);return;}nodes++;if(next.value!==null){chars+=next.value.length;scan(next.value,state);}}
   if(current())timer=setTimeout(step,0);
  }
  step();
 }
 // Mutations include same-length replacements, folds, Undo and tab restores.
 new MutationObserver(update).observe(rich,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','data-editor-control','hidden']});
 rich.addEventListener('input',update);source.addEventListener('input',update);update();
 new MutationObserver(()=>{if(/^(Saved|Autosaved)\b/.test($('status').textContent))saved.textContent='Saved '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}).observe($('status'),{childList:true,characterData:true,subtree:true});
 let savedTab=activeTab?.id;
 window.addEventListener('notemind-document',event=>{if(event.detail.activeId!==savedTab){savedTab=event.detail.activeId;saved.textContent='';}update();});

 let writing;
 function setZoom(percent,remember=true){
  percent=levels.includes(percent)?percent:100;zoom.value=String(percent);rich.style.zoom=source.style.zoom=String(percent/100);update();
  if(remember){clearTimeout(writing);writing=setTimeout(()=>window.notemind.preferenceSet?.('view',{zoom:percent}).catch(()=>{}),250);}
 }
 const step=delta=>setZoom(levels[Math.min(levels.length-1,Math.max(0,levels.indexOf(Number(zoom.value))+delta))]);
 zoom.onchange=()=>setZoom(Number(zoom.value));
 window.addEventListener('notemind-command',e=>{if(e.detail==='zoomIn')step(1);if(e.detail==='zoomOut')step(-1);if(e.detail==='zoomReset')setZoom(100);});
 window.notemind.preferenceGet?.('view').then(view=>{if(view&&typeof view.zoom==='number')setZoom(view.zoom,false);}).catch(()=>{});
 window.addEventListener('unload',()=>{revision++;clearTimeout(timer);stopWorker();job=null;});
 window.NoteMindFooter={update,setZoom,get zoom(){return Number(zoom.value);}};
})();
