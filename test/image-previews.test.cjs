const {test}=require('node:test'),assert=require('node:assert/strict');
const {imageDimensions,render,toMarkdown}=require('../src/document-renderer.cjs'),{create}=require('../src/image-previews.js');
test('preview dimensions are cached with the blob URL and reserve responsive image space',()=>{
 const cache=create(),name='assets/picture.svg',data=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900"/></svg>').toString('base64');
 try{const size=cache.size(name,data,'image/svg+xml'),url=cache.url(name,data,'image/svg+xml');assert.deepEqual(size,{width:600,height:900});assert.equal(cache.size('another.svg',data,'image/svg+xml'),size);assert.equal(cache.url(name,data,'image/svg+xml'),url);
  const text='![Picture]('+name+')',html=render(text,{[name]:data},{graphicsPanes:{[name]:{version:1}}},cache.url,cache.size);assert.match(html,/width="600" height="900"/);assert.match(html,/loading="lazy" decoding="async"/);assert.ok(!html.includes(data));assert.equal(toMarkdown(html),text);
 }finally{cache.clear();}
 assert.equal(imageDimensions(new Uint8Array([1,2,3])),null);
});
test('JPEG EXIF orientation reserves the displayed dimensions before pixels decode',()=>{
 for(let orientation=1;orientation<=8;orientation++){
  const exif=Buffer.alloc(32);exif.write('Exif',0);exif.write('II',6);exif.writeUInt16LE(42,8);exif.writeUInt32LE(8,10);exif.writeUInt16LE(1,14);exif.writeUInt16LE(274,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(orientation,24);
  const prefix=Buffer.from([255,216,255,225,0,34]),frame=Buffer.from([255,192,0,17,8,0,100,0,200,3,1,17,0,2,17,0,3,17,0,255,217]);
  assert.deepEqual(imageDimensions(Buffer.concat([prefix,exif,frame])),orientation>=5?{width:100,height:200}:{width:200,height:100});
 }
});
function lazyScene(options={}){
 let next=0,created=0,revoked=[],decoded=[],images=[],assets={},viewport={top:0,bottom:400};
 const cache=create({lazy:true,margin:0,maxBytes:options.maxBytes??70,maxEntries:options.maxEntries??2048,schedule:()=>{},viewport:()=>viewport,decode:data=>{decoded.push(data.length);return Buffer.from(data,'base64');},urls:{createObjectURL:()=>{created++;return 'blob:test-'+(++next);},revokeObjectURL:url=>revoked.push(url)},...options});
 const host={hidden:false,querySelectorAll:()=>images,contains:img=>images.includes(img)};
 function asset(i,padding=0){const data=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"/>'+ ' '.repeat(padding)+i).toString('base64'),name='assets/'+i+'.svg';assets[name]=data;return{name,data,type:'image/svg+xml'};}
 function image(value,top=0){const attrs={src:cache.url(value.name,value.data,value.type)},img={dataset:{asset:value.name},width:600,height:900,top,isConnected:true,getAttribute:key=>attrs[key]??null,removeAttribute:key=>delete attrs[key],getBoundingClientRect(){return{top:this.top,bottom:this.top+300,width:200,height:300};},decode:async()=>{}};Object.defineProperty(img,'src',{get:()=>attrs.src,set:value=>attrs.src=value});images.push(img);return img;}
 cache.mount(host,()=>assets);
 return{cache,asset,image,host,get created(){return created},get revoked(){return revoked},get decoded(){return decoded},get assets(){return assets},set assets(value){assets=value},set images(value){images=value},get images(){return images},set viewport(value){viewport=value}};
}
test('lazy previews reserve dimensions for one hundred distinct large assets without materializing their pixels',()=>{
 const scene=lazyScene();try{for(let i=0;i<100;i++){const value=scene.asset(i,100000);assert.match(scene.cache.url(value.name,value.data,value.type),/^data:image\/svg\+xml/);assert.deepEqual(scene.cache.size(value.name,value.data,value.type),{width:600,height:900});}assert.equal(scene.created,0);assert.ok(Math.max(...scene.decoded)<=Math.ceil(65536/3)*4);assert.equal(scene.cache.stats().blobBytes,0);}finally{scene.cache.clear();}
});
test('scrolling releases offscreen image sources and bounds unpinned blob bytes',()=>{
 const scene=lazyScene();try{const a=scene.image(scene.asset(1)),b=scene.image(scene.asset(2),1000);scene.cache.refresh();assert.match(a.src,/^blob:/);assert.match(b.src,/^data:/);assert.equal(scene.created,1);a.top=-1000;b.top=0;scene.cache.refresh();assert.match(a.src,/^data:/);assert.match(b.src,/^blob:/);assert.equal(scene.created,2);assert.equal(scene.revoked.length,1);assert.ok(scene.cache.stats().blobBytes<=70);}finally{scene.cache.clear();}
});
test('tab returns reuse bounded cached URLs and closed tab data is pruned after its DOM detaches',()=>{
 const scene=lazyScene({maxBytes:1024});try{const av=scene.asset(1),bv=scene.asset(2),a=scene.image(av);scene.cache.retainMany([{[av.name]:av.data},{[bv.name]:bv.data}]);scene.cache.refresh();const first=a.src;scene.images=[];scene.cache.refresh();const b=scene.image(bv);scene.cache.refresh();scene.images=[];scene.cache.refresh();const again=scene.image(av);scene.cache.refresh();assert.equal(again.src,first);assert.equal(scene.created,2);scene.cache.retainMany([{[av.name]:av.data}]);assert.equal(scene.cache.stats().entries,1);assert.ok(scene.revoked.includes(b.src) || scene.revoked.length===1);scene.cache.retainMany([]);scene.images=[];scene.cache.refresh();assert.equal(scene.cache.stats().entries,0);}finally{scene.cache.clear();}
});
test('an explicit image action waits for real pixels, pins its source, and rejects an obsolete image',async()=>{
 const scene=lazyScene();try{const img=scene.image(scene.asset(1),1000);let ready;img.decode=()=>new Promise(resolve=>{ready=resolve});let called=false;const work=scene.cache.withImage(img,()=>{called=true;assert.match(img.src,/^blob:/)});assert.match(img.src,/^blob:/);scene.cache.refresh();assert.match(img.src,/^blob:/);assert.equal(called,false);ready();await work;scene.cache.refresh();assert.equal(called,true);assert.match(img.src,/^data:/);
 let ready2;img.decode=()=>new Promise(resolve=>{ready2=resolve});const stale=scene.cache.withImage(img,()=>assert.fail('stale image must never be drawn'));scene.images=[];scene.cache.refresh();ready2();await assert.rejects(stale,/no longer open/);assert.equal(scene.cache.stats().active,0);
 }finally{scene.cache.clear();}
});
test('simultaneous aliases share one image blob until the last visible alias leaves',()=>{
 const scene=lazyScene();try{const value=scene.asset(1),a=scene.image(value),b=scene.image(value,10);scene.cache.refresh();assert.equal(scene.created,1);assert.equal(a.src,b.src);a.top=-1000;scene.cache.refresh();assert.match(a.src,/^data:/);assert.match(b.src,/^blob:/);assert.equal(scene.revoked.length,0);b.top=-1000;scene.cache.refresh();assert.equal(scene.revoked.length,0);assert.equal(scene.cache.stats().active,0);}finally{scene.cache.clear();}
});
