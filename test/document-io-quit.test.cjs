const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/document-io.cjs'),'utf8'),matches=[...source.matchAll(/app\.on\('will-quit',(event=>\{[^\n]*\})\);/g)];
assert.equal(matches.length,1,'Exercise the actual final document-service quit callback.');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({publicUsed=false,wordUsed=false,hostUsed=false}={}){
 let resolve,reject,disposals=0,quits=0,prevented=0;const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),logged=[];
 const scope=vm.createContext({wordPreviews:{started:()=>wordUsed},hostRaster:hostUsed?{}:null,publicOCR:publicUsed?{}:null,quitReady:false,quitWaiting:null,dispose(){disposals++;return pending},app:{quit(){quits++}},console:{error(...values){logged.push(values)}}});
 const callback=vm.runInContext('('+matches[0][1]+')',scope),run=()=>callback({preventDefault(){prevented++}});
 return{run,resolve,reject,logged,get disposals(){return disposals},get quits(){return quits},get prevented(){return prevented},get ready(){return scope.quitReady}};
}
test('final quit joins document cleanup even without Word or a raster host, including public OCR',async()=>{
 for(const options of[{}, {publicUsed:true},{wordUsed:true},{hostUsed:true}]){
  const f=fixture(options);f.run();assert.equal(f.prevented,1);assert.equal(f.quits,0);await tick();assert.equal(f.ready,false);assert.equal(f.quits,0);
  f.run();assert.equal(f.prevented,2);assert.equal(f.quits,0);f.resolve();await tick();assert.equal(f.ready,true);assert.equal(f.quits,1);f.run();assert.equal(f.prevented,2,'the completed cleanup permits actual quit');assert.equal(f.quits,1);
 }
});
test('a final cleanup rejection is observed and cannot authorize quit or become an uncaught rejection',async()=>{
 const f=fixture({publicUsed:true});f.run();f.reject(Error('transport receiver still owned'));await tick();assert.equal(f.quits,0);assert.equal(f.ready,false);assert.equal(f.logged.length,1);assert.match(String(f.logged[0][1]),/transport receiver still owned/);
});
