const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('file undo restores renamed, duplicated and trashed items without overwriting conflicts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-actions-'));let counter=0;
 const actions=require('../src/file-actions.cjs')(path.join(root,'backups'),file=>fs.rename(file,path.join(root,'trash-'+counter++)));
 try{const a=path.join(root,'a.md'),b=path.join(root,'b.md'),copy=path.join(root,'copy.md');await fs.writeFile(a,'original');await actions.rename(a,b);await actions.step('undo');assert.equal(await fs.readFile(a,'utf8'),'original');await actions.step('redo');await actions.duplicate(b,copy);await actions.step('undo');await actions.step('redo');assert.equal(await fs.readFile(copy,'utf8'),'original');await actions.trash(copy);await fs.writeFile(copy,'new');await assert.rejects(actions.step('undo'),/already exists/);await fs.unlink(copy);await actions.step('undo');assert.equal(await fs.readFile(copy,'utf8'),'original');}finally{await fs.rm(root,{recursive:true,force:true});}
});
