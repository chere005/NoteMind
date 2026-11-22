'use strict';
// Copy Notepads to iCloud Drive (src/icloud-copy.cjs), against temporary folders standing in for the home folder and iCloud Drive.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createICloudCopy,iCloudDriveRoot,libraryDrafts,draftFileName}=require('../src/icloud-copy.cjs');
const {NotesStore}=require('../src/notes-store.cjs');
const {sidecarFolder}=require('../src/markdown-files.cjs');

function setup({enabled=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-icloud-')),home=path.join(root,'home'),notes=path.join(home,'Documents','NoteMind'),cloud=path.join(home,'Library','Mobile Documents','com~apple~CloudDocs'),data=path.join(root,'data');
 for(const dir of [notes,cloud,data])fs.mkdirSync(dir,{recursive:true});
 const prefsFile=path.join(data,'icloud-copy.json'),stateFile=path.join(data,'icloud-copy-state.json');
 if(enabled)fs.writeFileSync(prefsFile,JSON.stringify({enabled:true}));
 const timers=[],fake={setTimeout:(fn)=>{const t={fn,unref(){}};timers.push(t);return t;},clearTimeout:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}};
 const logs=[],store=new NotesStore(path.join(data,'notes-library'),path.join(data,'note-recovery'));
 const copy=createICloudCopy({home,notesFolder:notes,target:path.join(cloud,'NoteMind'),iCloudRoot:cloud,prefsFile,stateFile,drafts:()=>libraryDrafts(store),log:m=>logs.push(m),timers:fake});
 const write=(file,text='x',time)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);if(time)fs.utimesSync(file,time,time);return file;};
 const runTimers=async()=>{while(timers.length)timers.shift().fn();await copy.flush();};
 return {root,home,notes,cloud,target:path.join(cloud,'NoteMind'),data,prefsFile,stateFile,copy,write,timers,runTimers,logs,store};
}
const read=file=>fs.readFileSync(file,'utf8');
const list=dir=>{const out=[];const walk=(d,p='')=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const rel=p?p+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(d,e.name),rel);else out.push(rel);}};if(fs.existsSync(dir))walk(dir);return out.sort();};

test('iCloud Drive is found where macOS and Windows keep it, and nowhere else',()=>{
 assert.equal(iCloudDriveRoot('/home-a','darwin'),path.join('/home-a','Library','Mobile Documents','com~apple~CloudDocs'));
 assert.equal(iCloudDriveRoot('C:\\Users\\a','win32'),path.join('C:\\Users\\a','iCloudDrive'));
 assert.equal(iCloudDriveRoot('/home/a','linux'),null);
});

test('a saved Notepad is copied once saving settles, keeping its place in the NoteMind folder and its time',async()=>{
 const t=setup(),time=new Date('2026-11-20T10:00:00Z');
 const file=t.write(path.join(t.notes,'Plans','Week.nm'),'v1',time);
 t.copy.saved(file);t.copy.saved(file);
 assert.equal(t.timers.length,1,'two saves in a row make one copy');
 assert.deepEqual(list(t.target),[],'nothing is copied while saving is still going on');
 await t.runTimers();
 assert.equal(read(path.join(t.target,'Plans','Week.nm')),'v1');
 assert.equal(fs.statSync(path.join(t.target,'Plans','Week.nm')).mtimeMs,time.getTime(),'the copy keeps the Notepad\'s time');
 fs.writeFileSync(file,'v2');t.copy.saved(file);await t.runTimers();
 assert.equal(read(path.join(t.target,'Plans','Week.nm')),'v2','a changed Notepad replaces its copy');
 assert.deepEqual(list(t.target),['Plans/Week.nm'],'no temporary files are left behind');
 assert.ok(fs.readFileSync(t.stateFile,'utf8').includes('Week.nm'),'the copies are recorded in the app\'s own data, not in iCloud Drive');
});

