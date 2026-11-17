const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),esbuild=require('esbuild');
const source=esbuild.buildSync({stdin:{contents:"export {installPenActions,registerPenHandlers} from './src/tablet/renderer/penActions.ts';export {setNativeButtons,resetNativeButtons} from './src/tablet/renderer/nativeButtons.ts';export {noticePen} from './src/tablet/renderer/penSettings.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['react'],write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}).outputFiles[0].text;
const base={present:true,range:true,tip:false,lower:false,upper:false},owned={enabled:true,available:true,owned:true,open:true};
function fixture({pad=false,focused=false}={}){
 let focus=focused,now=0,push,resolve,undo=0;const listeners=new Map(),document={hasFocus:()=>focus},window={document,closed:false,addEventListener:(name,listener)=>{const list=listeners.get(name)||[];list.push(listener);listeners.set(name,list);},removeEventListener:(name,listener)=>listeners.set(name,(listeners.get(name)||[]).filter(value=>value!==listener))};
 window.notemind={preferenceGet:async()=>null,preferenceSet:async()=>{},onPreference:()=>()=>{}};if(pad)window.notemind.pad={state:()=>new Promise(done=>resolve=done),onState:listener=>{push=listener;return()=>{};}};
 const module={exports:{}},localStorage={getItem:()=>null,setItem(){}};vm.runInNewContext(source,{module,exports:module.exports,require,window,document,localStorage,performance:{now:()=>now},setTimeout,clearTimeout});const api=module.exports;api.registerPenHandlers({undo:()=>undo++});const stop=api.installPenActions(window);api.setNativeButtons(base);
 const tap=()=>{now+=20;api.setNativeButtons({...base,lower:true},now);now+=20;api.setNativeButtons(base,now);};
 const pointer=(type,values)=>{now+=20;let prevented=false,stopped=false;const event={type,pointerId:21,pointerType:'mouse',button:-1,buttons:0,pressure:0,clientX:100,clientY:100,target:null,...values,preventDefault(){prevented=true},stopPropagation(){},stopImmediatePropagation(){stopped=true}};if(event.pointerType==='pen')api.noticePen(event);for(const listener of listeners.get(type)||[]){if(stopped)break;listener(event);}return {prevented,stopped};};
 return {pointer,noNative:()=>api.resetNativeButtons(),tap,double:()=>{tap();tap();},undo:()=>undo,stop,push:value=>push(value),resolve:value=>resolve(value),focus:value=>{focus=value;if(!value)for(const listener of listeners.get('blur')||[])listener();}};
}
test('passive reports only undo the focused window when drawing has no dedicated display',()=>{
 const a=fixture(),b=fixture();a.double();b.double();assert.equal(a.undo(),0);assert.equal(b.undo(),0);a.focus(true);a.double();b.double();assert.equal(a.undo(),1);assert.equal(b.undo(),0);a.stop();b.stop();
});
test('the visible Wacom owner accepts air taps while another app has mouse focus',()=>{
 const h=fixture({pad:true});h.push(owned);h.double();assert.equal(h.undo(),1);h.push({...owned,owned:false});h.double();assert.equal(h.undo(),1);h.push({...owned,open:false});h.double();assert.equal(h.undo(),1);h.focus(true);h.double();assert.equal(h.undo(),1,'focus cannot bypass another Wacom owner or a hidden pad');h.push({...owned,enabled:false});h.double();assert.equal(h.undo(),2);h.stop();h.double();assert.equal(h.undo(),2);
});
test('a partial tap is discarded on ownership loss or window blur',()=>{
 const pad=fixture({pad:true});pad.push(owned);pad.tap();pad.push({...owned,owned:false});pad.push(owned);pad.tap();assert.equal(pad.undo(),0);pad.tap();assert.equal(pad.undo(),1);pad.stop();
 const main=fixture({focused:true});main.tap();main.focus(false);main.focus(true);main.tap();assert.equal(main.undo(),0);main.tap();assert.equal(main.undo(),1);main.stop();
});
test('a delayed pad snapshot cannot supersede a newer ownership push',async()=>{
 const h=fixture({pad:true});h.double();assert.equal(h.undo(),0,'ownership is unknown before the first state');h.push({...owned,owned:false});h.resolve(owned);await Promise.resolve();await Promise.resolve();h.double();assert.equal(h.undo(),0);h.push(owned);h.double();assert.equal(h.undo(),1);h.stop();
});


test('driver fallback keeps a real mouse right-drag away from the pen while preserving local echoes',()=>{
 const h=fixture({focused:true});h.noNative();h.pointer('pointermove',{pointerType:'pen'});
 const real=h.pointer('pointerdown',{button:2,buttons:2,clientX:300,clientY:300});assert.equal(real.prevented,false);assert.equal(real.stopped,false);h.pointer('pointerup',{button:2,buttons:0,clientX:300,clientY:300});
 for(let tap=0;tap<2;tap++){assert.equal(h.pointer('pointerdown',{button:1,buttons:4}).prevented,true);assert.equal(h.pointer('pointerup',{button:1,buttons:0}).prevented,true);}assert.equal(h.undo(),1);h.stop();
});
