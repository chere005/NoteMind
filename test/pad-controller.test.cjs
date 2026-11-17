const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {FRAME,createPadController}=require('../src/pad-controller.cjs');
function setup(){
 const primary={id:1,internal:true,label:'Built-in',bounds:{x:0,y:0,width:1440,height:900},workArea:{x:0,y:0,width:1440,height:850}},display={id:2,internal:false,label:'Wacom One',bounds:{x:1440,y:0,width:1920,height:1080}};
 const screen=new EventEmitter();screen.displays=[primary,display];screen.getAllDisplays=()=>screen.displays;screen.getPrimaryDisplay=()=>primary;
 const owner={bounds:{x:0,y:0,width:1000,height:700},getBounds(){return this.bounds},setBounds(b){this.bounds=b},isFocused:()=>true,isVisible:()=>true};const changes=[];
 const controller=createPadController({screen,owner,onChange:s=>changes.push(s)});
 function window(){const p=new EventEmitter();p.destroyed=false;p.visible=false;p.webContents=new EventEmitter();p.webContents.setWindowOpenHandler=fn=>p.openHandler=fn;p.webContents.inputs=[];p.webContents.sendInputEvent=event=>p.webContents.inputs.push(event);p.isDestroyed=()=>p.destroyed;p.isVisible=()=>p.visible;p.isFocused=()=>false;p.showInactive=()=>{p.visible=true};p.hide=()=>{p.visible=false};p.setAlwaysOnTop=(value,level)=>{p.top={value,level}};p.setBounds=b=>{p.bounds=b};p.getBounds=()=>p.bounds;p.close=()=>{p.destroyed=true;p.emit('closed')};return p;}
 return {screen,owner,display,controller,window,changes};
}
test('allows only the dedicated window on an extended pen display',()=>{const h=setup(),c=h.controller;assert.equal(c.decision({frameName:'other',url:'about:blank'}).action,'deny');assert.equal(c.decision({frameName:FRAME,url:'https://example.com'}).action,'deny');const options=c.decision({frameName:FRAME,url:'about:blank'}).overrideBrowserWindowOptions;assert.equal(options.x,1440);assert.equal(options.width,1920);assert.equal(options.height,1080);for(const key of ['frame','resizable','movable','minimizable','maximizable','fullscreenable','hasShadow','roundedCorners'])assert.equal(options[key],false,key);assert.equal(options.enableLargerThanScreen,true);assert.equal(options.acceptFirstMouse,true);h.screen.displays.pop();assert.equal(c.decision({frameName:FRAME,url:'about:blank'}).action,'deny');c.dispose();});
test('waits for content, handles removal and closes with its owner',()=>{const h=setup(),c=h.controller,p=h.window();assert.equal(c.attach(p),true);assert.deepEqual(p.top,{value:true,level:'status'});assert.equal(p.visible,false);c.markReady();assert.equal(p.visible,true);assert.equal(c.decision({frameName:FRAME,url:'about:blank'}).action,'deny');h.screen.displays.pop();h.screen.emit('display-removed');assert.equal(p.visible,false);h.screen.displays.push(h.display);h.screen.emit('display-added');assert.equal(p.visible,true);c.setEnabled(false);assert.equal(p.destroyed,true);assert.equal(c.state().enabled,false);c.dispose();});
test('moves the owner away from the pen display and denies nested windows',()=>{const h=setup(),c=h.controller,p=h.window();h.owner.bounds={x:1500,y:50,width:1000,height:700};c.attach(p);c.markReady();assert.ok(h.owner.bounds.x<1440);assert.equal(p.openHandler().action,'deny');let prevented=false;p.webContents.emit('will-navigate',{preventDefault:()=>prevented=true});assert.equal(prevented,true);c.dispose();assert.equal(p.destroyed,true);});

