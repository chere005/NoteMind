const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const renderer=fs.readFileSync(require.resolve('../src/renderer.js'),'utf8');
const readImage=renderer.slice(renderer.indexOf('async function readImage('),renderer.indexOf("window.addEventListener('notemind-imported'"));
function setup(){
 const controls=Object.fromEntries(['img','area','status','insert','new','again','language','svg','positions','cancel'].map(name=>[name,{value:'',disabled:false,append(){},replaceChildren(){},setAttribute(){}}]));
 const lookup={'img':controls.img,'textarea':controls.area,'.ocr-status':controls.status,'[data-act=insert]':controls.insert,'[data-act=new]':controls.new,'[data-act=again]':controls.again,'select':controls.language,'svg':controls.svg,'input':controls.positions,'[data-act=cancel]':controls.cancel};
 const dialog={querySelector:s=>lookup[s],showModal(){},close(){this.onclose?.()},remove(){},set innerHTML(value){}};
 const sourceTab={id:1},calls=[],notes=[],cancelled=[];let resolveRead;
 const response=new Promise(resolve=>{resolveRead=resolve});
 const context={readingDialog:null,activeTab:sourceTab,tabs:[sourceTab],crypto:require('node:crypto'),localStorage:{getItem(){return null},setItem(){}},document:{createElement:()=>dialog,createElementNS:()=>({setAttribute(){},append(){}}),body:{append(){}}},window:{notemind:{onDocumentProgress:()=>()=>{},ocrRead:()=>response,ocrCancel:id=>cancelled.push(id)}},activateTab:tab=>calls.push(['activate',tab]),restoreCaret:()=>calls.push(['caret']),insertText:text=>calls.push(['insert',text]),addTab:note=>notes.push(note),markDirty:()=>calls.push(['dirty'])};
 vm.createContext(context);vm.runInContext(readImage,context);
 return {context,controls,dialog,sourceTab,calls,notes,cancelled,resolveRead};
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
