const test=require('node:test'),assert=require('node:assert/strict'),{applyCameraRescan}=require('../src/camera-rescan.js');
test('rescan follows original page through reorder without changing an unrelated view',async()=>{
 const a={},b={},target={page:a},mode={rescan:target,source:'tablet',documentId:null,showing:true};let sheets=[{page:a},{page:b}],applied;
 const result=await applyCameraRescan(target,'captured',{getMode:()=>mode,getSheets:()=>sheets,ensure:async()=>{sheets.reverse()},onApplied:(owner,options)=>{applied={owner,options}}});
 assert.equal(result,true);assert.equal(a.backdrop,'captured');assert.equal(b.backdrop,undefined);assert.equal(applied.owner,a);assert.equal(applied.options.focus,false);
});
test('closed/replaced rescan owner cannot receive a late picture',async()=>{
 const page={},target={page},mode={rescan:target,source:'camera',showing:true};let sheets=[{page}];const options={getMode:()=>mode,getSheets:()=>sheets,ensure:async()=>{mode.rescan={page}},onApplied:()=>assert.fail('late apply')};
 assert.equal(await applyCameraRescan(target,'late',options),false);assert.equal(page.backdrop,undefined);
 mode.rescan=target;options.ensure=async()=>{sheets=[]};assert.equal(await applyCameraRescan(target,'late',options),false);assert.equal(page.backdrop,undefined);
});

test('rescan waits for the owned background signature gate and preserves its cancellation',async()=>{
 const page={},target={page},mode={rescan:target,source:'camera',showing:true},sheets=[{page}];let resolve,applied=0;page.setBackdropAsync=async(value,{valid})=>{await new Promise(done=>resolve=done);if(!valid())return false;page.backdrop=value;return true};const options={getMode:()=>mode,getSheets:()=>sheets,ensure:async()=>{},onApplied:()=>applied++};const pending=applyCameraRescan(target,'captured',options);await Promise.resolve();assert.equal(page.backdrop,undefined);mode.rescan=null;resolve();assert.equal(await pending,false);assert.equal(page.backdrop,undefined);assert.equal(applied,0);
});
