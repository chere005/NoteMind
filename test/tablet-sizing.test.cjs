const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm'),path=require('node:path');
const result=buildSync({entryPoints:['src/tablet/renderer/tabletPage.ts'],bundle:true,platform:'node',format:'cjs',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}),loaded={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process});
const {TabletPage,fitRect}=loaded.exports;
test('restored canonical drawings retain every supported aspect ratio and fit without stretching',()=>{
 for(const aspect of [.1,.125,1/3,.75,1,3,8,10]){
  const page=new TabletPage(aspect);assert.equal(page.aspect,aspect);page.setAspect(1);page.setAspect(aspect);assert.equal(page.aspect,aspect);
  for(const container of [{width:1080,height:1760},{width:1920,height:920},{width:460,height:700}]){
   const fit=fitRect(container,page.aspect);
   assert.ok(Math.abs(fit.width/fit.height-aspect)<1e-9);
   assert.ok(fit.width<=container.width&&fit.height<=container.height);
   assert.ok(Math.abs(fit.width-container.width)<1e-9||Math.abs(fit.height-container.height)<1e-9);
  }
 }
 for(const aspect of [NaN,Infinity,0,-1,.09,11])assert.equal(new TabletPage(aspect).aspect,16/9);
});
