const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(task){
 const source=fs.readFileSync(path.join(__dirname,'../src/document-worker.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/import\.meta\.url/g,JSON.stringify('file:///fixture/document-worker.js'));
 const context={window:{},pdfjs:{GlobalWorkerOptions:{},getDocument:()=>task},URL,Uint8Array,atob,textOfBlocks:()=>''};
 vm.runInNewContext(source,context);return context.window.documentTools;
}
test('PDF loading failures destroy their loading task',async()=>{
 let destroyed=0;const failure=Error('Password required'),tools=fixture({promise:Promise.reject(failure),destroy:async()=>destroyed++});
 await assert.rejects(tools.pdf('AA=='),error=>error===failure);assert.equal(destroyed,1);
});
test('successful PDF reads destroy their loading task',async()=>{
 let destroyed=0;const tools=fixture({promise:Promise.resolve({numPages:0}),destroy:async()=>destroyed++});
 const pages=await tools.pdf('AA==');assert.equal(pages.length,0);assert.equal(destroyed,1);
});
