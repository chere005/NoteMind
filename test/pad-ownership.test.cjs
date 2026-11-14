const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createPadOwnership}=require('../src/pad-ownership.cjs');
test('the latest focused project owns the pen display',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pad-owner-')),file=path.join(dir,'owner.json'),first=createPadOwnership({file,id:'one'}),second=createPadOwnership({file,id:'two'});
 try{await first.claim();await second.check();assert.equal(first.owned,true);assert.equal(second.owned,false);await second.claim();await first.check();assert.equal(first.owned,false);assert.equal(second.owned,true);await first.claim();await second.check();assert.equal(first.owned,true);assert.equal(second.owned,false);}
 finally{first.stop();second.stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('a project that loses ownership cannot keep the shared display active',async()=>{
 const {createPadController,FRAME}=require('../src/pad-controller.cjs'),{EventEmitter}=require('node:events'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pad-owners-')),file=path.join(dir,'owner.json');
 const screen=new EventEmitter(),primary={id:1,internal:true,workArea:{x:0,y:0,width:1200,height:800}},display={id:2,label:'Wacom One',bounds:{x:1200,y:0,width:1000,height:700}};screen.getAllDisplays=()=>[primary,display];screen.getPrimaryDisplay=()=>primary;
 const owner=()=>({getBounds:()=>({x:0,y:0,width:900,height:700}),setBounds(){},isVisible:()=>true,isFocused:()=>true});
 const a=createPadController({screen,owner:owner(),owned:false}),b=createPadController({screen,owner:owner(),owned:false});const first=createPadOwnership({file,id:'one',onChange:v=>a.setOwned(v)}),second=createPadOwnership({file,id:'two',onChange:v=>b.setOwned(v)});
 try{await first.claim();assert.equal(a.decision({frameName:FRAME,url:'about:blank'}).action,'allow');assert.equal(b.decision({frameName:FRAME,url:'about:blank'}).action,'deny');await second.claim();await first.check();assert.equal(a.decision({frameName:FRAME,url:'about:blank'}).action,'deny');assert.equal(b.decision({frameName:FRAME,url:'about:blank'}).action,'allow');}
 finally{first.stop();second.stop();a.dispose();b.dispose();await fs.rm(dir,{recursive:true,force:true});}
});
test('an older delayed focus claim cannot steal a newer claim',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pad-race-')),file=path.join(dir,'owner.json'),first=createPadOwnership({file,id:'old',clock:()=>100n}),second=createPadOwnership({file,id:'new',clock:()=>200n});
 try{await second.claim();await first.claim();await first.check();await second.check();assert.equal(first.owned,false);assert.equal(second.owned,true);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).id,'new');}
 finally{first.stop();second.stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('a saved owner from a previous boot cannot block the tablet toggle',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pad-reboot-')),file=path.join(dir,'owner.json');
 const first=createPadOwnership({file,id:'current'});
 try{
  const stamp=String(process.hrtime.bigint()+86400000000000n);
  for(const stale of [{id:'legacy',stamp},{id:'reused-pid',pid:process.pid,stamp}]){
   await fs.writeFile(file,JSON.stringify(stale));await first.check();assert.equal(first.owned,false);
   await first.claim();assert.equal(first.owned,true);
   const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.id,'current');assert.equal(saved.pid,process.pid);
  }
 }finally{first.stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('an exited owner cannot supersede a current focus claim',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pad-exited-')),file=path.join(dir,'owner.json'),first=createPadOwnership({file,id:'current',clock:()=>100n});
 try{await fs.writeFile(file,JSON.stringify({id:'exited',pid:0,stamp:'200'}));await first.claim();assert.equal(first.owned,true);}
 finally{first.stop();await fs.rm(dir,{recursive:true,force:true});}
});
