const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),geometry=require('../src/picture-geometry.js'),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const clicks={},draws=[],commits=[],errors=[],rotations=[{dataset:{rotate:'90'}},{dataset:{rotate:'-90'}}],handle={setPointerCapture(){}},edit={},tab={},img={dataset:{asset:'assets/image.png'},src:'data:image/svg+xml,placeholder',naturalWidth:600,naturalHeight:900,clientWidth:400,isConnected:true,style:{removeProperty(key){delete this[key];}},getBoundingClientRect:()=>({left:0,top:0,width:400,height:600}),getAttribute:key=>key==='style'?null:null,removeAttribute(){},setAttribute(){},addEventListener(){}};
 const box={hidden:true,innerHTML:'',style:{},contains:()=>false,querySelectorAll:()=>rotations,querySelector:selector=>selector==='[data-edit]'?edit:handle},rich={querySelectorAll:()=>[img],contains:value=>value===img,addEventListener:(name,fn)=>clicks[name]=fn};let releaseCount=0,resolve;const loaded=new Promise(done=>resolve=()=>{img.src='blob:real';done(img)});
 const previews={pin:()=>{img.src='blob:real';return ()=>releaseCount++},ensure:()=>loaded,withImage:async(image,run)=>{await loaded;return run(image)},apply:(image,name)=>{commits.push(name);image.dataset.asset=name;image.src='blob:changed';}};
 const canvas=()=>({width:0,height:0,getContext:()=>({translate(){},rotate(){},drawImage:image=>draws.push(image.src)}),toDataURL:()=> 'data:image/png;base64,cGl4ZWxz'});
 const context={window:{addEventListener(){}},document:{createElement:tag=>tag==='div'?box:canvas(),addEventListener(){},body:{append(){}}},rich,visual:true,activeTab:tab,doc:{assets:{'assets/image.png':'original'}},getComputedStyle:()=>({zoom:1}),NoteMindImagePreviews:previews,NoteMindPictureGeometry:geometry,NoteMindHistory:{transaction:fn=>fn()},markDirty(){},crypto:{randomUUID:()=> 'new'},MutationObserver:class{observe(){}},alert:error=>errors.push(error)};vm.runInNewContext(fs.readFileSync(require.resolve('../src/notes-picture.js'),'utf8'),context);clicks.click({target:{closest:()=>img}});return {context,rotations,handle,img,draws,commits,errors,resolve,get releases(){return releaseCount},event:{button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}}};
}
test('quick rotation waits for decoded pixels and cannot rasterize a lazy placeholder',async()=>{const f=fixture();f.rotations[0].onclick();assert.equal(f.draws.length,0);f.resolve();await tick();assert.deepEqual(f.draws,['blob:real']);assert.equal(f.commits.length,1);assert.equal(f.errors.length,0);});
test('changing tabs while rotation decodes does not write into either note',async()=>{const f=fixture();f.rotations[0].onclick();f.context.activeTab={};f.resolve();await tick();assert.equal(f.draws.length,0);assert.equal(f.commits.length,0);});
test('a lazy picture can be resized before any pixels are decoded',async()=>{
 const f=fixture(),original=f.img.src;
 f.handle.onpointerdown(f.event);f.handle.onpointerup({...f.event,clientX:100});
 assert.equal(f.context.doc.meta.imageWidths['assets/image.png'],500);
 assert.equal(f.context.doc.assets['assets/image.png'],'original');
 assert.equal(f.img.src,original);assert.equal(f.draws.length,0);assert.equal(f.commits.length,0);assert.equal(f.releases,0);
 f.resolve();await tick();assert.equal(f.img.style.width,'500px');assert.equal(f.img.src,'blob:real');
});
test('cancelled or closed-image resize restores the original width without loading pixels',()=>{
 for(const cancel of [true,false]){
  const f=fixture(),original=f.img.src;
  f.handle.onpointerdown(f.event);f.handle.onpointermove({...f.event,clientX:100});
  if(!cancel)f.img.isConnected=false;
  (cancel?f.handle.onpointercancel:f.handle.onpointerup)({...f.event,clientX:100});
  assert.equal(f.img.style.width,undefined);assert.equal(f.context.doc.meta,undefined);
  assert.equal(f.img.src,original);assert.equal(f.draws.length,0);assert.equal(f.commits.length,0);assert.equal(f.releases,0);
 }
});