test('mirror input is bounded and rejected after the display closes',()=>{
 const h=setup(),c=h.controller,p=h.window();c.attach(p);assert.equal(c.input({type:'mouseDown',x:0,y:0}),false);c.markReady();
 assert.equal(c.input({type:'mouseDown',x:9999,y:-2,button:'right'}),true);assert.deepEqual(p.webContents.inputs[0],{type:'mouseDown',x:1919,y:0,button:'right',clickCount:1});
 assert.equal(c.input({type:'keyDown',x:5,y:5}),false);assert.equal(c.input({type:'mouseMove',x:NaN,y:5}),false);c.setEnabled(false);assert.equal(c.input({type:'mouseUp',x:5,y:5}),false);c.dispose();
});
test('a visible display stays active when the mouse focuses another application',()=>{
 const h=setup(),c=h.controller,p=h.window();c.attach(p);c.markReady();h.owner.isFocused=()=>false;c.refresh();assert.equal(p.visible,true);assert.equal(c.captureEligible(),true);c.setOwned(false);assert.equal(p.visible,false);assert.equal(c.captureEligible(),false);c.dispose();
});
test('idle mirroring slows down, wakes for input and stops before capturing a hidden owner',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const h=setup(),c=h.controller,p=h.window();let captures=0;
 p.webContents.capturePage=async()=>{captures++;return {isEmpty:()=>false,getSize:()=>({width:800,height:600}),toJPEG:()=>Buffer.from('same frame')};};
 c.attach(p);c.markReady();
 const tick=async ms=>{t.mock.timers.tick(ms);await Promise.resolve();await Promise.resolve();};
 await tick(0);assert.equal(captures,1);
 await tick(200);assert.equal(captures,2);
 await tick(400);assert.equal(captures,3);
 await tick(800);assert.equal(captures,4);
 await tick(999);assert.equal(captures,4,'idle mirror waits a full second');
 c.activity();await tick(100);assert.equal(captures,5,'interaction wakes the mirror promptly');
 c.activity();await tick(50);c.activity();await tick(50);assert.equal(captures,6,'continuous interaction cannot postpone a scheduled capture');
 h.owner.isVisible=()=>false;await tick(1000);assert.equal(captures,6,'visibility is checked before capture');c.dispose();
});
test('background throttling follows the actually visible display and returns on every hiding path',()=>{
 const h=setup(),c=h.controller,p=h.window(),changes=[];let minimized=false,visible=true;h.owner.webContents={setBackgroundThrottling:value=>changes.push(value)};h.owner.isMinimized=()=>minimized;h.owner.isVisible=()=>visible;
 c.attach(p);assert.equal(changes.at(-1),true);assert.equal(c.state().open,false);c.markReady();assert.equal(changes.at(-1),false);assert.equal(c.state().open,true);
 minimized=true;c.refresh();assert.equal(changes.at(-1),true);assert.equal(c.state().open,false);minimized=false;c.refresh();assert.equal(changes.at(-1),false);
 visible=false;c.refresh();assert.equal(changes.at(-1),true);visible=true;c.refresh();assert.equal(changes.at(-1),false);
 c.setOwned(false);assert.equal(changes.at(-1),true);c.setOwned(true);assert.equal(changes.at(-1),false);
 p.hide();p.emit('hide');assert.equal(changes.at(-1),true);c.refresh();assert.equal(changes.at(-1),false);p.close();assert.equal(changes.at(-1),true);c.dispose();
});
test('disposing a visible display restores owner background throttling',()=>{
 const h=setup(),p=h.window(),changes=[];h.owner.webContents={setBackgroundThrottling:value=>changes.push(value)};h.controller.attach(p);h.controller.markReady();assert.equal(changes.at(-1),false);h.controller.dispose();assert.equal(changes.at(-1),true);
});

test('closing the main window disposes the pad without reading destroyed web contents',()=>{
 const h=setup(),p=h.window();h.controller.attach(p);h.controller.markReady();h.owner.isDestroyed=()=>true;Object.defineProperty(h.owner,'webContents',{get(){throw Error('Object has been destroyed');}});assert.doesNotThrow(()=>h.controller.dispose());assert.equal(p.destroyed,true);
});
