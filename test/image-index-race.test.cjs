const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),fs=require('node:fs/promises'),{createIndexer}=require('../src/index-images.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),image=value=>({'assets/a.png':Buffer.from(value).toString('base64')}),doc=assets=>({id:'note',assets,meta:{}});
function setup(){const reads=[],writes=[],conversions=[];let cache={};const index=createIndexer({storage:{},activityMs:0,prepare:async(doc,{cached})=>({rows:Object.entries(doc.assets).map(([name,data])=>{const hash=createHash('sha256').update(Buffer.from(data,'base64')).digest('hex');return cached[name]?.hash===hash?{name,hash,text:cached[name].text}:{name,hash,source:{file:data},type:'image/png'}}),cleanup:async()=>{}}),store:{ocrCache:async()=>cache,indexText:async(id,values)=>{writes.push(values);cache=values}},documentIO:{convertImageFile:async data=>{conversions.push(data);return {data:Buffer.from(data,'base64')}},reader:{read:(bytes,options)=>new Promise((resolve,reject)=>{reads.push({bytes,options,resolve});options.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true})})}},send(){}});return {index,reads,writes,conversions};}
test('new images supersede in-flight OCR and all callers await the newest search result',async()=>{
 const h=setup(),first=h.index({},doc(image('old')));await tick();assert.equal(h.reads.length,1);
 const second=h.index({},doc(image('new')));await tick();assert.equal(h.reads[0].options.signal.aborted,true);assert.equal(h.reads.length,2);
 h.reads[0].resolve({text:'stale'});h.reads[1].resolve({text:'new text'});assert.deepEqual(await first,await second);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0]['assets/a.png'].text,'new text');
});
test('removing an image during OCR cannot restore its obsolete searchable text',async()=>{
 const h=setup(),first=h.index({},doc(image('old')));await tick();const second=h.index({},doc({}));await Promise.all([first,second]);assert.equal(h.writes.length,0);
});
test('unchanged cached images do not rewrite the library, but deleting the last image clears its search text',async()=>{
 const h=setup(),first=h.index({},doc(image('same')));await tick();h.reads[0].resolve({text:'indexed'});await first;assert.equal(h.writes.length,1);
 await h.index({},doc(image('same')),{background:true});assert.equal(h.reads.length,1);assert.equal(h.writes.length,1);
 await h.index({},doc({}),{background:true});assert.equal(h.writes.length,2);assert.deepEqual({...h.writes[1]},{});
});
test('automatic indexing yields to explicit reading while ordinary typing reuses unchanged input',async()=>{
 const h=setup(),first=h.index({},doc(image('same')),{background:true});await tick();assert.equal(h.reads[0].options.priority,'background');
 const typing=h.index({}, {...doc(image('same')),text:'only text changed'},{background:true});assert.equal(typing,first);assert.equal(h.reads.length,1);
 const manual=h.index({},doc(image('same')));await tick();assert.equal(h.reads[0].options.signal.aborted,true);assert.equal(h.reads[1].options.priority,'foreground');
 h.reads[1].resolve({text:'current'});await Promise.all([first,typing,manual]);assert.equal(h.writes.length,1);
});
test('completed image reads are reused when a newer snapshot adds another image',async()=>{
 const h=setup(),assets={...image('same'),'assets/b.png':Buffer.from('old b').toString('base64')},first=h.index({},doc(assets));await tick();h.reads[0].resolve({text:'A'});await tick();
 const next=h.index({},doc({...assets,'assets/b.png':Buffer.from('new b').toString('base64')}));await tick();assert.equal(h.reads.length,3);assert.equal(h.conversions.length,3);assert.equal(h.reads[2].bytes.toString(),'new b');
 h.reads[2].resolve({text:'new B'});await Promise.all([first,next]);assert.equal(h.writes[0]['assets/a.png'].text,'A');assert.equal(h.writes[0]['assets/b.png'].text,'new B');
});
test('raw image OCR spools bounded verified bytes and preserves the canonical caller source',async()=>{const {randomUUID}=require('node:crypto'),pixels=Buffer.from([1,2,3]),hash=createHash('sha256').update(pixels).digest('hex'),raw={rawAssetToken:randomUUID(),bytes:3,chars:4,epoch:1},written=[],sourceCalls=[];let hashes=0,conversions=0;const index=createIndexer({storage:{rawAssetInfo:async value=>{assert.equal(value,raw);hashes++;return{sha256:hash}},readRawAsset:async(value,{offset,length})=>{assert.equal(value,raw);return pixels.subarray(offset,offset+length)}},activityMs:0,store:{ocrCache:async()=>({}),indexText:async(_,values)=>written.push(values)},documentIO:{convertImageFile:async(file,type,options)=>{assert.equal(type,'image/png');assert.equal(options.sha256,hash);assert.deepEqual(await fs.readFile(file),pixels);conversions++;return{bytes:Uint8Array.from(pixels)}},reader:{read:async bytes=>{assert.deepEqual([...bytes],[1,2,3]);sourceCalls.push(bytes);return{text:'Visible pixels'}}}},send(){}});await index({},doc({'assets/raw.png':raw,'assets/raw.png.json':raw}));assert.equal(hashes,1);assert.equal(conversions,1);assert.equal(sourceCalls.length,1);assert.equal(written[0]['assets/raw.png'].hash,hash);assert.equal(written[0]['assets/raw.png'].text,'Visible pixels');assert.deepEqual([...pixels],[1,2,3]);await index.dispose();});
