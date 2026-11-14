const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
function bundle(file){const result=buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});return result.outputFiles[0].text}
function load(code,globals={}){const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require,process,...globals});return module.exports}
const {A5_ASPECT,padOrientationLayout}=load(bundle('src/tablet/renderer/padOrientation.ts'));

test('page-following chrome accounts for the display rotation without turning it twice',()=>{
 assert.equal(A5_ASPECT,148/210);
 for(let page=0;page<4;page++)for(let display=0;display<4;display++){
  const layout=padOrientationLayout(1920,1080,page,display*90,true),turns=(page-display+4)%4;
  assert.equal(layout.turns,turns);
  assert.equal(layout.width,turns%2?1080:1920);assert.equal(layout.height,turns%2?1920:1080);
  const fixed=padOrientationLayout(1920,1080,page,display*90,false);
  assert.equal(fixed.turns,0);assert.equal(fixed.transform,'none');assert.equal(fixed.width,1920);assert.equal(fixed.height,1080);
 }
 assert.equal(padOrientationLayout(1080,1920,1,90,true).transform,'none');
 assert.equal(padOrientationLayout(1080,1920,3,270,true).transform,'none');
});

test('each chrome transform fills the display from a top-left CSS origin',()=>{
 for(const [width,height] of [[1920,1080],[1080,1920],[460,700]])for(let turn=0;turn<4;turn++){
  const layout=padOrientationLayout(width,height,turn,0,true);
  const translation=layout.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/),tx=translation?Number(translation[1]):0,ty=translation?Number(translation[2]):0;
  const angle=turn*Math.PI/2,cos=Math.round(Math.cos(angle)),sin=Math.round(Math.sin(angle));
  const corners=[[0,0],[layout.width,0],[0,layout.height],[layout.width,layout.height]].map(([x,y])=>({x:tx+x*cos-y*sin,y:ty+x*sin+y*cos}));
  assert.equal(Math.min(...corners.map(p=>p.x)),0);assert.equal(Math.max(...corners.map(p=>p.x)),width);
  assert.equal(Math.min(...corners.map(p=>p.y)),0);assert.equal(Math.max(...corners.map(p=>p.y)),height);
 }
});

test('the menu-bar rotation choice is stored in the shared profile and follows other windows',async()=>{
 const code=bundle('src/tablet/renderer/orientation.ts'),stored=new Map(),profile=new Map(),listeners=[];
 const localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const open=()=>load(code,{localStorage,window:{addEventListener(){},notemind:{preferenceGet:key=>Promise.resolve(profile.get(key)??null),preferenceSet:(key,value)=>{profile.set(key,value);return Promise.resolve()},onPreference:fn=>listeners.push(fn)}}});
 const first=open();await Promise.resolve();assert.equal(first.padChromeOrientation(),false);
 first.setPadChromeOrientation(true);assert.equal(profile.get('padChromeOrientation'),true);assert.equal(stored.get('notemind.padChromeOrientation'),'true');
 stored.clear();const reopened=open();await Promise.resolve();assert.equal(reopened.padChromeOrientation(),true);assert.equal(stored.get('notemind.padChromeOrientation'),'true');
 for(const listener of listeners)listener({key:'padChromeOrientation',value:false});
 assert.equal(first.padChromeOrientation(),false);assert.equal(reopened.padChromeOrientation(),false);
});

test('a late startup preference answer cannot undo a new menu-bar rotation choice',async()=>{
 const code=bundle('src/tablet/renderer/orientation.ts');let resolve;
 const pending=new Promise(done=>resolve=done),stored=new Map();
 const state=load(code,{localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},window:{addEventListener(){},notemind:{preferenceGet:key=>key==='padChromeOrientation'?pending:Promise.resolve(null),preferenceSet:()=>Promise.resolve(),onPreference(){}}}});
 state.setPadChromeOrientation(true);resolve(false);await Promise.resolve();
 assert.equal(state.padChromeOrientation(),true);
});
