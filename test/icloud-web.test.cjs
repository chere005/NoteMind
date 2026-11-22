'use strict';
// Notepads on the web (src/icloud-web.cjs): the iCloud Drive/NoteMind copy mirrored into CloudKit records, against a
// temporary folder and a bridge that stands in for CloudKit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createWebPublisher,listFiles,recordName,isNotePath,clipText,CLOUD,FILE_TYPE,INDEX_TYPE,INDEX_NAME}=require('../src/icloud-web.cjs');
const {pageHTML,isApple}=require('../src/icloud-web-bridge.cjs');

function fakeCloud(){
 const cloud={appleId:'_apple-a',records:new Map(),saves:[],removes:[],fail:null};
 cloud.bridge={
  appleId:async()=>cloud.appleId,
  save:async record=>{if(cloud.fail&&cloud.fail(record))throw Error('QUOTA_EXCEEDED: no room');cloud.saves.push(record);cloud.records.set(record.recordName,{...record,file:record.file?{name:record.file.name,bytes:Buffer.from(record.file.bytes)}:null});},
  remove:async names=>{cloud.removes.push(names);for(const name of names)cloud.records.delete(name);},
 };
 return cloud;
}
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-icloud-web-')),target=path.join(root,'iCloud Drive','NoteMind'),stateFile=path.join(root,'data','icloud-web-state.json');
 fs.mkdirSync(target,{recursive:true});
 const cloud=fakeCloud(),timers=[],logs=[];
 const fake={setTimeout:fn=>{const t={fn,unref(){}};timers.push(t);return t;},clearTimeout:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}};
 const facts=file=>({text:'Text of '+path.basename(file),meta:{pinned:path.basename(file).startsWith('Pinned'),tags:['cooking',5]},id:'id-'+path.basename(file),kind:'notepad'});
 const publisher=createWebPublisher({target,stateFile,bridge:cloud.bridge,readFacts:async file=>facts(file),app:'9.9.0',log:m=>logs.push(m),timers:fake});
 const write=(rel,text='x',time)=>{const file=path.join(target,...rel.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);if(time)fs.utimesSync(file,time,time);return file;};
 const index=()=>JSON.parse(cloud.records.get(INDEX_NAME).fields.files);
 return {root,target,stateFile,cloud,publisher,write,timers,logs,index};
}

test('the reader\'s container and the web token are the ones CloudKit allows for seancheren.com',()=>{
 assert.equal(CLOUD.container,'iCloud.com.seancheren.acctmind');
 assert.equal(CLOUD.environment,'development');
 assert.match(CLOUD.apiToken,/^[0-9a-f]{64}$/);
 assert.equal(new URL(CLOUD.page).origin,'https://seancheren.com');
});

test('every file in the copied folder becomes one record with its bytes; Notepads carry their text and tags for the list; an index names them all',async()=>{
 const t=setup(),time=new Date('2026-11-20T10:00:00Z');
 t.write('Myst.nm','myst bytes',time);
 t.write('Drafts/Old Cooking Notes.nm','cooking bytes');
 t.write('Plans/Week.md','# Week');
 t.write('Plans/Week-0123456789ab.assets/picture.png','png');
 t.write('.hidden.nm','no');t.write('Drafts/.Old.nm.0f8fad5b-d9cb-469f-a165-70867728950e.tmp','no');t.write('Gone.nm.icloud','no');
 assert.deepEqual(await t.publisher.publish(),{signedIn:true,uploaded:4,removed:0,failed:0});
 const myst=t.cloud.records.get(recordName('Myst.nm'));
 assert.equal(myst.recordType,FILE_TYPE);
 assert.equal(myst.file.bytes.toString(),'myst bytes');
 assert.equal(myst.file.name,'Myst.nm');
 assert.equal(myst.fields.path,'Myst.nm');
 assert.equal(myst.fields.bytes,10);
 assert.equal(myst.fields.modified,time.getTime());
 assert.equal(myst.fields.sha256,crypto.createHash('sha256').update('myst bytes').digest('hex'));
 assert.equal(myst.fields.text,'Text of Myst.nm');
 assert.deepEqual(JSON.parse(myst.fields.meta),{pinned:false,tags:['cooking'],id:'id-Myst.nm',kind:'notepad'});
 const picture=t.cloud.records.get(recordName('Plans/Week-0123456789ab.assets/picture.png'));
 assert.equal(picture.fields.text,undefined,'a picture beside a Markdown Notepad is a file, not a Notepad');
 assert.equal(picture.file.bytes.toString(),'png');
 const index=t.index();
 assert.deepEqual(index.files.map(entry=>entry[0]),['Drafts/Old Cooking Notes.nm','Myst.nm','Plans/Week-0123456789ab.assets/picture.png','Plans/Week.md']);
 assert.deepEqual(index.files.find(entry=>entry[0]==='Myst.nm'),['Myst.nm',recordName('Myst.nm'),10,time.getTime()]);
 assert.equal(t.cloud.records.get(INDEX_NAME).recordType,INDEX_TYPE);
 assert.equal(t.cloud.records.get(INDEX_NAME).fields.app,'9.9.0');
 assert.equal(t.cloud.records.size,5,'no record for hidden files, unfinished copies or iCloud placeholders');
 assert.deepEqual(t.publisher.summary().notepads,3);
});

