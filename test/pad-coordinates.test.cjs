const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const output=buildSync({entryPoints:['src/tablet/renderer/padCoordinates.ts'],bundle:true,platform:'node',format:'cjs',write:false}),loaded={exports:{}};
vm.runInNewContext(output.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process});
const {elementPoint,elementSize,elementRegion,elementTurns,menuRoot,menuRect,menuSize}=loaded.exports;
const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top});
function fixture(turn){
 const root={dataset:{padTurns:String(turn)},closest(){return this},getBoundingClientRect:()=>box(20,30,turn%2?700:500,turn%2?500:700)};
 const body={},doc={body,defaultView:{innerWidth:1200,innerHeight:900},getElementById:name=>name==='notemind-pad-root'?root:null};root.ownerDocument=doc;
 const width=100,height=60,left=40,top=80;
 const physical=(x,y)=>{
  const W=500,H=700;
  switch(turn){case 1:return {clientX:20+H-y,clientY:30+x};case 2:return {clientX:20+W-x,clientY:30+H-y};case 3:return {clientX:20+y,clientY:30+W-x};default:return {clientX:20+x,clientY:30+y}}
 };
 const corners=[[left,top],[left+width,top],[left,top+height],[left+width,top+height]].map(([x,y])=>physical(x,y));
 const child={ownerDocument:doc,closest:()=>root,getBoundingClientRect:()=>box(Math.min(...corners.map(p=>p.clientX)),Math.min(...corners.map(p=>p.clientY)),turn%2?height:width,turn%2?width:height)};
 return {root,body,doc,child,physical,width,height,left,top};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('drawing coordinates follow logical content through every pad rotation',()=>{
 for(let turn=0;turn<4;turn++){
  const f=fixture(turn),size=elementSize(f.child);assert.equal(elementTurns(f.child),turn);assert.equal(size.width,100);assert.equal(size.height,60);
  for(const [x,y] of [[0,0],[100,60],[23.5,42.25],[-20,90]]){
   const point=elementPoint(f.child,f.physical(f.left+x,f.top+y));near(point.x,x);near(point.y,y);assert.equal(point.width,100);assert.equal(point.height,60);
  }
 }
});

test('rotated popup geometry uses the logical root while ordinary windows retain native coordinates',()=>{
 for(let turn=0;turn<4;turn++){
  const f=fixture(turn),rect=menuRect(f.child),size=menuSize(f.doc);
  assert.equal(menuRoot(f.doc),turn?f.root:f.body);
  assert.equal(rect.left,turn?40:60);assert.equal(rect.top,turn?80:110);assert.equal(rect.width,100);assert.equal(rect.height,60);assert.equal(rect.right,rect.left+rect.width);assert.equal(rect.bottom,rect.top+rect.height);
  assert.equal(size.width,turn?500:1200);assert.equal(size.height,turn?700:900);
 }
 const f=fixture(1),plain={ownerDocument:{body:f.body,defaultView:{innerWidth:900,innerHeight:500},getElementById:()=>null},closest:()=>null,getBoundingClientRect:()=>box(12.5,18.5,230.25,150.5)};
 const point=elementPoint(plain,{clientX:25,clientY:40});near(point.x,12.5);near(point.y,21.5);near(elementSize(plain).width,230.25);assert.equal(menuRoot(plain.ownerDocument),f.body);
});

test('selected logical document regions map to the same physical screenshot at every turn',()=>{
 const region={x:.2,y:.25,width:.3,height:.5};
 for(let turn=0;turn<4;turn++){
  const f=fixture(turn),rect=elementRegion(f.child,region);
  const first=f.physical(f.left+region.x*f.width,f.top+region.y*f.height),last=f.physical(f.left+(region.x+region.width)*f.width,f.top+(region.y+region.height)*f.height);
  near(rect.left,Math.min(first.clientX,last.clientX));near(rect.top,Math.min(first.clientY,last.clientY));near(rect.width,Math.abs(last.clientX-first.clientX));near(rect.height,Math.abs(last.clientY-first.clientY));
 }
});
