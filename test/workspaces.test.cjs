const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {store,encode,decode}=require('../src/workspaces.cjs');
test('workspace registry queues updates and saved workspace preserves links',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-workspaces-'));
 try{const s=store(root),a={id:'a',name:'First',folders:['C:/Notes'],files:['C:/Draft.wm'],excluded:['C:/Notes/Hidden']},b={id:'b',name:'Second',folders:[]};await Promise.all([s.put(a),s.put(b)]);assert.equal((await s.list()).length,2);assert.deepEqual(decode(encode(a)),a);await s.put(a,true);assert.deepEqual(await s.list(),[b]);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('saved workspaces update atomically and imported metadata cannot choose its own destination',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-workspace-save-'));
 try{const file=path.join(root,'Project.wm'),s=store(path.join(root,'registry')),w={id:'saved',name:'Saved',folders:[],file};await s.put(w);w.folders.push(root);await s.put(w);const loaded=decode(await fs.readFile(file));assert.deepEqual(loaded.folders,[root]);assert.equal(loaded.file,undefined);}finally{await fs.rm(root,{recursive:true,force:true});}
});
