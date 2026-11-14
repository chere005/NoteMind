const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm'),path=require('node:path');
const result=esbuild.buildSync({stdin:{contents:"export * from './src/tablet/renderer/penButtons.ts';export {setNativeButtons,resetNativeButtons,nativeSideMask} from './src/tablet/renderer/nativeButtons.ts';export {sampleOf as displaySample} from './src/tablet/main/pen/displayCapture.ts';export {sampleOf as tabletSample} from './src/tablet/main/pen/macPenBackend.ts';export {maskOf} from './src/tablet/shared/penEvents.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}}),loaded={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process,performance,Buffer,setTimeout,clearTimeout});
const pen=loaded.exports,plain=value=>JSON.parse(JSON.stringify(value)),device={maxX:1000,maxY:1000,maxP:1000};

test('first and second button defaults migrate the old pair while retaining custom assignments',()=>{
 assert.deepEqual(plain(pen.DEFAULT_BUTTONS.upper),{hold:'erase',double:'undo'});
 assert.deepEqual(plain(pen.DEFAULT_BUTTONS.lower),{hold:'select',double:'redo'});
 assert.deepEqual(plain(pen.migrateButtons({slots:{lower:{hold:'erase',double:'undo'},upper:{hold:'select',double:'redo'}}})),plain(pen.DEFAULT_BUTTONS));
 const custom={lower:{hold:'pan',double:'contextMenu'},upper:{hold:'erase',double:'wider'},eraser:{hold:'none',double:'none'},tipAlt:{hold:'select',double:'none'}};
 assert.deepEqual(plain(pen.migrateButtons({slots:custom})),custom);
 const rows=pen.buttonRows(pen.DEFAULT_BUTTONS,true);assert.equal(rows[0].slot,'upper');assert.match(rows[0].name,/First.*nearer/);assert.equal(rows[1].slot,'lower');assert.match(rows[1].name,/Second.*farther/);
 assert.match(pen.buttonsHint(true),/needs no setting/);
});

test('display capture and separate-tablet HID reports agree on physical holds and air double taps',()=>{
 pen.resetNativeButtons();
 for(const sampleOf of [pen.displaySample,pen.tabletSample]){
  for(const [physicalBit,slot,hold,tap] of [[2,'upper','erase','undo'],[4,'lower','select','redo']]){
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
 for(const [physical,mask,slot,hold,tap] of [['lower',4,'upper','erase','undo'],['upper',2,'lower','select','redo']]){
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
