const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/notes-picture.js'),'utf8');
function fixture({failCapture=false,zoom=1}={}){
 const listeners=new Map(),commits=[],captures=new Set(),attributes=new Set();
 const handle={setPointerCapture(id){if(failCapture)throw Error('capture failed');captures.add(id)},hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
 const box={hidden:true,style:{},contains:()=>true,querySelector:key=>key==='.picture-resize-handle'?handle:{},querySelectorAll:()=>[]};
 const image={dataset:{asset:'assets/original.png'},isConnected:true,src:'placeholder',style:{removeProperty(key){delete this[key];}},
  getBoundingClientRect(){const width=(parseFloat(this.style.width)||200)*zoom;return {left:10,top:20,width,height:width/2}},
  setAttribute:key=>attributes.add(key),removeAttribute:key=>attributes.delete(key),closest:()=>image,contains:()=>false};
 const context={activeTab:{},visual:true,doc:{assets:{'assets/original.png':'OLD'}},
  rich:{addEventListener:(type,fn)=>listeners.set(type,fn),contains:()=>true,querySelectorAll:()=>[image]},
  window:{addEventListener(){}},document:{body:{append(){}},addEventListener(){},createElement:()=>box},
  MutationObserver:class{observe(){}},getComputedStyle:()=>({zoom}),alert:error=>assert.fail(error),
  markDirty:()=>commits.push(image.style.width),NoteMindHistory:{transaction:run=>run()}};
 vm.runInNewContext(source,context);listeners.get('click')({target:image});
 const event=(pointerId=1,clientX=20,type='pointerdown',clientY=0)=>({pointerId,button:0,clientX,clientY,type,preventDefault(){},stopPropagation(){}});
 return{handle,image,commits,event,captures,context,attributes};
}
test('a second pointer cannot replace a picture display resize',()=>{const f=fixture();f.handle.onpointerdown(f.event());f.handle.onpointerdown(f.event(2));assert.deepEqual([...f.captures],[1]);f.handle.onpointerup(f.event(1,120,'pointerup'));assert.deepEqual(f.commits,['300px']);});
for(const callback of ['onpointermove','onpointerup','onpointercancel','onlostpointercapture'])test('picture resize ignores foreign '+callback,()=>{
 const f=fixture();f.handle.onpointerdown(f.event());f.handle.onpointermove(f.event(1,120,'pointermove'));f.handle[callback](f.event(2,180,callback.slice(2)));
 assert.equal(f.image.style.width,'300px');assert.equal(f.commits.length,0);assert.deepEqual([...f.captures],[1]);
 f.handle.onpointerup(f.event(1,120,'pointerup'));assert.deepEqual(f.commits,['300px']);
});
test('resizing saves a document width at any zoom without changing the original asset',()=>{
 const f=fixture({zoom:2});f.handle.onpointerdown(f.event());f.handle.onpointerup(f.event(1,120,'pointerup'));
 assert.deepEqual(f.commits,['250px']);assert.equal(f.context.doc.meta.imageWidths['assets/original.png'],250);
 assert.equal(f.context.doc.assets['assets/original.png'],'OLD');assert.ok(f.attributes.has('data-image-width'));assert.equal(f.captures.size,0);
});
test('dragging vertically also resizes in proportion to the image',()=>{const f=fixture();f.handle.onpointerdown(f.event());f.handle.onpointerup(f.event(1,20,'pointerup',25));assert.deepEqual(f.commits,['250px']);});
test('picture resize cancels if the original tab, image or asset changes',()=>{for(const change of ['tab','detached','changed']){
 const f=fixture();f.handle.onpointerdown(f.event());f.handle.onpointermove(f.event(1,120,'pointermove'));
 if(change==='tab')f.context.activeTab={};else if(change==='detached')f.image.isConnected=false;else f.context.doc.assets[f.image.dataset.asset]='REPLACED';
 f.handle.onpointerup(f.event(1,120,'pointerup'));assert.equal(f.commits.length,0);assert.equal(f.image.style.width,undefined);assert.equal(f.captures.size,0);
}});
test('picture resize does not start when pointer capture fails',()=>{const f=fixture({failCapture:true});f.handle.onpointerdown(f.event());f.handle.onpointerup(f.event(1,120,'pointerup'));assert.equal(f.commits.length,0);});
test('lazy preview materialization does not affect a display-only resize',()=>{const f=fixture();f.handle.onpointerdown(f.event());f.image.src='loaded';f.handle.onpointerup(f.event(1,120,'pointerup'));assert.deepEqual(f.commits,['300px']);});
test('capture loss cancels only the gesture that no longer holds the pointer',()=>{const f=fixture();f.handle.onpointerdown(f.event());f.handle.onpointermove(f.event(1,120,'pointermove'));
 f.handle.onlostpointercapture(f.event(1,120,'lostpointercapture'));assert.equal(f.image.style.width,'300px');f.captures.delete(1);
 f.handle.onlostpointercapture(f.event(1,120,'lostpointercapture'));assert.equal(f.image.style.width,undefined);assert.equal(f.commits.length,0);
});
function cropFixture(){
 const controls={};for(const key of ['[data-width]','[data-height]','[data-lock]','[data-act=crop]','.picture-message','[data-act=left]','[data-act=right]','[data-act=reset]','[data-act=cancel]','[data-act=apply]'])controls[key]={value:'',checked:true,disabled:false};
 const outlines=[],capture=new Set(),canvas={width:0,height:0,getContext:()=>({drawImage(){},save(){},restore(){},setLineDash(){},strokeRect(...values){outlines.push(values)}}),getBoundingClientRect(){return{left:0,top:0,width:this.width,height:this.height}},setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)};controls.canvas=canvas;
 const dialog={querySelector:key=>controls[key],showModal(){},close(){this.onclose()},remove(){}},image={dataset:{asset:'assets/a.png'},naturalWidth:400,naturalHeight:200,isConnected:true},tab={},context={activeTab:tab,doc:{assets:{'assets/a.png':'OLD'}},window:{},document:{body:{append(){}},createElement:tag=>tag==='dialog'?dialog:{width:0,height:0,getContext:()=>({drawImage(){},translate(){},rotate(){}})}},NoteMindImagePreviews:{pin:()=>()=>{},ensure:async()=>image},NoteMindPictureGeometry:require('../src/picture-geometry.js')};
 vm.runInNewContext(source,context);const event=(pointerId=1,clientX=10,clientY=10,type='pointerdown')=>({pointerId,button:0,clientX,clientY,type});return{canvas,controls,capture,outlines,event,open:()=>context.window.NoteMindPicture.edit(image),close:()=>dialog.close()};
}
for(const callback of ['onpointermove','onpointerup','onpointercancel'])test('picture crop ignores foreign '+callback,async()=>{const f=cropFixture();await f.open();f.canvas.onpointerdown(f.event());f.canvas.onpointermove(f.event(1,110,60,'pointermove'));const selected=f.outlines.at(-1);f.canvas[callback](f.event(2,210,160,callback.slice(2)));assert.deepEqual(f.outlines.at(-1),selected);f.canvas.onpointerup(f.event(1,110,60,'pointerup'));f.controls['[data-act=crop]'].onclick();assert.equal(f.controls['[data-width]'].value,100);assert.equal(f.controls['[data-height]'].value,50);f.close();});
test('a second crop pointer cannot replace the initiating selection',async()=>{const f=cropFixture();await f.open();f.canvas.onpointerdown(f.event());f.canvas.onpointerdown(f.event(2,50,50));f.canvas.onpointerup(f.event(1,110,60,'pointerup'));f.controls['[data-act=crop]'].onclick();assert.equal(f.controls['[data-width]'].value,100);assert.equal(f.controls['[data-height]'].value,50);f.close();});
test('lost crop capture cancels its live selection and ignores subsequent samples',async()=>{const f=cropFixture();await f.open();f.canvas.onpointerdown(f.event());f.canvas.onpointermove(f.event(1,110,60,'pointermove'));f.capture.delete(1);f.canvas.onlostpointercapture?.(f.event(1,110,60,'lostpointercapture'));f.canvas.onpointerup(f.event(1,210,160,'pointerup'));assert.equal(f.controls['[data-act=crop]'].disabled,true);f.close();});

test('late crop capture loss leaves a successor that already owns the same pointer intact',async()=>{const f=cropFixture();await f.open();f.canvas.onpointerdown(f.event());f.canvas.onpointerup(f.event(1,110,60,'pointerup'));f.canvas.onpointerdown(f.event());f.canvas.onlostpointercapture(f.event(1,110,60,'lostpointercapture'));f.canvas.onpointerup(f.event(1,210,160,'pointerup'));f.controls['[data-act=crop]'].onclick();assert.equal(f.controls['[data-width]'].value,200);assert.equal(f.controls['[data-height]'].value,150);f.close();});
