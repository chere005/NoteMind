const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),{buildSync}=require('esbuild');
function load(file){const module={exports:{}},code=buildSync({entryPoints:[path.resolve('src/tablet/renderer/'+file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;vm.runInNewContext(code,{module,exports:module.exports,require,crypto:require('node:crypto'),console});return module.exports;}
const {createToolPresetController}=load('toolPresetController.ts'),{installToolPresetKeyboard}=load('toolPresetKeyboard.ts'),mirror=load('padMirrorInput.ts');
const settings=(patch={})=>({tool:'pen',colour:'#1C1C1E',width:3,...patch});
function fixture(values={}){
 const stored=new Map(Object.entries(values)),writes=[],listeners=new Set(),errors=[];let tools={eraser:false,selectTool:false},subscribed=0,disposed=0;
 const change=next=>{tools=next;for(const listener of [...listeners])listener();};
 const owner={get:()=>tools,subscribe:listener=>{subscribed++;listeners.add(listener);return()=>{disposed++;listeners.delete(listener);};},apply:tool=>{change({eraser:tool==='eraser',selectTool:false});change({eraser:tool==='eraser',selectTool:tool==='select'});}};
 const controller=createToolPresetController({storage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{stored.set(key,value);writes.push({key,value});}},tools:owner,onError:error=>errors.push(error.message)});
 return {controller,stored,writes,errors,owner,change,get subscribed(){return subscribed;},get disposed(){return disposed;},get tools(){return tools;}};
}
class KeyEvent{
 constructor(type,options={}){Object.assign(this,{type,key:'',defaultPrevented:false,repeat:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...options});}
 preventDefault(){this.defaultPrevented=true;}stopPropagation(){this.stopped=true;}composedPath(){return [this.target];}
}
function viewFixture(){
 const listeners=new Map(),events=[];const view={closed:false,innerWidth:1000,innerHeight:1000,performance,KeyboardEvent:KeyEvent,MouseEvent:KeyEvent,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 class Element{
  constructor(kind='surface'){this.kind=kind;this.tagName=kind==='input'?'INPUT':kind==='button'?'BUTTON':'DIV';this.ownerDocument=view.document;}
  matches(selector){return selector.includes('data-tablet')?this.kind==='surface':selector.includes('button')?this.kind==='button':false;}
  closest(selector){return selector.includes('data-tablet')&&this.kind==='surface'?this:null;}getAttribute(name){return name==='role'&&this.kind==='menu'?'menuitem':null;}
  dispatchEvent(event){event.target=this;events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);return !event.defaultPrevented;}
 }
 view.HTMLElement=Element;const doc={defaultView:view,visibilityState:'visible',activeElement:null,querySelector:()=>doc.modal?{}:null,modal:false};view.document=doc;doc.body=new Element('body');doc.documentElement=new Element('html');const surface=new Element(),input=new Element('input'),button=new Element('button');doc.activeElement=surface;
 return {view,doc,surface,input,button,listeners,events,key(key,patch={}){const event=new KeyEvent('keydown',{key,...patch});doc.activeElement.dispatchEvent(event);return event;},dispatch(type){for(const fn of listeners.get(type)||[])fn(new KeyEvent(type));}};
}
test('one tool owner subscription keeps presets aligned with existing mode buttons',async()=>{
 const h=fixture(),before=h.controller.getSnapshot();assert.equal(h.subscribed,1);assert.equal(h.writes.length,0);h.controller.add('Erase',settings({tool:'eraser',colour:'#123456',width:7}));const id=h.controller.getSnapshot().presets[1].id,start=h.writes.length;h.controller.activate(id);
 assert.equal(h.controller.current().tool,'eraser');assert.equal(h.tools.eraser,true);assert.equal(h.tools.selectTool,false);assert.equal(h.controller.getSnapshot().activeId,id);assert.equal(h.writes.length,start+1,'intermediate sheet mode notifications do not create preference rewrites');
 h.change({eraser:false,selectTool:true});assert.equal(h.controller.current().tool,'select');assert.equal(h.controller.current().colour,'#123456');assert.equal(before.current.width,3);assert.ok(h.writes.every(write=>write.key==='notemind.toolPresets'));await h.controller.dispose();assert.equal(h.disposed,1);
});
test('controller initialization does not repair a corrupt profile without a user action',()=>{
 const h=fixture({'notemind.toolPresets':'{broken'});assert.equal(h.writes.length,0);assert.equal(h.stored.get('notemind.toolPresets'),'{broken');assert.ok(h.controller.getError());
});
test('failed tool activation restores the actual existing mode and reports its error',()=>{
 const h=fixture();h.controller.add('Erase',settings({tool:'eraser'}));const id=h.controller.getSnapshot().presets[1].id;h.owner.apply=()=>{throw Error('Tool unavailable');};assert.throws(()=>h.controller.activate(id),/Tool unavailable/);assert.equal(h.controller.current().tool,'pen');assert.equal(h.tools.eraser,false);assert.ok(h.errors.includes('Tool unavailable'));
});
test('shared controls install one keyboard owner per window and clean up by registration',()=>{
 const h=fixture(),v=viewFixture(),visible=()=>true;h.controller.add('Blue',settings({colour:'#123456',width:5}));const first=installToolPresetKeyboard(v.view,h.controller,visible),second=installToolPresetKeyboard(v.view,h.controller,visible);assert.equal(v.listeners.get('keydown').size,1);
 const key=v.key('2');assert.equal(key.defaultPrevented,true);assert.equal(h.controller.current().colour,'#123456');first();v.key('1');assert.equal(h.controller.current().colour,'#1C1C1E');assert.equal(v.listeners.get('keydown').size,1);second();assert.equal(v.listeners.get('keydown').size,0);assert.equal(v.listeners.get('compositionstart').size,0);
});
test('actual keyboard adapter respects IME, hidden surfaces, fields, menus and unbound slots',()=>{
 const h=fixture(),v=viewFixture();h.controller.add('Blue',settings({colour:'#123456'}));let visible=true;const off=installToolPresetKeyboard(v.view,h.controller,()=>visible);
 for(const patch of [{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229}])assert.equal(v.key('2',patch).defaultPrevented,false);
 v.dispatch('compositionstart');assert.equal(v.key('2').defaultPrevented,false);v.dispatch('compositionend');v.doc.activeElement=v.input;assert.equal(v.key('2').defaultPrevented,false);v.doc.activeElement=v.surface;v.doc.modal=true;assert.equal(v.key('2').defaultPrevented,false);v.doc.modal=false;visible=false;assert.equal(v.key('2').defaultPrevented,false);visible=true;assert.equal(v.key('9').defaultPrevented,false);assert.equal(v.key('2').defaultPrevented,true);off();
});
test('the actual pen settings popover owns number keys while the drawing canvas retains focus',()=>{
 const h=fixture(),v=viewFixture(),markup=fs.readFileSync('src/tablet/renderer/PenMenu.tsx','utf8').match(/className="([^"]+)" data-pen="sheet"/);assert.ok(markup);
 const dom=require('@mixmark-io/domino').createWindow('<div class="'+markup[1]+'" data-pen="sheet"></div>').document;v.doc.querySelector=selector=>dom.querySelector(selector);
 h.controller.add('Blue',settings({colour:'#123456'}));const off=installToolPresetKeyboard(v.view,h.controller,()=>true);assert.equal(v.doc.activeElement,v.surface);assert.equal(v.key('2').defaultPrevented,false);assert.equal(h.controller.current().colour,'#1C1C1E');
 const popover=dom.querySelector('[data-pen="sheet"]');popover.parentNode.removeChild(popover);assert.equal(v.key('2').defaultPrevented,true);assert.equal(h.controller.current().colour,'#123456');off();
});
test('real mirror bridge forwards preset keys only for focused drawing and consumes only handled slots',()=>{
 const h=fixture(),v=viewFixture();h.controller.add('Blue',settings({colour:'#123456',width:5}));const offKeys=installToolPresetKeyboard(v.view,h.controller,()=>true),offMirror=mirror.registerPadMirrorInput(v.view,fn=>fn()),packet={type:'keydown',key:'2',code:'Digit2',repeat:false,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false};
 assert.equal(mirror.forwardPadMirrorKey(packet),true);assert.equal(h.controller.current().colour,'#123456');assert.equal(mirror.forwardPadMirrorKey({...packet,key:'9',code:'Digit9'}),false);assert.equal(mirror.forwardPadMirrorKey({...packet,type:'keyup'}),false);
 for(const patch of [{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229}])assert.equal(mirror.forwardPadMirrorKey({...packet,...patch}),false);
 v.doc.activeElement=v.input;assert.equal(mirror.forwardPadMirrorKey(packet),false);v.doc.activeElement=v.button;assert.equal(mirror.forwardPadMirrorKey(packet),false);const clicks=v.events.filter(event=>event.type==='click').length;assert.equal(mirror.forwardPadMirrorKey({...packet,key:'Enter',code:'Enter'}),true);assert.equal(v.events.filter(event=>event.type==='click').length,clicks+1);
 v.doc.activeElement=v.surface;v.doc.visibilityState='hidden';assert.equal(mirror.forwardPadMirrorKey(packet),false);v.doc.visibilityState='visible';offMirror();assert.equal(mirror.forwardPadMirrorKey(packet),false);offKeys();
});
function preferences(home){
 const handlers=new Map(),source=fs.readFileSync('src/features.cjs','utf8'),start=source.indexOf(' const preferenceKeys='),end=source.indexOf(" ipcMain.handle('workspace-list'");
 vm.runInNewContext(source.slice(start,end),{home,path,fs:fsp,Buffer,require,win:()=>null,app:{on(){},whenReady:()=>({then(){}})},ipcMain:{on(){},handle:(name,fn)=>handlers.set(name,fn)},clearTimeout,setTimeout});return {get:key=>handlers.get('preference-get')({},key),set:(key,value)=>handlers.get('preference-set')({},key,value)};
}
test('actual profile preference handlers persist presets separately and bound transferred state',async t=>{
 const home=await fsp.mkdtemp(path.join(os.tmpdir(),'notemind-preset-profile-'));t.after(()=>fsp.rm(home,{recursive:true,force:true}));const h=fixture(),value=JSON.stringify({version:1,presets:h.controller.getSnapshot().presets,current:{colour:'#aB12cD',width:2.75}}),first=preferences(home);await first.set('toolPresets',value);const reopened=preferences(home);assert.equal(await reopened.get('toolPresets'),value);assert.equal(await reopened.get('pen'),null);assert.equal(JSON.parse(await fsp.readFile(path.join(home,'preferences','toolPresets.json'),'utf8')),value);await assert.rejects(reopened.set('toolPresets','x'.repeat(32769)),/Invalid tool presets/);await assert.rejects(reopened.set('toolPresets',{}),/Invalid tool presets/);assert.equal(await reopened.get('toolPresets'),value);
});
