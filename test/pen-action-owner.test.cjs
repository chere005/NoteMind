const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),esbuild=require('esbuild');
const source=esbuild.buildSync({stdin:{contents:"export {installPenActions,registerPenHandlers} from './src/tablet/renderer/penActions.ts';export {setNativeButtons,resetNativeButtons} from './src/tablet/renderer/nativeButtons.ts';export {noticePen} from './src/tablet/renderer/penSettings.ts';export {watchDisplaySelection} from './src/tablet/renderer/nativeButtonsFeed.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['react'],write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}).outputFiles[0].text;
const base={present:true,range:true,tip:false,lower:false,upper:false},owned={enabled:true,available:true,owned:true,open:true};
function fixture({pad=false,focused=false}={}){
 let focus=focused,now=0,push,resolve,undo=0,redo=0;const listeners=new Map(),document={hasFocus:()=>focus},window={document,closed:false,addEventListener:(name,listener)=>{const list=listeners.get(name)||[];list.push(listener);listeners.set(name,list);},removeEventListener:(name,listener)=>listeners.set(name,(listeners.get(name)||[]).filter(value=>value!==listener))};
 window.notemind={preferenceGet:async()=>null,preferenceSet:async()=>{},onPreference:()=>()=>{}};if(pad)window.notemind.pad={state:()=>new Promise(done=>resolve=done),onState:listener=>{push=listener;return()=>{};}};
 const module={exports:{}},localStorage={getItem:()=>null,setItem(){}};vm.runInNewContext(source,{module,exports:module.exports,require,window,document,localStorage,performance:{now:()=>now},setTimeout,clearTimeout});const api=module.exports;api.registerPenHandlers({undo:()=>undo++,redo:()=>redo++});const stop=api.installPenActions(window);api.setNativeButtons(base);
 const report=(patch={},delay=20)=>{now+=delay;api.setNativeButtons({...base,...patch},now);};
 const tap=(slot='lower')=>{report({[slot]:true});report();};
 const pointer=(type,values)=>{now+=20;let prevented=false,stopped=false;const event={type,pointerId:21,pointerType:'mouse',button:-1,buttons:0,pressure:0,clientX:100,clientY:100,target:null,...values,preventDefault(){prevented=true},stopPropagation(){},stopImmediatePropagation(){stopped=true}};if(event.pointerType==='pen')api.noticePen(event);for(const listener of listeners.get(type)||[]){if(stopped)break;listener(event);}return {prevented,stopped};};
 return {pointer,noNative:()=>api.resetNativeButtons(),report,tap,double:()=>{tap();tap();},undo:()=>undo,redo:()=>redo,stop,push:value=>push(value),resolve:value=>resolve(value),focus:value=>{focus=value;if(!value)for(const listener of listeners.get('blur')||[])listener();}};
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

test('the upper button redoes once across a brief proximity gap on the owned Wacom display',()=>{
 const h=fixture({pad:true});h.push(owned);
 h.tap('upper');assert.equal(h.redo(),0);
 h.report({range:false});h.report();h.tap('upper');
 assert.equal(h.redo(),1);assert.equal(h.undo(),0);h.stop();
});

test('an interrupted press, disconnect, or expired tap does not count toward redo',()=>{
 const h=fixture({focused:true});
 h.report({upper:true});h.report({range:false});h.report();h.tap('upper');assert.equal(h.redo(),0);
 h.report({present:false,range:false});h.report();h.tap('upper');assert.equal(h.redo(),0);
 h.report({range:false},410);h.report();h.tap('upper');assert.equal(h.redo(),0);
 h.tap('upper');assert.equal(h.redo(),1);h.stop();
});

test('Wacom positions make a selection gesture without driver pointer events',()=>{
	const events=[],listeners=new Map(),module={exports:{}};
	let point;
	const window={PointerEvent:class{constructor(type,properties){Object.assign(this,{type},properties);}},
		addEventListener(){},removeEventListener(){},wm:{pen:{onSelectionPoint:listener=>{point=listener;return()=>{point=null;};}}},
		notemind:{preferenceGet:async()=>null,onPreference(){}}};
	const document={defaultView:window,elementFromPoint:x=>x>=0?surface:null};
	const surface={ownerDocument:document,isConnected:true,contains:node=>node===surface,closest:()=>null,
		addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type),
		dispatchEvent:event=>events.push([event.type,event.clientX,event.clientY,event.buttons])};
	vm.runInNewContext(source,{module,exports:module.exports,require,window,document,performance});
	const {watchDisplaySelection,setNativeButtons}=module.exports;
	const off=watchDisplaySelection(surface,()=>true),active={...base,tip:true,upper:true,selectionPosition:true};
	setNativeButtons(active);
	point({start:true,pad:true,clientX:10,clientY:20});
	point({start:true,pad:false,clientX:-5,clientY:20});
	point({start:false,pad:false,clientX:10,clientY:20});
	assert.deepEqual(events,[],'A different window or a start outside the sheet cannot select');
	point({start:true,pad:false,clientX:10,clientY:20});
	let scrolled=true;listeners.get('wheel')({preventDefault(){scrolled=false;},stopImmediatePropagation(){}});
	assert.equal(scrolled,false);
	setNativeButtons({...active,upper:false});
	point({start:false,pad:false,clientX:95,clientY:70});
	setNativeButtons({...active,upper:false,tip:false});
	assert.deepEqual(events,[['pointerdown',10,20,5],['pointermove',95,70,5],['pointerup',95,70,0]]);
	setNativeButtons(active);point({start:true,pad:false,clientX:15,clientY:30});
	setNativeButtons({...base,present:false,range:false});
	assert.deepEqual(events.at(-1),['pointercancel',15,30,0]);
	off();assert.equal(point,null);assert.equal(listeners.size,0);
});


test('driver fallback keeps a real mouse right-drag away from the pen while preserving local echoes',()=>{
 const h=fixture({focused:true});h.noNative();h.pointer('pointermove',{pointerType:'pen'});
 const real=h.pointer('pointerdown',{button:2,buttons:2,clientX:300,clientY:300});assert.equal(real.prevented,false);assert.equal(real.stopped,false);h.pointer('pointerup',{button:2,buttons:0,clientX:300,clientY:300});
 for(const [button,buttons]of [[2,2],[1,4]])for(let tap=0;tap<2;tap++){assert.equal(h.pointer('pointerdown',{button,buttons}).prevented,true);assert.equal(h.pointer('pointerup',{button,buttons:0}).prevented,true);}assert.equal(h.undo(),1);assert.equal(h.redo(),1);h.stop();
});
