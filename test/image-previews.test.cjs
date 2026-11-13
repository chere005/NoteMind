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
