const {spawn,execFile}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path');
const profile=path.resolve(__dirname,'../test-results/portable-'+Date.now()),port=9338;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={profile,checks:[]};let socket,childPid,appProcess;
async function waitFor(test){for(let i=0;i<80;i++){const result=await test().catch(()=>null);if(result)return result;await pause(100);}throw Error('Timed out');}
function closeWindow(pid){const data=pid===appProcess?.pid?profile:path.join(profile,'workspaces/portable-test');return new Promise(resolve=>{const child=spawn(path.resolve(__dirname,'../dist/NoteMind/NoteMind.exe'),['--close-window'],{windowsHide:true,stdio:'ignore',env:{...process.env,NOTEMIND_DATA:data,NOTEMIND_HOME:profile}});child.once('exit',resolve);child.once('error',resolve);});}
(async()=>{await fs.mkdir(profile,{recursive:true});
 appProcess=spawn(path.resolve(__dirname,'../dist/NoteMind/NoteMind.exe'),['--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore',env:{...process.env,NOTEMIND_DATA:profile,NOTEMIND_HOME:profile,NOTEMIND_WORKSPACES:path.join(profile,'workspaces')}});
 const target=await waitFor(async()=>{const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return targets.find(t=>t.type==='page'&&t.url.endsWith('index.html'));});
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});let id=0;const pending=new Map();socket.onmessage=e=>{const message=JSON.parse(e.data);const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}};
 const send=(method,params)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 await waitFor(()=>evaluate("!!document.querySelector('[data-tablet=surface]')"));report.checks.push('portable app loads its bundled renderer and native bridge');
 const status=await evaluate('window.wm.pen.status()');if(!status)throw Error('Missing pen status');report.checks.push('native tablet subsystem responds');
 childPid=await evaluate("window.notemind.workspaceWindow({id:'portable-test',name:'Portable Test',folders:[]})");
 await waitFor(()=>fs.readFile(path.join(profile,'workspaces/portable-test/sheets.json'),'utf8'));report.checks.push('workspace opens a separate working packaged app');
 const duplicate=await evaluate("window.notemind.workspaceWindow({id:'portable-test',name:'Portable Test',folders:[]})");await pause(1000);
 let duplicateAlive=true;try{process.kill(duplicate,0)}catch{duplicateAlive=false}if(duplicateAlive)throw Error('Duplicate workspace instance stayed running');report.checks.push('reopening a workspace focuses its existing instance');
 await closeWindow(childPid);await waitFor(()=>fs.readFile(path.join(profile,'workspaces/portable-test/window.json'),'utf8'));childPid=null;report.checks.push('workspace closes after persisting its state');
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(profile,'portable.png'),Buffer.from(shot.data,'base64'));
 await evaluate('window.notemind.closeWindow();undefined');socket.close();socket=null;await waitFor(()=>fs.readFile(path.join(profile,'window.json'),'utf8'));report.checks.push('portable app closes cleanly');report.ok=true;
})().catch(error=>{report.ok=false;report.error=error.stack;process.exitCode=1;}).finally(async()=>{socket?.close();if(childPid)await closeWindow(childPid);if(appProcess?.exitCode===null)await closeWindow(appProcess.pid);await fs.writeFile(path.resolve(__dirname,'../test-results/portable.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
