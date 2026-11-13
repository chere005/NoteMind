const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Project windows run in separate processes. The latest focus event owns the shared display.
function createPadOwnership({file,id=crypto.randomUUID(),onChange=()=>{},interval=250,clock=()=>process.hrtime.bigint()}){
 let owned=false,closed=false,timer=null,serial=Promise.resolve();
 function update(value){if(owned===value)return;owned=value;onChange(value);}
 async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}}
 async function check(){if(closed)return;const data=await read();if(!closed)update(data?.id===id);}
 async function lock(){for(let i=0;i<100;i++){try{return await fs.open(file+'.lock','wx');}catch(error){if(error.code!=='EEXIST')throw error;try{const stat=await fs.stat(file+'.lock');if(Date.now()-stat.mtimeMs>30000)await fs.unlink(file+'.lock');}catch{}await new Promise(resolve=>setTimeout(resolve,30));}}throw Error('Pen display is busy; try again.');}
 function claim(){
  const stamp=clock();serial=serial.catch(()=>{}).then(async()=>{if(closed)return;await fs.mkdir(path.dirname(file),{recursive:true});const guard=await lock();
   try{const current=await read();let previous=-1n;try{previous=BigInt(current?.stamp??-1);}catch{}if(!closed&&previous<=stamp){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify({id,stamp:String(stamp)}),{flag:'wx'});if(!closed)await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}}
   finally{await guard.close();await fs.unlink(file+'.lock').catch(()=>{});}await check();
  });return serial;
 }
 function start(){if(timer||closed)return;timer=setInterval(()=>check().catch(()=>{}),interval);timer.unref?.();void check().catch(()=>{});}
 function stop(){closed=true;if(timer)clearInterval(timer);timer=null;update(false);}
 return {claim,check,start,stop,get owned(){return owned;}};
}
module.exports={createPadOwnership};