test('Notepads outside the NoteMind folder keep their place under the home folder; ones already in iCloud Drive and working files are left alone',async()=>{
 const t=setup();
 const desk=t.write(path.join(t.home,'Desktop','Idea.md'),'# Idea');
 const synced=t.write(path.join(t.cloud,'Elsewhere','Already.nm'));
 const working=t.write(path.join(t.notes,'Backups','Old.nm'));
 const temp=t.write(path.join(t.notes,'Draft.nm.1234.tmp'));
 const picture=t.write(path.join(t.notes,'photo.png'));
 for(const f of [desk,synced,working,temp,picture])t.copy.saved(f);
 await t.runTimers();
 assert.deepEqual(list(t.target),['Desktop/Idea.md']);
 assert.equal(t.copy.copyName(path.join(path.parse(t.root).root,'Volumes','Disk','a.nm')),path.join('Other','Volumes','Disk','a.nm'));
});

test('a Markdown Notepad brings its companion folder of pictures and metadata',async()=>{
 const t=setup(),file=t.write(path.join(t.notes,'Reading list.md'),'![x](y.png)'),folder=sidecarFolder(file);
 t.write(path.join(t.notes,folder,'cover.png'),'PNG');t.write(path.join(t.notes,folder,'notemind.json'),'{}');
 t.copy.saved(file);await t.runTimers();
 assert.deepEqual(list(t.target),['Reading list.md',folder+'/cover.png',folder+'/notemind.json'].sort());
});

test('the catch-up pass copies every Notepad in the NoteMind folder, skips working folders, and removes only copies whose Notepad is gone',async()=>{
 const t=setup();
 t.write(path.join(t.notes,'A.nm'),'a');t.write(path.join(t.notes,'Sub','B.wm'),'b');t.write(path.join(t.notes,'script.py'),'p');
 t.write(path.join(t.notes,'Asset Sources','x.nm'));t.write(path.join(t.notes,'PDF Markup','y.nm'));t.write(path.join(t.notes,'.hidden.nm'));
 const outside=t.write(path.join(t.home,'Desktop','C.nm'),'c');t.copy.saved(outside);await t.runTimers();
 t.write(path.join(t.target,'Mine.txt'),'someone else\'s file in the copied folder');
 assert.deepEqual(await t.copy.sweep(),{copied:3,removed:0});
 assert.deepEqual(list(t.target),['A.nm','Desktop/C.nm','Mine.txt','Sub/B.wm','script.py']);
 assert.deepEqual(await t.copy.sweep(),{copied:0,removed:0},'nothing changed, nothing copied');
 fs.rmSync(path.join(t.notes,'A.nm'));fs.rmSync(outside);fs.renameSync(path.join(t.notes,'Sub','B.wm'),path.join(t.notes,'B2.wm'));
 assert.deepEqual(await t.copy.sweep(),{copied:1,removed:3});
 assert.deepEqual(list(t.target),['B2.wm','Mine.txt','script.py'],'deleted and renamed Notepads follow; a file it did not make is never removed');
});

test('off by default, and nothing happens without iCloud Drive; turning it on catches up, turning it off stops copying',async()=>{
 const t=setup({enabled:false});
 const file=t.write(path.join(t.notes,'A.nm'));
 assert.equal(t.copy.isEnabled(),false);
 t.copy.saved(file);assert.equal(t.timers.length,0);
 assert.deepEqual(await t.copy.sweep(),{copied:0,removed:0});
 assert.deepEqual(await t.copy.setEnabled(true),{copied:1,removed:0},'turning it on copies what is already there');
 assert.deepEqual(JSON.parse(read(t.prefsFile)),{enabled:true},'and is remembered');
 t.write(path.join(t.notes,'B.nm'));t.copy.saved(path.join(t.notes,'B.nm'));
 await t.copy.setEnabled(false);
 assert.deepEqual(list(t.target),['A.nm','B.nm'],'what was waiting is copied before it stops');
 t.copy.saved(path.join(t.notes,'A.nm'));assert.equal(t.timers.length,0,'then nothing more');
 fs.rmSync(t.cloud,{recursive:true});
 const u=setup();fs.rmSync(u.cloud,{recursive:true});
 assert.equal(u.copy.isAvailable(),false);
 u.copy.saved(u.write(path.join(u.notes,'A.nm')));await u.runTimers();
 assert.equal(fs.existsSync(u.target),false,'no iCloud Drive, no folder made');
});

