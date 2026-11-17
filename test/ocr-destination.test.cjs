const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const renderer=fs.readFileSync(require.resolve('../src/renderer.js'),'utf8');
const readImage=renderer.slice(renderer.indexOf('async function readImage('),renderer.indexOf("window.addEventListener('notemind-imported'"));
function setup(){
 const controls=Object.fromEntries(['img','area','status','insert','new','again','language','svg','positions','cancel'].map(name=>[name,{value:'',disabled:false,append(){},replaceChildren(){},setAttribute(){}}]));
 const lookup={'img':controls.img,'textarea':controls.area,'.ocr-status':controls.status,'[data-act=insert]':controls.insert,'[data-act=new]':controls.new,'[data-act=again]':controls.again,'select':controls.language,'svg':controls.svg,'input':controls.positions,'[data-act=cancel]':controls.cancel};
 const dialog={querySelector:s=>lookup[s],showModal(){},close(){this.onclose?.()},remove(){},set innerHTML(value){}};
 const sourceTab={id:1},calls=[],notes=[],cancelled=[],jobs=[];let progress,stopped=0;
 const context={readingDialog:null,activeTab:sourceTab,tabs:[sourceTab],crypto:require('node:crypto'),localStorage:{getItem(){return null},setItem(){}},document:{createElement:()=>dialog,createElementNS:()=>({setAttribute(){},append(){}}),body:{append(){}}},window:{notemind:{onDocumentProgress:fn=>{progress=fn;return ()=>stopped++},ocrRead:request=>new Promise((resolve,reject)=>jobs.push({request,resolve,reject})),ocrCancel:async id=>{cancelled.push(id)}}},activateTab:tab=>calls.push(['activate',tab]),restoreCaret:()=>calls.push(['caret']),insertText:text=>calls.push(['insert',text]),addTab:note=>notes.push(note),markDirty:()=>calls.push(['dirty'])};
 vm.createContext(context);vm.runInContext(readImage,context);
 return {context,controls,dialog,sourceTab,calls,notes,cancelled,jobs,resolveRead:value=>jobs[0].resolve(value),progress:value=>progress(value),get stopped(){return stopped}};
}
test('recognized text can be edited and sent to a new Notepad',async()=>{
 const h=setup(),finished=h.context.readImage('image',()=>h.calls.push(['callback']));
 assert.equal(h.controls.new.disabled,true);h.resolveRead({text:'original',lines:[]});await finished;
 assert.equal(h.controls.new.disabled,false);h.controls.area.value='corrected text';h.controls.area.oninput();h.controls.new.onclick();
 assert.equal(h.notes.length,1);assert.equal(h.notes[0].text,'corrected text');assert.equal(h.notes[0].imported,true);
 assert.deepEqual(h.calls.map(x=>x[0]),['dirty','callback']);assert.equal(h.cancelled.length,1);
});
test('current Notepad destination and empty or cancelled reviews stay safe',async()=>{
 const h=setup(),finished=h.context.readImage('image');h.resolveRead({text:'recognized',lines:[]});await finished;
 h.controls.area.value='   ';h.controls.area.oninput();assert.equal(h.controls.new.disabled,true);h.controls.new.onclick();assert.equal(h.notes.length,0);
 h.controls.area.value='chosen';h.controls.area.oninput();h.controls.insert.onclick();assert.deepEqual(h.calls.map(x=>x[0]),['activate','caret','insert']);assert.equal(h.calls.at(-1)[1],'chosen');
 const cancelled=setup(),pending=cancelled.context.readImage('image');cancelled.controls.cancel.onclick();cancelled.resolveRead({text:'late',lines:[]});await pending;assert.equal(cancelled.notes.length,0);assert.equal(cancelled.calls.length,0);
});
test('changing OCR language cancels unique old jobs and ignores stale success, error and progress',async()=>{
 const h=setup(),first=h.context.readImage('image');h.controls.language.value='en';const second=h.controls.language.onchange();assert.equal(h.jobs.length,2);assert.notEqual(h.jobs[0].request.id,h.jobs[1].request.id);assert.equal(h.jobs[1].request.language,'en');assert.deepEqual(h.cancelled,[h.jobs[0].request.id]);
 h.jobs[0].resolve({text:'stale success',lines:[]});await first;assert.equal(h.controls.area.value,'');assert.equal(h.controls.again.disabled,true);const pendingStatus=h.controls.status.textContent;h.progress({id:h.jobs[0].request.id,phase:'Old progress'});assert.equal(h.controls.status.textContent,pendingStatus);h.progress({id:h.jobs[1].request.id,phase:'Current progress'});assert.equal(h.controls.status.textContent,'Current progress…');
 h.jobs[1].resolve({text:'English result',lines:[]});await second;assert.equal(h.controls.area.value,'English result');assert.equal(h.controls.again.disabled,false);
 const third=h.controls.again.onclick();h.controls.language.value='auto';const fourth=h.controls.language.onchange();assert.equal(h.jobs.length,4);assert.equal(new Set(h.jobs.map(job=>job.request.id)).size,4);h.jobs[3].resolve({text:'Newest result',lines:[]});await fourth;const latestStatus=h.controls.status.textContent;h.jobs[2].reject(Error('stale error'));await third;assert.equal(h.controls.area.value,'Newest result');assert.equal(h.controls.status.textContent,latestStatus);assert.equal(h.controls.again.disabled,false);
 h.controls.cancel.onclick();assert.equal(h.cancelled.at(-1),h.jobs[3].request.id);assert.equal(h.stopped,1);assert.equal(h.context.readingDialog,null);
});
test('closing an OCR review cancels its latest language job and rejects all late results',async()=>{
 const h=setup(),first=h.context.readImage('image');h.controls.language.value='en';const second=h.controls.language.onchange();h.controls.cancel.onclick();assert.deepEqual(h.cancelled,[h.jobs[0].request.id,h.jobs[1].request.id]);h.jobs[1].resolve({text:'late success',lines:[]});h.jobs[0].reject(Error('late error'));await Promise.all([first,second]);assert.equal(h.controls.area.value,'');assert.equal(h.calls.length,0);assert.equal(h.notes.length,0);assert.equal(h.stopped,1);
});
test('language reruns retain the original insertion while a different Notepad is active',async()=>{
 const h=setup(),insertion={tab:h.sourceTab,text:'original',start:0,end:0};h.context.window.NoteMindNotes={captureInsertion:()=>insertion,insertTextFor:(target,text)=>h.calls.push(['bound insert',target,text])};const first=h.context.readImage('image',()=>h.calls.push(['callback']));const other={id:2};h.context.tabs.push(other);h.context.activeTab=other;h.controls.language.value='en';const second=h.controls.language.onchange();h.jobs[1].resolve({text:'recognized original',lines:[]});await second;h.jobs[0].resolve({text:'stale',lines:[]});await first;h.controls.insert.onclick();assert.equal(h.context.activeTab,other);assert.equal(h.calls[0][0],'bound insert');assert.equal(h.calls[0][1],insertion);assert.equal(h.calls[0][2],'recognized original');assert.deepEqual(h.calls.map(call=>call[0]),['bound insert','callback']);
});
