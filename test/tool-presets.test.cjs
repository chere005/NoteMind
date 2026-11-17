'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),{buildSync}=require('esbuild');
function load(file){const module={exports:{}},code=buildSync({entryPoints:[path.resolve('src/tablet/renderer/'+file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}).outputFiles[0].text;vm.runInNewContext(code,{module,exports:module.exports,require,crypto:require('node:crypto'),console,performance});return module.exports;}
const model=load('toolPresets.ts'),{createToolPresetStore}=load('toolPresetStore.ts'),keys=load('toolPresetKeys.ts'),buttons=load('penButtons.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),settings=(patch={})=>({tool:'pen',colour:'#1C1C1E',width:3,...patch}),tick=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function storage(values={}){const data=new Map(Object.entries(values)),writes=[];let reads=0;return {data,writes,get reads(){return reads;},getItem(key){reads++;return data.get(key)??null;},setItem(key,value){writes.push({key,value});data.set(key,value);}};}
function target(tag='CANVAS',attrs={},parentElement=null){return {tagName:tag,parentElement,getAttribute:name=>Object.hasOwn(attrs,name)?attrs[name]:null};}

test('legacy migration preserves exact supported custom colour and fractional width without touching pen maps',()=>{
 const rawPen=JSON.stringify({slots:{lower:{hold:'pan',double:'undo'},upper:{hold:'add',double:'redo'}}}),s=storage({'notemind.penColour':'#aB12cD','notemind.penWidth':'2.75','notemind.pen':rawPen}),store=createToolPresetStore({storage:s});
 assert.deepEqual(plain(store.current()),settings({colour:'#aB12cD',width:2.75}));assert.equal(store.getSnapshot().presets.length,1);assert.equal(store.getSnapshot().presets[0].settings.colour,'#aB12cD');assert.equal(s.writes.length,0);assert.equal(s.data.get('notemind.pen'),rawPen);
});
test('legacy width fallback follows the supported 1–16 range',()=>{
 for(const [raw,expected]of [['0',3],['bad',3],['-10',1],['30',16],['1.25',1.25],['Infinity',16]])assert.equal(model.legacyToolSettings('#ABCDEF',raw).width,expected);
 assert.equal(model.legacyToolSettings('bad',3).colour,'#1C1C1E');
});
test('presets support only the existing Pen, Eraser and Select capabilities',()=>{
 let state=model.initialToolPresets(settings());for(const tool of ['eraser','select'])state=model.addToolPreset(state,tool,tool,settings({tool,colour:'#123456',width:4}));
 state=model.activateToolPreset(state,'eraser');assert.equal(state.current.tool,'eraser');assert.equal(state.current.colour,'#123456');assert.throws(()=>model.addToolPreset(state,'new','Other',settings({tool:'highlighter'})),/Invalid tool/);assert.throws(()=>model.toolSettings(settings({width:NaN})),/Invalid tool/);assert.throws(()=>model.toolSettings(settings({width:17})),/Invalid tool/);
});
test('reopening retains saved presets and colour/width while transient erase/select stay off',()=>{
 let state=model.initialToolPresets(settings());state=model.addToolPreset(state,'erase','Erase',settings({tool:'eraser',colour:'#654321',width:8}));state=model.activateToolPreset(state,'erase');
 const encoded=model.serializeToolPresets(state),loaded=model.loadToolPresets(encoded,settings());assert.equal(loaded.state.current.tool,'pen');assert.equal(loaded.state.current.colour,'#654321');assert.equal(loaded.state.current.width,8);assert.equal(loaded.state.activeId,null);assert.equal(loaded.state.presets[1].settings.tool,'eraser');assert.equal(JSON.parse(encoded).current.tool,undefined);
});
test('current settings are immutable, cached, and do not rewrite saved presets',()=>{
 const s=storage(),store=createToolPresetStore({storage:s}),first=store.current(),snapshot=store.getSnapshot();for(let i=0;i<1000;i++)assert.equal(store.current(),first);assert.equal(s.reads,3);assert.equal(s.writes.length,0);
 assert.throws(()=>{first.width=9;},/read only|readonly|Cannot assign/);assert.throws(()=>{snapshot.presets.push({});},/not extensible|read only|Cannot add/);
 store.setCurrent(settings({colour:'#2266aa',width:6}));assert.equal(store.current().width,6);assert.equal(first.width,3);assert.equal(store.getSnapshot().presets[0].settings.width,3);assert.equal(store.getSnapshot().activeId,null);
});
test('rename, explicit update and removal preserve immutable old snapshots',()=>{
 let state=model.initialToolPresets(settings()),before=state;state=model.addToolPreset(state,'blue','Blue',settings({colour:'#0000ff',width:5}));state=model.activateToolPreset(state,'blue');const active=state.current;state=model.renameToolPreset(state,'blue','Blue pen');assert.equal(state.current,active);assert.equal(state.presets[1].name,'Blue pen');state=model.setCurrentTool(state,settings({colour:'#0000ff',width:7}));assert.equal(state.presets[1].settings.width,5);state=model.updateToolPreset(state,'blue');assert.equal(state.presets[1].settings.width,7);assert.equal(state.activeId,'blue');state=model.removeToolPreset(state,'blue');assert.equal(state.current.width,7);assert.equal(state.activeId,null);assert.equal(before.presets.length,1);assert.equal(before.current.width,3);
});
test('preset names, identities, list size and quick slots stay bounded',()=>{
 let state=model.initialToolPresets(settings());for(let i=1;i<model.MAX_TOOL_PRESETS;i++)state=model.addToolPreset(state,'p'+i,'Preset '+i);assert.equal(state.presets.length,12);assert.throws(()=>model.addToolPreset(state,'overflow','Overflow'),/up to 12/);assert.equal(model.presetAtSlot(state,9).id,'p8');for(const slot of [0,10,1.5,NaN])assert.equal(model.presetAtSlot(state,slot),null);
 assert.throws(()=>model.addToolPreset(model.initialToolPresets(settings()),'bad/id','Bad'),/identity/);assert.throws(()=>model.renameToolPreset(state,'p1',' '),/name/);assert.throws(()=>model.renameToolPreset(state,'p1','x'.repeat(81)),/80/);
});
test('corrupt and future schema values remain untouched during load',()=>{
 for(const raw of ['{bad','x'.repeat(model.MAX_PRESET_BYTES+1),JSON.stringify({version:10,presets:[]})]){const s=storage({[model.TOOL_PRESETS_KEY]:raw}),store=createToolPresetStore({storage:s});assert.equal(store.current().tool,'pen');assert.equal(s.data.get(model.TOOL_PRESETS_KEY),raw);assert.equal(s.writes.length,0);assert.ok(store.getError());if(raw.includes('10')){const result=store.add('Session pen');assert.equal(result.persisted,false);assert.equal(s.data.get(model.TOOL_PRESETS_KEY),raw);}}
});
test('valid older preset entries survive a damaged neighbor and empty lists remain empty',()=>{
 const first=model.initialToolPresets(settings()),raw=JSON.parse(model.serializeToolPresets(first));raw.presets.push({id:'bad',name:'Bad',settings:{tool:'invented'}});const loaded=model.loadToolPresets(JSON.stringify(raw),settings());assert.equal(loaded.state.presets.length,1);assert.ok(loaded.problem);
 raw.presets=[];raw.activeId=null;assert.equal(model.loadToolPresets(JSON.stringify(raw),settings()).state.presets.length,0);
});
test('late startup preference load cannot replace a newer local choice',async()=>{
 const read=deferred(),s=storage(),store=createToolPresetStore({storage:s,readRemote:()=>read.promise}),remote=model.serializeToolPresets(model.initialToolPresets(settings({colour:'#112233',width:11})));
 store.setCurrent(settings({colour:'#abcdef',width:2.5}));read.resolve(remote);assert.equal(await store.ready,false);assert.equal(store.current().colour,'#abcdef');assert.equal(store.current().width,2.5);
});
test('remote preference writes are ordered and coalesce a rapid settings sequence',async()=>{
 const started=[],first=deferred(),s=storage(),store=createToolPresetStore({storage:s,writeRemote:async value=>{started.push(JSON.parse(value));if(started.length===1)await first.promise;}});
 store.setCurrent(settings({width:4}));await tick();for(let width=5;width<=16;width++)store.setCurrent(settings({width}));assert.equal(started.length,1);assert.equal(store.pending,2);assert.equal(store.current().width,16);
 first.resolve();await store.flush();assert.deepEqual(started.map(state=>state.current.width),[4,16]);assert.equal(store.pending,0);assert.equal(store.receive(JSON.stringify(started[0])),true);assert.equal(store.current().width,4);
});
test('older own preference echoes do not overwrite a later queued choice',async()=>{
 const first=deferred(),s=storage(),values=[],store=createToolPresetStore({storage:s,writeRemote:async value=>{values.push(value);if(values.length===1)await first.promise;}});store.setCurrent(settings({width:4}));await tick();store.setCurrent(settings({width:8}));assert.equal(store.receive(values[0]),false);assert.equal(store.current().width,8);first.resolve();await store.flush();
});
test('an unrelated remote snapshot cannot replace a local choice whose persistence is pending',async()=>{
 const pending=deferred(),store=createToolPresetStore({storage:storage(),writeRemote:()=>pending.promise});store.setCurrent(settings({width:12}));const remote=model.serializeToolPresets(model.initialToolPresets(settings({width:8})));assert.equal(store.receive(remote),false);assert.equal(store.current().width,12);pending.resolve();await store.flush();assert.equal(store.current().width,12);assert.equal(store.receive(remote),true);assert.equal(store.current().width,8);
});
test('supported remote state releases protection left by an unknown future format',()=>{
 const raw=JSON.stringify({version:10,presets:[]}),s=storage({[model.TOOL_PRESETS_KEY]:raw}),store=createToolPresetStore({storage:s});store.receive(model.serializeToolPresets(model.initialToolPresets(settings())));assert.equal(store.add('New pen').persisted,true);assert.equal(JSON.parse(s.data.get(model.TOOL_PRESETS_KEY)).version,1);
});
test('a corrupt remote preference cannot replace valid local presets or write a fallback over them',()=>{
 const s=storage(),store=createToolPresetStore({storage:s});store.add('Custom');const before=store.getSnapshot(),writes=s.writes.length;assert.equal(store.receive('{broken'),false);assert.equal(store.getSnapshot(),before);assert.equal(store.getSnapshot().presets.length,2);assert.equal(s.writes.length,writes);assert.match(store.getError().message,/could not be read/);
});
test('storage failure retains usable session settings and reports the actual failure',()=>{
 const seen=[],s=storage();s.setItem=()=>{throw Error('Disk full');};const store=createToolPresetStore({storage:s,onError:error=>seen.push(error.message)}),result=store.setCurrent(settings({width:9}));assert.equal(result.persisted,false);assert.equal(store.current().width,9);assert.equal(store.getError().message,'Disk full');assert.deepEqual(seen,['Disk full']);
});
test('choosing the same settings retries a prior persistence failure without changing the snapshot',()=>{
 const s=storage(),set=s.setItem;let failed=true;s.setItem=(key,value)=>{if(failed){failed=false;throw Error('Try again');}set.call(s,key,value);};const store=createToolPresetStore({storage:s});store.setCurrent(settings({width:9}));const before=store.getSnapshot();assert.equal(store.getError().message,'Try again');const result=store.setCurrent(settings({width:9}));assert.equal(result.persisted,true);assert.equal(store.getSnapshot(),before);assert.equal(store.getError(),null);assert.equal(JSON.parse(s.data.get(model.TOOL_PRESETS_KEY)).current.width,9);
});
test('remote failure does not prevent the newest queued settings from being persisted',async()=>{
 const first=deferred(),values=[],store=createToolPresetStore({storage:storage(),writeRemote:async value=>{values.push(value);if(values.length===1)await first.promise;}});store.setCurrent(settings({width:4}));await tick();store.setCurrent(settings({width:10}));first.reject(Error('Connection lost'));await store.flush();assert.equal(values.length,2);assert.equal(JSON.parse(values[1]).current.width,10);assert.equal(store.current().width,10);assert.equal(store.pending,0);
});
test('disposing ignores a pending startup response and detaches listeners',async()=>{
 const read=deferred(),store=createToolPresetStore({storage:storage(),readRemote:()=>read.promise});let changes=0;store.subscribe(()=>changes++);await store.dispose();read.resolve(model.serializeToolPresets(model.initialToolPresets(settings({width:14}))));await store.ready;assert.equal(store.current().width,3);assert.equal(changes,0);assert.throws(()=>store.setCurrent(settings({width:4})),/closed/);
});
test('quick preset keys require the visible focused drawing surface',()=>{
 const event={key:'1',target:target()},owner={visible:true,canvasFocused:true};assert.equal(keys.toolPresetSlotKey(event,owner),1);assert.equal(keys.toolPresetSlotKey({...event,key:'9'},owner),9);for(const patch of [{visible:false},{canvasFocused:false},{composing:true},{modalOpen:true}])assert.equal(keys.toolPresetSlotKey(event,{...owner,...patch}),null);
 for(const patch of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true},{defaultPrevented:true},{isComposing:true},{keyCode:229},{key:'Dead'},{key:'Process'},{key:'0'}])assert.equal(keys.toolPresetSlotKey({...event,...patch},owner),null);
});
test('text fields, editable descendants, menus and shadow input paths retain their keys',()=>{
 const owner={visible:true,canvasFocused:true};for(const node of [target('INPUT'),target('TEXTAREA'),target('SELECT'),target('BUTTON'),target('SPAN',{},target('DIV',{contenteditable:'true'})),target('SPAN',{},target('DIV',{role:'textbox'})),target('DIV',{contenteditable:'plaintext-only'}),target('DIV',{role:'menuitem'})])assert.equal(keys.toolPresetSlotKey({key:'2',target:node},owner),null);
 const shadow=target('SPAN'),input=target('INPUT');assert.equal(keys.toolPresetSlotKey({key:'3',target:shadow,composedPath:()=>[input,shadow]},owner),null);
 const drawing=target('CANVAS',{},target('DIV',{contenteditable:'false'},target('DIV',{contenteditable:'true'})));assert.equal(keys.toolPresetSlotKey({key:'3',target:drawing},owner),3);
});
test('preset operations leave physical default and custom pen button mappings intact',()=>{
 const defaults=buttons.migrateButtons({}),custom=buttons.migrateButtons({buttonLayout:buttons.BUTTON_LAYOUT,slots:{...defaults,lower:{hold:'pan',double:'undo'},upper:{hold:'add',double:'redo'}}}),snapshot=plain(custom);let state=model.initialToolPresets(settings());state=model.addToolPreset(state,'blue','Blue',settings({colour:'#123456'}));state=model.activateToolPreset(state,'blue');
 const event={pointerType:'pen',buttons:3,button:0,pressure:.5},defaultsPress=buttons.resolvePress(event,{buttons:defaults,eraser:false,selectTool:false}),customPress=buttons.resolvePress(event,{buttons:custom,eraser:false,selectTool:false});assert.equal(defaultsPress.kind,'erase');assert.equal(customPress.kind,'pan');assert.deepEqual(plain(custom),snapshot);assert.equal(state.current.colour,'#123456');
});
