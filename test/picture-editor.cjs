const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 if(process.platform==='darwin')app.dock.hide();
 const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,nodeIntegration:true}});
 try{
  await w.loadURL('data:text/html,<html><body></body></html>');
  const sourceRoot=process.env.NOTEMIND_TEST_APP||path.resolve(__dirname,'../src');
  const geometry=fs.readFileSync(path.join(sourceRoot,'picture-geometry.js'),'utf8');
  const editor=fs.readFileSync(path.join(sourceRoot,'notes-picture.js'),'utf8');
  await w.webContents.executeJavaScript(`
   window.rich=document.createElement('article');document.body.append(rich);window.visual=true;window.module=undefined;let serial=0;Object.defineProperty(crypto,'randomUUID',{value:()=> 'test-id-'+(++serial)});window.activeTab={};window.doc={assets:{}};window.richChanged=false;window.calls=[];
   window.markDirty=()=>calls.push('dirty');window.NoteMindHistory={transaction:fn=>{calls.push('transaction');fn()}};
   const initial=document.createElement('canvas');initial.width=4;initial.height=2;const c=initial.getContext('2d');c.fillStyle='#ff0000';c.fillRect(0,0,2,2);c.fillStyle='#0000ff';c.fillRect(2,0,2,2);
   window.url=initial.toDataURL();doc.assets['assets/old.png']=url.split(',')[1];window.assetUrl=()=>url;
   window.original=document.createElement('img');original.dataset.asset='assets/old.png';original.src=url;rich.append(original);
  `);
  await w.webContents.executeJavaScript(fs.readFileSync(path.join(sourceRoot,'document-renderer.js'),'utf8'));
  await w.webContents.executeJavaScript(fs.readFileSync(path.join(sourceRoot,'image-previews.js'),'utf8'));
  await w.webContents.executeJavaScript("NoteMindImagePreviews.mount(rich,()=>doc.assets);NoteMindImagePreviews.apply(original,'assets/old.png',doc.assets['assets/old.png'],'image/png');NoteMindImagePreviews.ensure(original);");
  await w.webContents.executeJavaScript(geometry);await w.webContents.executeJavaScript(editor);
  const result=await w.webContents.executeJavaScript(`(async()=>{
   await window.NoteMindPicture.edit(original);const dialog=document.querySelector('.picture-editor');const canvas=dialog.querySelector('canvas');
   dialog.querySelector('[data-act=right]').click();const rotated=[canvas.width,canvas.height];
   const rect=canvas.getBoundingClientRect();const event=(name,x,y)=>canvas.dispatchEvent(new PointerEvent(name,{bubbles:true,pointerId:1,button:0,clientX:rect.left+x,clientY:rect.top+y}));
   canvas.setPointerCapture=()=>{};event('pointerdown',0,0);event('pointerup',2,2);dialog.querySelector('[data-act=crop]').click();
   const cropped=[canvas.width,canvas.height];dialog.querySelector('[data-act=apply]').click();
   await NoteMindImagePreviews.ensure(original);const img=new Image();img.src=original.src;await img.decode();const check=document.createElement('canvas');check.width=img.width;check.height=img.height;check.getContext('2d').drawImage(img,0,0);
   const pixel=[...check.getContext('2d').getImageData(0,0,1,1).data],size=[img.width,img.height];
   original.click();const selection=document.querySelector('.picture-selection');const shown=!selection.hidden;selection.querySelector('[data-rotate="90"]').click();while(calls.length<4)await new Promise(resolve=>setTimeout(resolve,10));await NoteMindImagePreviews.ensure(original);const rotatedInline=[original.naturalWidth,original.naturalHeight];
   const handle=selection.querySelector('.picture-resize-handle');handle.setPointerCapture=()=>{};const bounds=original.getBoundingClientRect();const pointer=(type,x)=>handle.dispatchEvent(new PointerEvent(type,{pointerId:5,button:0,clientX:x,clientY:bounds.bottom,bubbles:true,cancelable:true}));pointer('pointerdown',bounds.right);pointer('pointermove',bounds.right+20);const during=original.getBoundingClientRect().width;pointer('pointerup',bounds.right+20);await NoteMindImagePreviews.ensure(original);
   selection.querySelector('[data-rotate="90"]').click();while(calls.length<8)await new Promise(resolve=>setTimeout(resolve,10));await NoteMindImagePreviews.ensure(original);
   return {compact:original.src.startsWith('blob:')&&Number(original.getAttribute('width'))===original.naturalWidth&&Number(original.getAttribute('height'))===original.naturalHeight,during,style:original.getAttribute('style'),shown,rotatedInline,resized:[original.naturalWidth,original.naturalHeight],displayWidth:doc.meta.imageWidths[original.dataset.asset],rotated,cropped,size,pixel,original:!!doc.assets['assets/old.png'],name:original.dataset.asset,calls};
  })()`);
  require('node:assert/strict').deepEqual(result.rotated,[2,4]);require('node:assert/strict').deepEqual(result.cropped,[2,2]);require('node:assert/strict').deepEqual(result.size,[2,2]);require('node:assert/strict').deepEqual(result.pixel,[255,0,0,255]);require('node:assert/strict').ok(result.original&&result.name!=='assets/old.png');require('node:assert/strict').deepEqual(result.calls,['transaction','dirty','transaction','dirty','transaction','dirty','transaction','dirty']);require('node:assert/strict').ok(result.shown);require('node:assert/strict').deepEqual(result.rotatedInline,[2,2]);require('node:assert/strict').deepEqual(result.resized,[2,2]);require('node:assert/strict').equal(result.displayWidth,22);
  require('node:assert/strict').ok(result.compact);console.log('Picture editor: real canvas crop, rotation and cached dimensions passed');w.destroy();app.exit(0);
 }catch(error){console.error(String(error),error.stack);w.destroy();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1)});
