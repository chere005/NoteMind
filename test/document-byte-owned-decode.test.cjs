const{test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{randomUUID}=require('node:crypto'),factory=require('../src/document-byte-tools.js');
function fixture({fast=true,intrinsic=true,owned=true,custom}={}){
 const calls={intrinsic:0,atob:0,from:0},decoded=[],context=vm.createContext({crypto:{randomUUID},setTimeout,clearTimeout,btoa,atob:value=>{calls.atob++;return atob(value);}}),Original=vm.runInContext('Uint8Array',context);
 context.Uint8Array=new Proxy(Original,{get(target,key,receiver){if(key==='fromBase64')return intrinsic?(...args)=>{calls.intrinsic++;const bytes=Reflect.apply(target.fromBase64,target,args);decoded.push(bytes);return bytes;}:undefined;if(key==='from')return(...args)=>{calls.from++;const bytes=Reflect.apply(target.from,receiver,args);decoded.push(bytes);return bytes;};return Reflect.get(target,key,receiver);}});
 const make=vm.runInContext('('+factory.toString()+')',context),options={consumeOwned:owned,decodeOwnedBase64:fast,uuid:randomUUID};if(custom)options.decode=custom;
 return{bytes:make(options),calls,decoded,Original};
}
function result(h,text){let id;try{let length;try{length=atob(text).length}catch{length=1;}id=h.bytes.begin(Math.max(1,length));h.bytes.write(id,0,text);const taken=h.bytes.take({documentByteInput:id});return{hex:Buffer.from(taken.bytes).toString('hex')};}catch(error){return{name:error.name,message:error.message};}finally{if(id)h.bytes.release(id);}}
test('owned canonical chunks use the pinned intrinsic with exact bytes and deterministic input retirement',()=>{
 assert.equal(typeof Uint8Array.fromBase64,'function','pinned runtime capability');
 for(const length of[1,2,3,4,31,196605,196606,196607,196608]){const input=Buffer.allocUnsafe(length);let seed=length;for(let at=0;at<input.length;at++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;input[at]=seed&255;}const h=fixture(),id=h.bytes.begin(length);h.bytes.write(id,0,input.toString('base64'));const taken=h.bytes.take({documentByteInput:id});assert.deepEqual(Buffer.from(taken.bytes),input);assert.deepEqual(h.calls,{intrinsic:1,atob:0,from:0});assert.equal(h.decoded[0].byteLength,0);h.bytes.release(id);assert.equal(taken.bytes.byteLength,0);assert.equal(h.bytes.stats().bytes,0);}
});
test('intrinsic and fallback preserve legacy decoded bytes and exact errors for padding, whitespace and malformed input',()=>{
 for(const text of['','A','AA','AAA','AAAA','AA==','AB==','AQ==','AQ=','AQI=','AQI','AQID','AQID\n','AQID!','ÄA==','A===','====',' AA== \t','AA=\n=']){const old=result(fixture({fast:false}),text);for(const intrinsic of[false,true])assert.deepEqual(result(fixture({intrinsic}),text),old,JSON.stringify({text,intrinsic}));}
 for(const text of['AB==','Zh==','AQJ=']){const h=fixture();result(h,text);assert.equal(h.calls.intrinsic,0,'noncanonical overflow bits retain atob semantics');assert.equal(h.calls.atob,1);assert.equal(h.calls.from,0);}
});
test('preallocated fallback avoids the string iterator when the intrinsic is unavailable',()=>{
 const h=fixture({intrinsic:false}),input=Buffer.alloc(196608,57),id=h.bytes.begin(input.length);h.bytes.write(id,0,input.toString('base64'));const taken=h.bytes.take({documentByteInput:id});assert.deepEqual(Buffer.from(taken.bytes),input);assert.deepEqual(h.calls,{intrinsic:0,atob:1,from:0});h.bytes.release(id);assert.equal(taken.bytes.byteLength,0);
});
test('default and borrowed factories retain their original decoder path and custom callbacks always win',()=>{
 for(const options of[{fast:false},{owned:false}]){const h=fixture(options);assert.deepEqual(result(h,'AQ=='),{hex:'01'});assert.deepEqual(h.calls,{intrinsic:0,atob:1,from:1});}
 let customCalls=0;const h=fixture({custom:()=>{customCalls++;return Uint8Array.of(73)}});assert.deepEqual(result(h,'AQ=='),{hex:'49'});assert.equal(customCalls,1);assert.deepEqual(h.calls,{intrinsic:0,atob:0,from:0});
});