test('a copy that fails is logged and the rest still copy',async()=>{
 const t=setup();
 const good=t.write(path.join(t.notes,'Good.nm'),'g');
 fs.mkdirSync(path.join(t.target,'Blocked.nm'),{recursive:true});fs.writeFileSync(path.join(t.target,'Blocked.nm','inside'),'a folder where the copy should go');
 const blocked=t.write(path.join(t.notes,'Blocked.nm'),'b');
 t.copy.saved(blocked);t.copy.saved(good);await t.runTimers();
 assert.equal(read(path.join(t.target,'Good.nm')),'g');
 assert.ok(t.logs.some(line=>line.startsWith('iCloud copy: ')),t.logs.join('\n'));
});

test('a damaged record never removes anything outside the copied folder',async()=>{
 const t=setup();
 const outside=t.write(path.join(t.cloud,'Keep.nm'),'not a copy');
 const ownHome=t.write(path.join(t.home,'Keep.nm'),'not a copy either');
 fs.writeFileSync(t.stateFile,JSON.stringify({copies:{['..'+path.sep+'Keep.nm']:{source:path.join(t.notes,'Gone.nm')},['..'+path.sep+'..'+path.sep+'..'+path.sep+'..'+path.sep+'Keep.nm']:{source:path.join(t.notes,'Gone2.nm')}}}));
 await t.copy.sweep();
 assert.equal(read(outside),'not a copy');
 assert.equal(read(ownHome),'not a copy either');
});

test('a save result passes through unchanged and its Notepad is noted for copying',async()=>{
 const t=setup(),file=t.write(path.join(t.notes,'A.nm'),'a'),result={path:file,revision:'r'};
 assert.equal(t.copy.afterSave(result),result);
 assert.equal(t.copy.afterSave(null),null,'a cancelled save passes through too');
 await t.runTimers();
 assert.deepEqual(list(t.target),['A.nm']);
});

test('a copy cut off by quitting leaves no hidden temporary behind for long',async()=>{
 const t=setup(),old=path.join(t.target,'Sub','.A.nm.0f8fad5b-d9cb-469f-a165-70867728950e.tmp'),fresh=path.join(t.target,'.B.nm.7c9e6679-7425-40de-944b-e07fc1f90ae7.tmp');
 t.write(old,'x',new Date(Date.now()-3600000));t.write(fresh,'y');
 await t.copy.sweep();
 assert.equal(fs.existsSync(old),false,'an old one is removed');
 assert.equal(fs.existsSync(fresh),true,'one that may still be being written is left');
});

// Unsaved Notepads live only in the app's library (notes-library + note-recovery); a real NotesStore makes them here.
const draft=(store,title,text)=>store.draft({title,text,meta:{},assets:{}});
const archiveOf=(t,doc)=>fs.readFileSync(path.join(t.store.recoveryRoot,doc.id+'.wm'));