test('only what changed is sent again; what is gone is deleted; nothing changed sends nothing',async()=>{
 const t=setup();
 t.write('A.nm','a');t.write('B.nm','b');
 await t.publisher.publish();
 t.cloud.saves.length=0;
 assert.deepEqual(await t.publisher.publish(),{signedIn:true,uploaded:0,removed:0,failed:0});
 assert.equal(t.cloud.saves.length,0,'nothing changed: not even the index is sent');
 t.write('A.nm','a2',new Date(Date.now()+5000));
 fs.rmSync(path.join(t.target,'B.nm'));
 assert.deepEqual(await t.publisher.publish(),{signedIn:true,uploaded:1,removed:1,failed:0});
 assert.equal(t.cloud.records.get(recordName('A.nm')).file.bytes.toString(),'a2');
 assert.deepEqual(t.cloud.removes,[[recordName('B.nm')]]);
 assert.deepEqual(t.index().files.map(entry=>entry[0]),['A.nm']);
});

test('signed out, nothing is sent; another Apple ID gets everything again; signing out forgets what was sent',async()=>{
 const t=setup();
 t.write('A.nm','a');
 t.cloud.appleId=null;
 assert.deepEqual(await t.publisher.publish(),{signedIn:false,uploaded:0,removed:0,failed:0});
 assert.equal(t.cloud.saves.length,0);
 assert.equal(t.publisher.wasSignedIn(),false);
 t.cloud.appleId='_apple-a';await t.publisher.publish();
 assert.equal(t.publisher.wasSignedIn(),true,'a computer that published publishes again at start');
 t.cloud.appleId='_apple-b';t.cloud.saves.length=0;
 await t.publisher.publish();
 assert.deepEqual(t.cloud.saves.map(record=>record.recordName).sort(),[INDEX_NAME,recordName('A.nm')].sort(),'a different Apple ID has none of them yet');
 await t.publisher.forget();
 assert.equal(t.publisher.wasSignedIn(),false);
});

test('a file iCloud refuses is logged and tried again later, a few times; the others still go',async()=>{
 const t=setup();
 t.write('Big.nm','big');t.write('Small.nm','s');
 t.cloud.fail=record=>record.recordName===recordName('Big.nm');
 const result=await t.publisher.publish();
 assert.equal(result.uploaded,1);assert.equal(result.failed,1);
 assert.ok(t.logs.some(line=>line.includes('Big.nm')&&line.includes('QUOTA_EXCEEDED')),t.logs.join('\n'));
 assert.deepEqual(t.index().files.map(entry=>entry[0]),['Small.nm'],'the index names only what iCloud has');
 assert.equal(t.timers.length,1,'a retry is waiting');
 t.cloud.fail=null;
 t.timers.shift().fn();await t.publisher.publish();
 assert.deepEqual(t.index().files.map(entry=>entry[0]),['Big.nm','Small.nm']);
 t.cloud.fail=()=>true;t.write('Big.nm','bigger',new Date(Date.now()+5000));
 let runs=0;for(;runs<10;runs++){await t.publisher.publish();if(!t.timers.length)break;t.timers.shift();}
 assert.equal(runs,5,'five retries after the first failure, then it waits for the next change');
});

