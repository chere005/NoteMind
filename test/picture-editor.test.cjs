const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const geometry=require('../src/picture-geometry.js');
test('crop rectangles clamp to the image and rotation swaps dimensions',()=>{
 assert.deepEqual(geometry.selection({x:110,y:70},{x:-5,y:10},100,50),{x:0,y:10,width:100,height:40});
 assert.deepEqual(geometry.output(800,600,90),{width:600,height:800});
 assert.deepEqual(geometry.output(800,600,180),{width:800,height:600});
});
test('editing one image creates an independent, undoable asset',async t=>{
 const previews=require('../src/image-previews.js').create();t.after(()=>previews.clear());
 const elements={};for(const key of ['canvas','[data-width]','[data-height]','[data-lock]','[data-act=crop]','.picture-message','[data-act=left]','[data-act=right]','[data-act=reset]','[data-act=cancel]','[data-act=apply]'])elements[key]={value:'',checked:true,disabled:false};
 const draws=[];function canvas(){return {width:0,height:0,getContext(){return {drawImage(...args){draws.push(args)},translate(){},rotate(){},save(){},restore(){},setLineDash(){},strokeRect(){}}},getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height}},setPointerCapture(){},toDataURL(){return 'data:image/png;base64,bmV3'}};}
 elements.canvas=canvas();const dialog={querySelector:key=>elements[key],showModal(){},close(){this.onclose()},remove(){}};
 const original={dataset:{asset:'assets/old.png'},isConnected:true,removeAttribute(name){delete this[name];}},tab={},calls=[];
 const context={NoteMindImagePreviews:previews,window:{},document:{createElement:tag=>tag==='dialog'?dialog:canvas(),body:{append(){}}},Image:class{constructor(){this.naturalWidth=400;this.naturalHeight=200}decode(){return Promise.resolve()}},activeTab:tab,doc:{assets:{'assets/old.png':'b2xk'}},assetUrl:()=>'',NoteMindPictureGeometry:geometry,crypto:{randomUUID:()=> 'new-id'},NoteMindHistory:{transaction:fn=>{calls.push('transaction');fn()}},markDirty:()=>calls.push('dirty'),richChanged:false};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../src/notes-picture.js'),'utf8'),context);
 await context.window.NoteMindPicture.edit(original);elements['[data-act=right]'].onclick();assert.equal(elements['[data-width]'].value,200);assert.equal(elements['[data-height]'].value,400);
 elements.canvas.onpointerdown({button:0,clientX:10,clientY:20,pointerId:1});elements.canvas.onpointerup({clientX:110,clientY:220});elements['[data-act=crop]'].onclick();assert.equal(elements['[data-width]'].value,100);assert.equal(elements['[data-height]'].value,200);
 elements['[data-width]'].value='50';elements['[data-width]'].oninput();assert.equal(elements['[data-height]'].value,100);elements['[data-act=apply]'].onclick();
 assert.equal(original.dataset.asset,'assets/picture-new-id.png');assert.equal(context.doc.assets['assets/old.png'],'b2xk');assert.equal(context.doc.assets['assets/picture-new-id.png'],'bmV3');assert.deepEqual(calls,['transaction','dirty']);assert.equal(context.richChanged,true);assert.ok(draws.length>0);
});