test('unsaved Notepads are copied by title into Drafts, byte for byte; empty ones are not; same titles are numbered oldest first',async()=>{
 const t=setup();
 const cooking=await draft(t.store,'Old Cooking Notes','# Old Cooking Notes\n\nflour, salt');
 await draft(t.store,'Untitled','');
 const first=await draft(t.store,'Ideas','one'),second=await draft(t.store,'Ideas','two');
 await draft(t.store,'a/b: c?','odd title');
 const saved=t.write(path.join(t.notes,'Saved.nm'),'s');
 assert.deepEqual(await t.copy.sweep(),{copied:5,removed:0});
 assert.deepEqual(list(t.target),['Drafts/Ideas 2.nm','Drafts/Ideas.nm','Drafts/Old Cooking Notes.nm','Drafts/a-b- c-.nm','Saved.nm']);
 assert.deepEqual(fs.readFileSync(path.join(t.target,'Drafts','Old Cooking Notes.nm')),archiveOf(t,cooking),'the copy is the Notepad as NoteMind keeps it');
 assert.deepEqual(fs.readFileSync(path.join(t.target,'Drafts','Ideas.nm')),archiveOf(t,first),'the older of two same-titled drafts keeps the plain name');
 assert.deepEqual(fs.readFileSync(path.join(t.target,'Drafts','Ideas 2.nm')),archiveOf(t,second));
 assert.equal(read(saved),'s');
 assert.deepEqual(await t.copy.sweep(),{copied:0,removed:0},'nothing changed, nothing copied');
 assert.equal(draftFileName('   '),'Untitled');
 assert.equal(draftFileName('..hidden.'),'hidden');
 assert.ok(Buffer.byteLength(draftFileName('é'.repeat(200)))<=120,'long titles are cut to a file name that fits');
});

test('a draft\'s copy follows its edits once they settle, its renames, its deletion and its saving to a file; a file of the same name wins',async()=>{
 const t=setup();
 let doc=await draft(t.store,'Plan','v1');
 await t.copy.sweep();
 doc=await t.store.draft({...doc,text:'v2',meta:{},assets:{}});
 t.copy.libraryChanged();t.copy.libraryChanged();
 assert.equal(t.timers.length,1,'many library changes in a row make one copy');
 await t.runTimers();
 assert.deepEqual(fs.readFileSync(path.join(t.target,'Drafts','Plan.nm')),archiveOf(t,doc),'an edited draft replaces its copy');
 doc=await t.store.draft({...doc,title:'Final plan',manualTitle:true,meta:{},assets:{}});
 t.copy.libraryChanged();await t.runTimers();
 assert.deepEqual(list(t.target),['Drafts/Final plan.nm'],'a renamed draft moves its copy');
 t.write(path.join(t.target,'Drafts','Mine.nm'),'not a copy');
 t.write(path.join(t.notes,'Drafts','Final plan.nm'),'a saved file');
 await t.copy.sweep();
 assert.equal(read(path.join(t.target,'Drafts','Final plan.nm')),'a saved file','a saved file keeps its own place');
 assert.deepEqual(fs.readFileSync(path.join(t.target,'Drafts','Final plan 2.nm')),archiveOf(t,doc),'and the draft takes the next name');
 fs.rmSync(path.join(t.notes,'Drafts'),{recursive:true});
 const kept=await draft(t.store,'Kept','k');
 await t.store.register({...kept,path:t.write(path.join(t.notes,'Kept.nm'),'kept as a file')},{adoptDraft:true});
 await t.store.deleteDraft(doc.id);
 t.copy.libraryChanged();await t.runTimers();
 await t.copy.sweep();
 assert.deepEqual(list(t.target),['Drafts/Mine.nm','Kept.nm'],'deleted and saved drafts lose their Drafts copy; files no copy made are kept');
});

test('drafts are copied only while the setting is on, and what is waiting is copied when the window closes',async()=>{
 const t=setup({enabled:false});
 await draft(t.store,'Note','n');
 t.copy.libraryChanged();
 assert.equal(t.timers.length,0,'off: nothing is scheduled');
 assert.deepEqual(await t.copy.setEnabled(true),{copied:1,removed:0},'turning it on copies the drafts already there');
 await draft(t.store,'Later','l');
 t.copy.libraryChanged();
 await t.copy.flush();
 assert.deepEqual(list(t.target),['Drafts/Later.nm','Drafts/Note.nm']);
 assert.equal(t.timers.length,0,'flushing leaves nothing scheduled');
});
