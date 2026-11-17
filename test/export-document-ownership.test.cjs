const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const noop=()=>{},tick=()=>new Promise(setImmediate),original=()=>({path:'/fixture/A.nm',text:'Note A',assets:{'assets/a.png':'ORIGINAL'},meta:{tags:['original']}}),other=()=>({path:'/fixture/B.nm',text:'Note B',assets:{},meta:{}});
function pdf(){
 const dom=domino.createWindow('<span id="status"></span>'),document=dom.document;dom.Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(node)};Object.defineProperty(dom.Element.prototype,'dataset',{configurable:true,get(){return {k:this.getAttribute('data-k')}}});Object.getPrototypeOf(document.querySelectorAll('input'))[Symbol.iterator]=Array.prototype[Symbol.iterator];
 const create=document.createElement.bind(document),geometries=[],previews=[],exports=[],a=original();let dialog;
 document.createElement=tag=>{const element=create(tag);if(tag==='dialog'){dialog=element;Object.defineProperties(element,{showModal:{value:noop},close:{value:()=>element.onclose()}})}return element};
 const c={document,doc:a,currentText:()=>c.doc.text,structuredClone,localStorage:{getItem:()=>null,setItem:noop},window:{addEventListener:noop,notemind:{pdfGeometry:()=>new Promise(resolve=>geometries.push(resolve)),printHtml:async snapshot=>(previews.push(snapshot),'<p>Preview</p>'),exportDocument:async snapshot=>(exports.push(snapshot),'/fixture/export.pdf')}},$:id=>document.getElementById(id)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/notes-pdf.js'),'utf8'),c);return {c,a,geometries,previews,exports,get dialog(){return dialog},geometry(){geometries.shift()({width:8.27,height:11.69,margins:{top:.75,bottom:.75,left:.75,right:.75}})}};
}
test('PDF preview and export use the initiating immutable document snapshot',async()=>{
 const h=pdf(),expected=structuredClone(h.a),exporting=h.c.window.NoteMindPdf.exportPdf();h.c.doc=other();h.a.assets['assets/a.png']='CHANGED';h.a.meta.tags.push('changed');h.geometry();await tick();h.dialog.querySelector('[data-go]').onclick();await exporting;
 assert.deepEqual(h.previews,[expected]);assert.deepEqual(h.exports,[expected]);
});
test('closing PDF options before geometry resolves prevents a detached preview',async()=>{
 const h=pdf(),exporting=h.c.window.NoteMindPdf.exportPdf();h.dialog.querySelector('[data-cancel]').onclick();h.geometry();await exporting;await tick();assert.deepEqual(h.previews,[]);assert.deepEqual(h.exports,[]);
});
test('Word export keeps its initiating document across an options wait',async()=>{
 const a=original(),expected=structuredClone(a),exports=[];let listener,choose;
 const c={doc:a,currentText:()=>c.doc.text,structuredClone,documentOptions:()=>new Promise(resolve=>choose=resolve),action:fn=>fn(),$:()=>({}),window:{addEventListener:(_name,fn)=>listener=fn,notemind:{exportDocument:async(snapshot,format)=>(exports.push({snapshot,format}),'/fixture/export.docx')}}};
 const handler=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8').split('\n').find(line=>line.startsWith("window.addEventListener('notemind-command',e=>action(async()=>"));vm.runInNewContext(handler,c);
 const exporting=listener({detail:'exportWord'});c.doc=other();a.assets['assets/a.png']='CHANGED';a.meta.tags.push('changed');choose({pageSize:'A4'});await exporting;assert.deepEqual(exports,[{snapshot:expected,format:'docx'}]);
});
