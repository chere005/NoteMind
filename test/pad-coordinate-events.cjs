// Check real CSS rotation geometry without showing a window or opening a tablet.
const {app,BrowserWindow}=require('electron'),{buildSync}=require('esbuild'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();if(process.platform==='darwin')app.dock.hide();
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,nodeIntegration:false}});
 try{
  await window.loadURL('data:text/html,<style>html,body{margin:0}</style><div id="notemind-pad-root" style="position:absolute;left:0;top:0;transform-origin:0 0"><div id="surface" style="position:absolute;left:40px;top:80px;width:100px;height:60px"></div></div>');
  const source=buildSync({stdin:{contents:"export * from './src/tablet/renderer/padCoordinates.ts';export * from './src/tablet/renderer/padOrientation.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',globalName:'Geometry',write:false});
  await window.webContents.executeJavaScript(source.outputFiles[0].text+'\n;void 0');
  for(let turns=0;turns<4;turns++){
   const result=await window.webContents.executeJavaScript(`(()=>{const root=document.getElementById('notemind-pad-root'),surface=document.getElementById('surface'),layout=Geometry.padOrientationLayout(500,700,${turns},0,true);Object.assign(root.style,{width:layout.width+'px',height:layout.height+'px',transform:layout.transform});root.dataset.padTurns=String(layout.turns);const r=surface.getBoundingClientRect(),fraction={x:.23,y:.71};let clientX,clientY;switch(${turns}){case 1:clientX=r.right-r.width*fraction.y;clientY=r.top+r.height*fraction.x;break;case 2:clientX=r.right-r.width*fraction.x;clientY=r.bottom-r.height*fraction.y;break;case 3:clientX=r.left+r.width*fraction.y;clientY=r.bottom-r.height*fraction.x;break;default:clientX=r.left+r.width*fraction.x;clientY=r.top+r.height*fraction.y}let point;surface.onpointermove=e=>point=Geometry.elementPoint(surface,e);surface.dispatchEvent(new PointerEvent('pointermove',{clientX,clientY,pointerType:'mouse',pointerId:7}));const menu=Geometry.menuRect(surface);return {point,size:Geometry.elementSize(surface),menu:{left:menu.left,top:menu.top,width:menu.width,height:menu.height},portal:Geometry.menuRoot(document)===(${turns}?root:document.body)}})()`);
   assert.ok(Math.abs(result.point.x-23)<.001);assert.ok(Math.abs(result.point.y-42.6)<.001);assert.equal(result.size.width,100);assert.equal(result.size.height,60);assert.equal(result.portal,true);
   assert.deepEqual(result.menu,{left:40,top:80,width:100,height:60});
  }
  console.log('Pad coordinate events: all four CSS rotations preserve drawing points, dimensions and menu anchors');window.destroy();app.exit(0);
 }catch(error){console.error(error);window.destroy();app.exit(1)}
}).catch(error=>{console.error(error);app.exit(1)});
