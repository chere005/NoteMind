// Isolated publisher fixtures install the actual renderer helper and its DOM contract.
const fs=require('node:fs'),vm=require('node:vm');
function install(context,source=fs.readFileSync(require.resolve('../../src/renderer.js'),'utf8')){
 context.sourceCarets ||=new WeakMap();
 if(context.rich&&!('firstChild'in context.rich))Object.defineProperty(context.rich,'firstChild',{get(){return this.innerHTML?{}:null;}});
 if(context.source&&!('textLength'in context.source))Object.defineProperty(context.source,'textLength',{get(){return this.value?.length||0;}});
 const code=source.match(/^function sourceCaret.*$/m)[0]+'\n'+source.match(/^function refreshEditor[\s\S]*?^}/m)[0];
 if(vm.isContext(context))vm.runInContext(code,context);else vm.runInNewContext(code,context);
}
module.exports={install};
