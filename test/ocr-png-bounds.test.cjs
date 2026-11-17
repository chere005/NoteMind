const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm'),zlib=require('node:zlib'),fs=require('node:fs');
const code=buildSync({entryPoints:['src/ocr/png.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
function decoder(){const calls=[],module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,Buffer,require:name=>name==='node:zlib'?{inflateSync:(bytes,options)=>{calls.push(options);return zlib.inflateSync(bytes,options)}}:require(name)});return {...module.exports,calls};}
function chunk(type,body){const header=Buffer.alloc(8);header.writeUInt32BE(body.length);header.write(type,4);return Buffer.concat([header,body,Buffer.alloc(4)]);}
function png(width,height,pixels,{interlace=0,depth=8,colour=6,raw,headerPatch}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=colour;header[12]=interlace;headerPatch?.(header);let rows=[];if(raw)rows=raw;else{const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];for(const[x0,y0,dx,dy]of passes){const w=Math.ceil((width-x0)/dx),h=Math.ceil((height-y0)/dy);if(w<=0||h<=0)continue;for(let y=y0;y<height;y+=dy){rows.push(0);for(let x=x0;x<width;x+=dx)rows.push(...pixels.slice((y*width+x)*4,(y*width+x+1)*4));}}}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from(rows))),chunk('IEND',Buffer.alloc(0))]);}
test('normal and Adam7 PNG preserve pixels with exact bounded inflation, including empty passes',()=>{
 for(const size of [[9,7],[1,1],[3,2]])for(const interlace of[0,1]){const[w,h]=size,pixels=Array.from({length:w*h*4},(_,i)=>i%4===3?255:(i*37)%256),d=decoder(),value=d.decodePng(png(w,h,pixels,{interlace}));assert.equal(value.width,w);assert.equal(value.height,h);assert.deepEqual([...value.data],pixels);assert.equal(d.calls.length,1);assert.ok(d.calls[0].maxOutputLength>0&&d.calls[0].maxOutputLength<=pixels.length+h*7);}
 for(const name of['ocr-english.png','ocr-japanese.png','ocr-handwriting.png']){const d=decoder(),value=d.decodePng(fs.readFileSync('test/fixtures/'+name));assert.equal(value.data.length,value.width*value.height*4);assert.equal(d.calls.length,1);}
});
test('excessive dimensions and pixels reject before inflation or output allocation',()=>{
 for(const[w,h]of[[4001,4000],[32769,1],[0xffffffff,0xffffffff]]){const d=decoder();assert.throws(()=>d.decodePng(png(w,h,[],{raw:[0]})),/too large/);assert.equal(d.calls.length,0);}
});
test('inflation cannot exceed declared normal or Adam7 scanline sizes; short data cannot silently decode',()=>{
 for(const interlace of[0,1]){const d=decoder();assert.throws(()=>d.decodePng(png(1,1,[],{interlace,raw:Array(1024).fill(0)})));assert.equal(d.calls.length,1);assert.equal(d.calls[0].maxOutputLength,5);}
 const d=decoder();assert.throws(()=>d.decodePng(png(2,1,[],{raw:[0,1,2,3,255]})),/incomplete/);
});
test('illegal encodings and truncated PNG chunks reject safely',()=>{
 for(const options of[{depth:0},{depth:4,colour:6},{interlace:2},{headerPatch:h=>h[10]=1}]){const d=decoder();assert.throws(()=>d.decodePng(png(1,1,[0,0,0,255],options)),/unsupported/);assert.equal(d.calls.length,0);}
 const bytes=png(1,1,[0,0,0,255]);assert.throws(()=>decoder().decodePng(bytes.subarray(0,bytes.length-6)),/truncated/);
});
