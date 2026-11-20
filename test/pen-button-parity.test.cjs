const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm'),path=require('node:path');
const result=esbuild.buildSync({stdin:{contents:"export * from './src/tablet/renderer/penButtons.ts';export {setNativeButtons,resetNativeButtons,nativeSideMask} from './src/tablet/renderer/nativeButtons.ts';export {sampleOf as displaySample} from './src/tablet/main/pen/displayCapture.ts';export {sampleOf as tabletSample} from './src/tablet/main/pen/macPenBackend.ts';export {maskOf} from './src/tablet/shared/penEvents.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}),loaded={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process,performance,Buffer,setTimeout,clearTimeout});
const pen=loaded.exports,plain=value=>JSON.parse(JSON.stringify(value)),device={maxX:1000,maxY:1000,maxP:1000};

test('positive-pressure pen contact starts a held action before the HID tip report arrives',()=>{
 const base={present:true,range:true,tip:false,lower:false,upper:false};
 for(const [physical,action]of [['lower','erase'],['upper','select']]){
  pen.resetNativeButtons();pen.setNativeButtons({...base,[physical]:true});
  for(const buttons of [1,2,3]){
   const event={pointerType:'pen',pointerId:7,button:buttons===2?2:0,buttons,pressure:.7};
   assert.equal(pen.inContact(event),true);assert.equal(pen.resolvePress(event,{eraser:false}).kind,action);
   assert.equal(pen.resolvePress({...event,pressure:0},{eraser:false}).kind,'ignore');
  }
  const contact={pointerType:'pen',pointerId:7,button:0,buttons:1,pressure:.7};
  pen.setNativeButtons({...base,tip:true,[physical]:true});assert.equal(pen.resolvePress(contact,{eraser:false}).kind,action);
  const mouse={...contact,pointerType:'mouse'};assert.equal(pen.resolvePress(mouse,{eraser:false}).kind,'draw');assert.equal(pen.resolvePress({...mouse,button:2,buttons:2},{eraser:false}).kind,'select');
 }
 pen.resetNativeButtons();
});

test('right mouse temporarily selects regardless of the active tool or custom pen assignments',()=>{
 pen.resetNativeButtons();
 const right={pointerType:'mouse',pointerId:4243,button:2,buttons:2,pressure:.5};
 const settings={eraser:true,buttons:{lower:{hold:'pan',double:'contextMenu'},upper:{hold:'erase',double:'wider'}}};
 assert.deepEqual(plain(pen.resolvePress(right,settings)),{kind:'select',additive:false,tool:false,move:true});
 assert.equal(pen.resolvePress({...right,button:-1},settings).kind,'select');
 assert.equal(pen.resolvePress({...right,button:0,buttons:1},settings).kind,'erase');
 assert.equal(pen.resolvePress({...right,button:0,buttons:1},{eraser:false}).kind,'draw');
 assert.equal(pen.resolvePress({...right,pointerType:'pen',pointerId:4242,buttons:3},settings).kind,'pan');
 assert.equal(pen.resolvePress({...right,pointerType:'pen',pointerId:4242,button:1,buttons:5},settings).kind,'erase');
});

test('lower and upper physical slots migrate once and retain explicit versioned assignments',()=>{
 assert.deepEqual(plain(pen.DEFAULT_BUTTONS.lower),{hold:'erase',double:'undo'});
 assert.deepEqual(plain(pen.DEFAULT_BUTTONS.upper),{hold:'select',double:'redo'});
 assert.deepEqual(plain(pen.migrateButtons({slots:{lower:{hold:'erase',double:'undo'},upper:{hold:'select',double:'redo'}}})),plain(pen.DEFAULT_BUTTONS));
 assert.deepEqual(plain(pen.migrateButtons({slots:{lower:{hold:'select',double:'redo'},upper:{hold:'erase',double:'undo'}}})),plain(pen.DEFAULT_BUTTONS));
 const custom={lower:{hold:'pan',double:'contextMenu'},upper:{hold:'erase',double:'wider'},eraser:{hold:'none',double:'none'},tipAlt:{hold:'select',double:'none'}};
 assert.deepEqual(plain(pen.migrateButtons({buttonLayout:pen.BUTTON_LAYOUT,slots:custom})),custom);
 const migrated=plain(pen.migrateButtons({slots:custom}));
 assert.deepEqual(migrated,{...custom,lower:custom.upper,upper:custom.lower});
 assert.deepEqual(plain(pen.migrateButtons({buttonLayout:pen.BUTTON_LAYOUT,slots:migrated})),migrated);
 const reversed={...custom,lower:{hold:'select',double:'redo'},upper:{hold:'erase',double:'undo'}};
 assert.deepEqual(plain(pen.migrateButtons({buttonLayout:pen.BUTTON_LAYOUT,slots:reversed})),reversed);
 const rows=pen.buttonRows(pen.DEFAULT_BUTTONS);assert.equal(rows[0].slot,'lower');assert.match(rows[0].name,/Lower.*near/);assert.equal(rows[1].slot,'upper');assert.match(rows[1].name,/Upper.*farther/);
});

test('display capture and separate-tablet HID reports agree on physical holds and air double taps',()=>{
 pen.resetNativeButtons();
 for(const sampleOf of [pen.displaySample,pen.tabletSample]){
  for(const [physicalBit,slot,hold,tap] of [[2,'lower','erase','undo'],[4,'upper','select','redo']]){
   const sample=sampleOf({f:0xe1|physicalBit,x:500,y:500,p:700},device,1);
   const event={pointerType:'pen',pointerId:4242,button:0,buttons:pen.maskOf(sample),pressure:sample.p};
   assert.equal(pen.slotOf(event),slot);assert.equal(pen.resolvePress(event,{eraser:false}).kind,hold);
   let state=pen.noTap,now=10;const fired=[];
   for(const down of [true,false,true,false]){
    const report=sampleOf({f:0xe0|(down?physicalBit:0),x:500,y:500,p:0},device,now);
    const result=pen.tapStep(state,'move',{pointerType:'pen',pointerId:4242,button:-1,buttons:pen.maskOf(report),pressure:0},pen.DEFAULT_BUTTONS,now);
    state=result.state;if(result.fire)fired.push(result.fire);now+=40;
   }
   assert.deepEqual(fired,[tap]);
  }
 }
});

test('passive physical reports resolve the same holds and taps without changing mouse input',()=>{
 const event={pointerType:'pen',pointerId:7,button:0,buttons:0,pressure:0};
 for(const [physical,mask,slot,hold,tap] of [['lower',2,'lower','erase','undo'],['upper',4,'upper','select','redo']]){
  pen.resetNativeButtons();const base={present:true,range:true,tip:false,lower:false,upper:false};
  pen.setNativeButtons({...base,tip:true,[physical]:true});assert.equal(pen.nativeSideMask(),mask);assert.equal(pen.slotOf(event),slot);assert.equal(pen.resolvePress(event,{eraser:false}).kind,hold);
  pen.setNativeButtons(base);let state=pen.noTap,now=10;const fired=[];
  for(const down of [true,false,true,false]){
   pen.setNativeButtons({...base,[physical]:down});
   const result=pen.tapStep(state,'move',{...event,button:-1,buttons:pen.nativeSideMask()},pen.DEFAULT_BUTTONS,now);state=result.state;if(result.fire)fired.push(result.fire);now+=40;
  }
  assert.deepEqual(fired,[tap]);
  assert.equal(pen.resolvePress({...event,pointerType:'mouse',buttons:1},{eraser:false,selectTool:true}).kind,'select');
 }
 pen.resetNativeButtons();
});

test('driver fallback and native capture give the same lower erase and upper select gestures',()=>{
 pen.resetNativeButtons();
 for(const [button,buttons,slot,action]of [[2,3,'lower','erase'],[1,5,'upper','select']]){
  const driver={pointerType:'pen',pointerId:7,button,buttons,pressure:.7};
  assert.equal(pen.slotOf(driver),slot);assert.equal(pen.resolvePress(driver,{eraser:false}).kind,action);
  assert.equal(pen.resolvePress({...driver,button:0},{eraser:false}).kind,action);
 }
});
