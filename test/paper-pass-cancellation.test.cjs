const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
const output=esbuild.buildSync({entryPoints:['src/tablet/renderer/paperPass.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
function fixture(){const workers=[],module={exports:{}};class Worker{constructor(){workers.push(this)}postMessage(job){this.job=job}terminate(){}}class ImageData{constructor(data,width,height){Object.assign(this,{data,width,height})}}
 vm.runInNewContext(output,{module,exports:module.exports,require,Worker,ImageData,document:{baseURI:'file:///fixture/'},URL,setTimeout,console});let paints=0;const context={getImageData:()=>({data:new Uint8ClampedArray(16),width:2,height:2}),putImageData:()=>paints++},canvas={width:2,height:2,getContext:()=>context};return {...module.exports,canvas,workers,paints:()=>paints,reply:()=>workers[0].onmessage({data:{id:workers[0].job.id,pixels:new Uint8Array(16).buffer,cleaned:true}})};}
test('a background-removal reply cannot paint a view that was replaced or resized',async()=>{
 const f=fixture();let current=true;const first=f.cleanCanvas(f.canvas,{},()=>current);current=false;f.reply();assert.equal(await first,false);assert.equal(f.paints(),0);current=true;const second=f.cleanCanvas(f.canvas,{},()=>current);f.canvas.width=3;f.reply();assert.equal(await second,false);assert.equal(f.paints(),0);
});
test('a current background-removal reply still paints normally',async()=>{
 const f=fixture(),pending=f.cleanCanvas(f.canvas);f.reply();assert.equal(await pending,true);assert.equal(f.paints(),1);
});