test('changes settle before publishing, and a change during a run publishes again after it',async()=>{
 const t=setup();
 t.write('A.nm','a');
 t.publisher.changed();t.publisher.changed();
 assert.equal(t.timers.length,1);
 let release;const gate=new Promise(r=>{release=r;});
 const save=t.cloud.bridge.save;t.cloud.bridge.save=async record=>{await gate;return save(record);};
 const first=t.publisher.publish();
 const second=t.publisher.publish();
 assert.equal(first,second,'one run at a time');
 release();await first;
 assert.equal(t.timers.length,1,'the change that arrived during the run is published after it settles');
});

test('Notepad text is cut to what a record can hold; folders and placeholders are walked the way the reader lists them',async()=>{
 assert.equal(clipText('a'.repeat(200000)).length,100000);
 assert.ok(Buffer.byteLength(clipText('é'.repeat(100000)))<=600000);
 assert.equal(clipText(undefined),'');
 assert.ok(isNotePath('Drafts/X.nm')&&isNotePath('a/b.md')&&!isNotePath('a/b-x.assets/c.md')&&!isNotePath('a/pic.png'));
 const t=setup();t.write('a/b/c.nm');t.write('a/.d/e.nm');
 assert.deepEqual((await listFiles(t.target)).map(file=>file.rel),['a/b/c.nm']);
});

test('the sign-in page is NoteMind\'s own, with only the container settings put in, and the sign-in window only goes to Apple',()=>{
 const html=pageHTML(CLOUD);
 assert.ok(html.includes('"container":"iCloud.com.seancheren.acctmind"'));
 assert.ok(html.includes('https://cdn.apple-cloudkit.com/ck/2/cloudkit.js'));
 assert.ok(!html.includes('/*PAGE*/')&&!html.includes('/*CONFIG*/'));
 assert.ok(html.includes('newRecordsBatch'),'the page script is inlined');
 assert.equal((html.match(/<script/g)||[]).length,3);
 for(const ok of ['https://idmsa.apple.com/IDMSWebAuth/auth','https://appleid.apple.com/x','https://api.apple-cloudkit.com/'])assert.ok(isApple(new URL(ok)),ok);
 for(const bad of ['https://apple.com.example.com/','https://notapple.com/','https://seancheren.com/'])assert.ok(!isApple(new URL(bad)),bad);
});

test('a large Notepad uploads in ordered parts and becomes synced only after the web index is saved',async()=>{
 const t=setup(),limit=12*1024*1024;
 const bytes=Buffer.concat([Buffer.alloc(limit,0x41),Buffer.from('last part')]);
 t.write('Large.nm',bytes);
 t.cloud.fail=record=>record.recordName===INDEX_NAME;
 assert.equal((await t.publisher.publish()).failed,1);
 const file=t.cloud.saves.find(record=>record.recordName===recordName('Large.nm'));
 assert.equal(file.file,undefined);
 assert.deepEqual(file.parts.map(part=>part.bytes.length),[limit,9]);
 assert.deepEqual(Buffer.concat(file.parts.map(part=>part.bytes)),bytes);
 assert.equal(t.publisher.status().files['Large.nm'].state,'error');
 assert.equal(t.publisher.summary().notepads,0);
 t.cloud.fail=null;
 assert.equal((await t.publisher.publish()).uploaded,0);
 assert.equal(t.publisher.status().files['Large.nm'].state,'synced');
 assert.equal(t.publisher.summary().notepads,1);
});

test('a placeholder or incomplete scan preserves previously published files',async()=>{
 const t=setup();
 fs.mkdirSync(path.join(t.target,'sub'));
 const file=t.write('sub/Keep.nm','abc');
 await t.publisher.publish();
 fs.renameSync(file,path.join(t.target,'sub','.Keep.nm.icloud'));
 await t.publisher.publish();
 assert.deepEqual(t.index().files.map(entry=>entry[0]),['sub/Keep.nm']);
 assert.equal(t.cloud.removes.length,0);
});
