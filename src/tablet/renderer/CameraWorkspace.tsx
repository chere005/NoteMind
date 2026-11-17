import {CameraHeader} from './CameraHeader';
import {PaneChrome} from './PaneChrome';
import {elementPoint,elementSize} from './padCoordinates';
import {headerFit} from './cameraHeaderFit';
import {SheetTab} from './SheetTab';
import React, {useCallback, useEffect, useLayoutEffect, useRef, useState,useSyncExternalStore} from 'react';

import {createPortal} from 'react-dom';

import {validCameraPages} from './validateStorage';
import {CameraPictures,pictureRef} from '../../camera-pictures.js';
import {CameraModels} from '../../camera-models.js';
import {CameraPersistence} from '../../camera-persistence.js';
import {CameraMedia} from '../../camera-media.js';
import {createInkActionController,projectInkSnapshot,hasPendingInkMutations,subscribeInkMutations,flushInkMutations} from '../../ink-mutations.js';
import {afterCameraCapture,outsideCameraSelection} from '../../camera-editing.js';

import {CameraInk} from './CameraInk';
import {CameraProcessing,pngBlobDataURL} from './cameraProcessing';

import {inkToScreen,screenToInk,inkUnit} from './cameraInkGeometry';
import {cameraReference,cameraInkView,inkToPreview,selectionInInk} from './cameraReference';

import {zoomScale} from '../core';

import {TabletPage} from './tabletPage';

import {BoxActions} from './BoxActions';


import {selectionHit, selectionStep} from './selectionGesture';

import {MenuButton} from './MenuButton';

import {Icon} from './icons';

import {findPage} from './findPage';



import './cameraWorkspace.css';



export function CameraWorkspace({rescan,onRescan,colour, width, onClose, onActivate, tabsTarget, active: cameraActive}) {

 const video=useRef(null), stage=useRef(null), ink=useRef(null), page=useRef(null), media=useRef(null), start=useRef(null), cornerDrag=useRef(null);
 if(!media.current)media.current=new CameraMedia();
 if(!page.current)page.current=new TabletPage();
 const pictures=useRef(null),pictureCanvas=useRef(null),keepingPage=useRef(false),cameraStore=useRef(null),cameraWork=useRef(new Set());if(!pictures.current)pictures.current=new CameraPictures();
 const [decoded,setDecoded]=useState(null),[keeping,setKeeping]=useState(false),[capturing,setCapturing]=useState(false);
 const captureBusy=useRef(false),processor=useRef(null);
 useEffect(()=>{const owned=new CameraProcessing();processor.current=owned;return()=>{owned.dispose();if(processor.current===owned)processor.current=null;};},[]);
 const [,refreshPending]=useState(0);

 const models=useRef(null);if(!models.current)models.current=new CameraModels([{name:'Live',picture:null,page:page.current,device:''}]);
 const latestCamera=models.current,pages=useSyncExternalStore(latestCamera.subscribe,latestCamera.getSnapshot),setPages=latestCamera.update;
 const [active,setActive]=useState(0),[cameraLoaded,setCameraLoaded]=useState(false),[cameraLoadError,setCameraLoadError]=useState('');const cameraSaves=useRef(Promise.resolve()),cameraTimer=useRef(null),cameraLoad=useRef(Promise.resolve()),cameraPersistence=useRef({loaded:false,error:''});page.current=pages[active]?.page||pages[0].page;const currentPage=pages[active]||pages[0],pageOpening=currentPage.loaded===false,storedPicture=currentPage.picture||null,hasPicture=currentPage.hasPicture||!!storedPicture,still=cameraActive&&!pageOpening&&decoded?.ref===storedPicture?decoded.image:null;

 const [toast,setToast]=useState(''),[devices,setDevices]=useState([]),[error,setError]=useState(''),[ready,setReady]=useState(false),[deviceTick,setDeviceTick]=useState(0),[held,setHeld]=useState(null),[box,setBox]=useState(null),[corners,setCorners]=useState(null),[zoom,setZoom]=useState(null),[zoomArmed,setZoomArmed]=useState(false),[drawing,setDrawing]=useState(false),[size,setSize]=useState({width:1,height:1}),[videoFrame,setFrame]=useState({width:1,height:1}),[revision,setRevision]=useState(0);

 useEffect(()=>{if(pictures.current.closed)pictures.current=new CameraPictures();const owned=pictures.current;return()=>owned.dispose();},[]);
 useEffect(()=>{
  if(!cameraActive||!storedPicture||pageOpening){setDecoded(null);return;}
  const controller=new AbortController();let lease=null,live=true;
  pictures.current.acquire(storedPicture,{signal:controller.signal}).then(value=>{if(!live){value.release();return;}lease=value;setDecoded({ref:storedPicture,image:value.image});}).catch(failure=>{if(live&&failure.name!=='AbortError')setError(failure.message);});
  return()=>{live=false;controller.abort();lease?.release();};
 },[cameraActive,storedPicture,pageOpening]);
 useLayoutEffect(()=>{
  const canvas=pictureCanvas.current,source=cameraActive&&(held||still);if(!canvas)return;
  if(!source){canvas.width=canvas.height=1;return;}
  canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
 },[cameraActive,held,still]);

 const currentView=useRef(null);currentView.current={page:page.current,box,corners,active:cameraActive};
 const cameraActions=useRef(new WeakMap()),cameraActionSet=useRef(new Set());
 const actionsFor=owner=>{let actions=cameraActions.current.get(owner);const callbacks={onEdited:()=>setRevision(value=>value+1),onError:failure=>{if(failure.name!=='AbortError')setError(failure.message);}};if(!actions){actions=createInkActionController(owner,callbacks);cameraActions.current.set(owner,actions);cameraActionSet.current.add(actions);}else actions.attach(callbacks);return actions;};
 useEffect(()=>{const unsubscribe=subscribeInkMutations(owner=>{if(owner===page.current)refreshPending(value=>value+1);});return()=>{unsubscribe();for(const actions of cameraActionSet.current)actions.detach();cameraActionSet.current.clear();};},[]);
 const trackCameraWork=work=>{cameraWork.current.add(work);void work.finally(()=>cameraWork.current.delete(work)).catch(()=>{});return work;};
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer)},[toast]);
 useEffect(()=>{const entry=pages[active];if(entry&&((entry.box||null)!==box||(entry.corners||null)!==corners||(entry.zoom||null)!==zoom))setPages(old=>old.map(item=>item.page===entry.page?{...item,box,corners,zoom}:item));},[box,corners,zoom,active]);
 const selectPage=i=>{ink.current?.finish();const next=latestCamera.current[i];if(!next)return;page.current=next.page;currentView.current.page=next.page;setActive(i);setBox(next.box||null);setCorners(next.corners||null);setZoom(next.zoom||null);setHeld(null)};
 const closePage=owner=>trackCameraWork((async()=>{
  if(page.current===owner)ink.current?.finish();await Promise.all([...cameraWork.current]);await flushInkMutations(owner);
  const before=latestCamera.current,target=before.find(item=>item.page===owner);
  if(!target||before.length<2||(!target.hasPicture&&!target.picture&&before.filter(item=>!item.hasPicture&&!item.picture).length<2))return;
  const chosen=page.current,next=before.filter(item=>item.page!==owner);setPages(next);
  if(chosen===owner)selectPage(Math.min(before.indexOf(target),next.length-1));else setActive(next.findIndex(item=>item.page===chosen));
  if(target.picture)pictures.current.forget(target.picture);
  await ink.current?.release(owner);const actions=cameraActions.current.get(owner);if(actions){await actions.flush();actions.detach();cameraActions.current.delete(owner);cameraActionSet.current.delete(actions);}await owner.disposeAsync();
 })().catch(failure=>setError(failure.message)));
 const movePage=(fromId,toId)=>{const before=latestCamera.current,from=before.findIndex(item=>item.pageId===fromId),to=before.findIndex(item=>item.pageId===toId);if(from<0||to<0||from===to)return;const chosen=page.current,next=[...before];next.splice(to,0,...next.splice(from,1));setPages(next);setActive(next.findIndex(item=>item.page===chosen));};
 const [takeMode,setTakeMode]=useState('ink'),[showEditor,setShowEditor]=useState(!document.querySelector('main').hidden),[reader,setReader]=useState(false);
 useEffect(()=>{window.notemind.ocrAvailable?.().then(setReader);const observer=new MutationObserver(()=>setShowEditor(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>observer.disconnect()},[]);
 const aspect=pages[active]?.aspect||'free';const setAspect=value=>{setBox(null);setCorners(null);setZoom(null);const chosen=page.current;setPages(old=>old.map(item=>item.page===chosen?{...item,inkAspect:item.inkAspect??(item.aspect&&item.aspect!=='free'?Number(item.aspect):'free'),inkRotation:item.inkRotation??item.rotation??0,aspect:value}:item));};
 const device=pages[active]?.device||'';const setDevice=value=>setPages(old=>old.map((p,i)=>i===active?{...p,device:value}:p));

 useEffect(()=>{const receive=e=>{if(!cameraActive||!cameraLoaded||!!cameraLoadError||pageOpening)return;const d=e.detail;if(d.device!==undefined)setDevice(d.device);if(d.aspect)setAspect(d.aspect);if(d.refresh)setDeviceTick(x=>x+1);if(d.turn)rotate(d.turn==='left'?-90:90);if(d.keep)keep();};window.addEventListener('notemind-input',receive);return()=>window.removeEventListener('notemind-input',receive)});
 useEffect(()=>{window.dispatchEvent(new CustomEvent('notemind-camera-device',{detail:{devices,device}}))},[devices,device]);
 const rotation=pages[active]?.rotation || 0; const setRotation=value=>setPages(old=>old.map((p,i)=>i===active?{...p,rotation:typeof value==='function'?value(p.rotation||0):value}:p));

 const rawFrame=storedPicture?{width:storedPicture.width,height:storedPicture.height}:videoFrame,reference=cameraReference(rawFrame,{rotation,aspect,inkRotation:currentPage.inkRotation,inkAspect:currentPage.inkAspect}),upright=reference.upright,frame={width:reference.preview.width,height:reference.preview.height},crop={x:reference.preview.x,y:reference.preview.y};

 useEffect(()=>{if(cameraLoaded)localStorage.setItem('notemind.activeCamera',String(active));},[active,cameraLoaded]);

 const saveNow=({finish=true}={})=>{if(finish)ink.current?.finish();const work=[...cameraWork.current];const save=async()=>{await Promise.all(work);await globalThis.NoteMindInkMutations?.flushAllInkMutations?.();if(cameraStore.current)return cameraStore.current.save();const data=latestCamera.current.map(p=>({name:p.name,picture:p.picture?.source||null,strokes:p.page.strokes,inkRotation:p.inkRotation,inkAspect:p.inkAspect,rotation:p.rotation||0,device:p.device||'',aspect:p.aspect||'free',box:p.box||null,corners:p.corners||null,zoom:p.zoom||null}));return window.notemind.saveCameraPages(data);};cameraSaves.current=save();return cameraSaves.current;};

 useEffect(()=>{let cancelled=false;cameraPersistence.current={loaded:false,error:''};cameraLoad.current=(async()=>{try{if(window.notemind.listCameraPages&&window.notemind.loadCameraPage&&window.notemind.saveCameraPagesDelta){const controller=new CameraPersistence({api:window.notemind,models:latestCamera,makePage:()=>new TabletPage(1),getActive:()=>currentView.current?.active?currentView.current.page:null,pictures:pictures.current,onWarning:message=>{if(!cancelled)setError(message);}});cameraStore.current=controller;const restored=await controller.load();if(!cancelled){const index=Math.min(restored.length-1,Math.max(0,Number(localStorage.getItem('notemind.activeCamera'))||0));page.current=restored[index].page;setActive(index);setBox(restored[index].box||null);setCorners(restored[index].corners||null);setZoom(restored[index].zoom||null);}}else{const data=await window.notemind.loadCameraPages();if(data!=null){if(!validCameraPages(data))throw Error('The camera pages file has an invalid structure.');const restored=[];for(const item of data){const page=new TabletPage();await page.loadGeometryAsync(item.strokes,{valid:()=>!cancelled});restored.push({name:item.name||(item.picture?'Page':'Live'),picture:item.picture?pictureRef(item.picture):null,page,inkRotation:item.inkRotation??item.rotation??0,inkAspect:item.inkAspect??(item.aspect&&item.aspect!=='free'?Number(item.aspect):'free'),rotation:item.rotation||0,device:item.device||'',aspect:item.aspect||'free',box:item.box||null,corners:item.corners||null,zoom:item.zoom||null});}if(!cancelled){const index=Math.min(restored.length-1,Math.max(0,Number(localStorage.getItem('notemind.activeCamera'))||0));setPages(restored);setActive(index);setBox(restored[index].box||null);setCorners(restored[index].corners||null);setZoom(restored[index].zoom||null);}else for(const item of restored)await item.page.disposeAsync();}}}catch(e){if(!cancelled){const message='Camera pages could not be loaded; saving is disabled: '+(e.message||e);cameraPersistence.current.error=message;setCameraLoadError(message);}}if(!cancelled){cameraPersistence.current.loaded=true;setCameraLoaded(true);}})();return()=>{cancelled=true;cameraStore.current?.dispose();};},[]);

 useEffect(()=>{if(!cameraLoaded||!cameraActive||!pageOpening||!cameraStore.current)return;void cameraStore.current.ensure(currentPage.page).catch(failure=>{if(failure.name!=='AbortError')setError(failure.message);});},[cameraLoaded,cameraActive,currentPage.page,pageOpening]);

 useEffect(()=>{if(!cameraLoaded||cameraLoadError)return;cameraTimer.current=setTimeout(()=>{cameraTimer.current=null;saveNow({finish:false}).catch(e=>setError('Could not save camera pages: '+(e.message||e)));},500);return()=>{if(cameraTimer.current){clearTimeout(cameraTimer.current);cameraTimer.current=null;}};},[pages,revision,cameraLoaded,cameraLoadError]);

 useEffect(()=>{const flush=e=>{if(cameraTimer.current){clearTimeout(cameraTimer.current);cameraTimer.current=null;}e.detail.promises.push(cameraLoad.current.then(()=>{const state=cameraPersistence.current;if(!state.loaded||state.error)throw Error(state.error||'Camera pages could not be safely loaded.');return saveNow();}));};window.addEventListener('camera-flush',flush);return()=>window.removeEventListener('camera-flush',flush);},[cameraLoaded,cameraLoadError]);

 useEffect(()=>{const changed=()=>setDeviceTick(x=>x+1);navigator.mediaDevices?.addEventListener('devicechange',changed);return()=>navigator.mediaDevices?.removeEventListener('devicechange',changed);},[]);

 useEffect(()=>{let live=true;setReady(false);setError('');setHeld(null);const owned=media.current;
  if(!cameraActive||!cameraLoaded||!!cameraLoadError||hasPicture||pageOpening){owned.stop();return;}
  void owned.start({mediaDevices:navigator.mediaDevices,video:video.current,device,aspect,onReady:frame=>{if(live){setFrame(frame);setReady(true);}},onDevices:value=>{if(live)setDevices(value);}}).catch(e=>{if(live)setError(e.message||'Could not start the camera.');});
  return()=>{live=false;owned.stop();};
 },[device,cameraActive,cameraLoaded,cameraLoadError,hasPicture,pageOpening,aspect,deviceTick]);

 useLayoutEffect(()=>{if(!stage.current)return;let ro=new ResizeObserver(entries=>{let r=entries[0].contentRect;setSize({width:r.width,height:r.height});});ro.observe(stage.current);return()=>ro.disconnect()},[]);

 const factor=Math.min(size.width/frame.width,size.height/frame.height), shown={width:frame.width*factor,height:frame.height*factor,x:(size.width-frame.width*factor)/2,y:(size.height-frame.height*factor)/2};

 const view={size,shown,zoom},inkView=cameraInkView(reference,view);const magnification=zoom?zoomScale(zoom,size):1;const centre=zoom?{x:size.width/2+(size.width/2-(zoom.x+zoom.width/2)*size.width)*magnification,y:size.height/2+(size.height/2-(zoom.y+zoom.height/2)*size.height)*magnification}:{x:size.width/2,y:size.height/2};const onScreen=p=>inkToScreen(p,view);

 const snapshot=useCallback(()=>{
  if(!cameraActive||!cameraLoaded||cameraLoadError||pageOpening||page.current!==currentPage.page)return null;
  const source=held||still||video.current;if((!ready&&!still)||!source||hasPicture&&!still)return null;
  const c=document.createElement('canvas');c.width=Math.max(1,Math.floor(frame.width));c.height=Math.max(1,Math.floor(frame.height));
  if(c.width*c.height>16*1024*1024)throw Error('Camera picture dimensions are too large.');
  const ctx=c.getContext('2d'),sx=c.width/frame.width,sy=c.height/frame.height;
  const matrix=rotation===90?[0,1,-1,0,rawFrame.height,0]:rotation===180?[-1,0,0,-1,rawFrame.width,rawFrame.height]:rotation===270?[0,-1,1,0,0,rawFrame.width]:[1,0,0,1,0,0];
  ctx.setTransform(matrix[0]*sx,matrix[1]*sy,matrix[2]*sx,matrix[3]*sy,(matrix[4]-crop.x)*sx,(matrix[5]-crop.y)*sy);ctx.drawImage(source,0,0,rawFrame.width,rawFrame.height);ctx.resetTransform();return c;
 },[cameraActive,cameraLoaded,cameraLoadError,pageOpening,currentPage,ready,held,still,hasPicture,frame,rawFrame,rotation,crop]);
 const capturePicture=async({includeInk=true,selected=true,perspective=true,writing=false,holdInk=false}={})=>{
  if(captureBusy.current||keepingPage.current||!processor.current)return null;
  ink.current?.finish();const canvas=snapshot();if(!canvas)return null;
  const took=taken(),releaseLease=took.page.retainGeometry();let handedOff=false,released=false;const release=()=>{if(!released){released=true;releaseLease();}},view=cameraInkView(reference,{size:{width:canvas.width,height:canvas.height},shown:{x:0,y:0,width:canvas.width,height:canvas.height},zoom:null});
  captureBusy.current=true;setCapturing(true);
  try{const strokes=await took.strokes,blob=await processor.current.run(canvas,{strokes:includeInk?strokes:[],view,box:selected?took.box:null,corners:selected&&perspective?took.corners:null,writing,colour});const data=await pngBlobDataURL(blob);handedOff=holdInk;return {data,took:{...took,strokes},release};}
  finally{if(!handedOff)release();canvas.width=canvas.height=1;captureBusy.current=false;setCapturing(false);}
 };

 const taken=()=>({page:page.current,live:!hasPicture,box,corners,strokes:projectInkSnapshot(page.current,page.current.strokes)});
 const spend=async(took,withInk=true)=>{if(currentView.current.page===took.page){ink.current?.leave();setBox(value=>value===took.box?null:value);if(took.live)setCorners(value=>value===took.corners?null:value);}if(took.live&&withInk&&latestCamera.current.some(item=>item.page===took.page))await actionsFor(took.page).enqueue(async(_captured,current,options)=>{const next=await afterCameraCapture(await took.strokes,current,options);return next&&next!==current?{target:next,commit:changeOptions=>took.page.replaceAsync(next,changeOptions)}:null;},{capture:false});};
 const clearSelection=box=>{if(pageOpening||!cameraActive||!cameraLoaded||cameraLoadError)return;ink.current?.finish();const owner=page.current,region=selectionInInk(box,view,inkView);void actionsFor(owner).enqueue(async(_captured,current,options)=>{const next=await outsideCameraSelection(current,region,options);return next!==current?{target:next,commit:changeOptions=>owner.replaceAsync(next,changeOptions)}:null;},{capture:false}).catch(()=>{});};
 useEffect(()=>{const capture=e=>{if(!cameraActive)return;const pending=trackCameraWork(capturePicture().then(result=>{if(result)e.detail.pages.push({name:'Camera page',data:result.data});}));if(!Array.isArray(e.detail.promises))e.detail.promises=[];e.detail.promises.push(pending);};window.addEventListener('notes-scan-current',capture);return()=>window.removeEventListener('notes-scan-current',capture);},[snapshot,reference,box,corners,colour]);
 const insert=(mode='page')=>trackCameraWork((async()=>{
  const insertion=window.NoteMindNotes?.captureInsertion(),rescanTarget=rescan,rescanHandler=onRescan;
  const result=await capturePicture({includeInk:mode!=='raw',perspective:mode!=='raw',writing:mode==='writing'});if(!result)return;
  const {data,took}=result;
  if(rescanTarget){if(await rescanHandler(data,rescanTarget)!==false)await spend(took,mode!=='raw');return;}
  if(window.dispatchEvent(new CustomEvent('tablet-insert',{cancelable:true,detail:{name:`assets/camera-${crypto.randomUUID()}.png`,data:data.split(',')[1],insertion}}))){await spend(took,mode!=='raw');setToast(mode==='writing'?'Writing added':mode==='raw'?'Raw picture added':'Image added');}
 })().catch(failure=>{if(failure.name!=='AbortError')setError(failure.message);}));
 const readText=()=>trackCameraWork((async()=>{
  const insertion=window.NoteMindNotes?.captureInsertion(),result=await capturePicture({holdInk:true});if(!result)return;
  const detail={data:result.data.split(',')[1],insertion,claimed:false,onClose:result.release,onInsert:()=>{void trackCameraWork(spend(result.took).then(()=>setToast('Text added')).catch(failure=>setError(failure.message)));}};
  try{window.dispatchEvent(new CustomEvent('notemind-read-image',{detail}));}finally{if(!detail.claimed)result.release();}
 })().catch(failure=>{if(failure.name!=='AbortError')setError(failure.message);}));

 const find=(force=false)=>{if(corners&&!force){setCorners(null);return null;}const c=snapshot();if(!c)return null;const k=Math.min(1,960/Math.max(c.width,c.height)),w=Math.max(16,Math.round(c.width*k)),h=Math.max(16,Math.round(c.height*k)),small=document.createElement('canvas');small.width=w;small.height=h;const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,0,0,w,h);const found=findPage(ctx.getImageData(0,0,w,h).data,w,h);const next=found?Object.fromEntries(Object.entries(found.corners).map(([name,p])=>[name,{x:p.x/w,y:p.y/h}])):{topLeft:{x:.08,y:.08},topRight:{x:.92,y:.08},bottomRight:{x:.92,y:.92},bottomLeft:{x:.08,y:.92}};setBox(null);setCorners(next);setToast(found?'Page found · drag a corner if it is off':'No page found: drag the corners to the page');return next;};
 const bounds=quad=>{const pts=Object.values(quad),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}};
 const keep=()=>trackCameraWork((async()=>{
  if(keepingPage.current||captureBusy.current)return;
  ink.current?.finish();const source=held||video.current,owner=page.current;
  if(!cameraActive||!cameraLoaded||cameraLoadError||!ready||hasPicture||pageOpening||owner!==currentPage.page||!source)return;
  const captured=projectInkSnapshot(owner,owner.strokes),settings={device,aspect,rotation,inkRotation:currentPage.inkRotation??rotation,inkAspect:currentPage.inkAspect??(aspect==='free'?'free':Number(aspect)),box,corners,zoom},release=owner.retainGeometry();
  const canvas=document.createElement('canvas');canvas.width=rawFrame.width;canvas.height=rawFrame.height;canvas.getContext('2d').drawImage(source,0,0);
  keepingPage.current=true;setKeeping(true);let keptPage=null,published=false;
  try{
   const strokes=await captured,picture=await pictures.current.capture(canvas);keptPage=new TabletPage();await keptPage.loadGeometryAsync(strokes);
   const existing=latestCamera.current,from=existing.findIndex(item=>item.page===owner);if(from<0)return;
   keptPage.backdrop=picture.source;const kept={name:'Page '+(existing.filter(item=>item.hasPicture||item.picture).length+1),picture,hasPicture:true,page:keptPage,...settings},selected=page.current;
   setPages(old=>{const index=old.findIndex(item=>item.page===owner);if(index<0)return old;const next=[...old];next.splice(index,0,kept);setActive(next.findIndex(item=>item.page===selected));return next;});published=latestCamera.current.some(item=>item.page===keptPage);if(!published)return;
   await actionsFor(owner).enqueue(async(_captured,current,options)=>{const next=await afterCameraCapture(strokes,current,options);return next?{target:next,commit:changeOptions=>owner.replaceAsync(next,changeOptions)}:null;},{capture:false});
   setRevision(value=>value+1);
   if(page.current===owner){setBox(value=>value===settings.box?null:value);setCorners(value=>value===settings.corners?null:value);setHeld(value=>value===source?null:value);}
   setToast('Kept as '+kept.name);
  }catch(failure){if(failure.name!=='AbortError')setError(failure.message);}
  finally{canvas.width=canvas.height=1;release();if(keptPage&&!published)await keptPage.disposeAsync();keepingPage.current=false;setKeeping(false);}
 })());

 const rotate=by=>{if(pageOpening||!cameraLoaded||cameraLoadError)return;ink.current?.finish();const chosen=page.current;setPages(old=>old.map(item=>item.page===chosen?{...item,inkRotation:item.inkRotation??item.rotation??0,inkAspect:item.inkAspect??(item.aspect&&item.aspect!=='free'?Number(item.aspect):'free'),rotation:((item.rotation||0)+by+360)%360}:item));setBox(null);setCorners(null);setZoom(null);setRevision(x=>x+1)};

 const hold=()=>{if(still)return;if(held){setHeld(null);return;} if(!video.current||!ready)return; const c=document.createElement('canvas');c.width=rawFrame.width;c.height=rawFrame.height;c.getContext('2d').drawImage(video.current,0,0);setHeld(c);};

 useEffect(()=>{const h=e=>{if(!cameraActive||!cameraLoaded||cameraLoadError)return;if(e.detail==='newTab'){onActivate();ink.current?.finish();setPages(old=>[...old,{name:'Live '+(old.filter(p=>!p.picture).length+1),picture:null,page:new TabletPage(),device:''}]);setActive(pages.length);setBox(null);setCorners(null);setZoom(null);setHeld(null);return;}if(pageOpening)return;if(e.detail==='undo'||e.detail==='redo'){ink.current?.[e.detail]();setRevision(x=>x+1);}else if(e.detail==='clearSelection'){setBox(null);setCorners(null);}else if(e.detail==='deleteSelection'){if(box)clearSelection(box);}else if(e.detail==='nextSheet'||e.detail==='prevSheet'){selectPage((active+(e.detail==='nextSheet'?1:pages.length-1))%pages.length);}else if(e.detail==='clear'){ink.current?.clear();setRevision(x=>x+1);}else insert(e.detail);};window.addEventListener('camera-action',h);return()=>window.removeEventListener('camera-action',h);},[cameraActive,snapshot,box,pages.length]);

 const zoomBox=b=>setZoom({x:(shown.x+b.x*shown.width)/size.width,y:(shown.y+b.y*shown.height)/size.height,width:b.width*shown.width/size.width,height:b.height*shown.height/size.height});

 useEffect(()=>{const key=e=>{if(!cameraActive)return;if(e.key==='Escape'){setBox(null);setCorners(null);setZoomArmed(false);setZoom(null);setHeld(null);} };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[cameraActive]);

 const point=e=>{const at=elementPoint(stage.current,e),p=screenToInk({x:at.x,y:at.y},view);return {x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};};

 const selectStart=(e,allowPen=false)=>{if(cornerDrag.current || (start.current&&start.current.pointerId!==e.pointerId) || (e.pointerType==='pen'&&!allowPen&&!zoomArmed)||(!ready&&!still)||(e.button!==0&&!(e.pointerType==='pen'&&(allowPen||zoomArmed))&&!(e.pointerType==='mouse'&&e.button===2)))return;e.preventDefault();setCorners(null);const p=point(e);start.current={pointerId:e.pointerId,start:p,box,mode:zoomArmed?'new':selectionHit(box,p,{x:9/(shown.width*magnification),y:9/(shown.height*magnification)})};try{stage.current.setPointerCapture(e.pointerId)}catch{} if(start.current.mode==='new')setBox(null);};

 const selectMove=e=>{if(cornerDrag.current){if(cornerDrag.current.pointerId!==e.pointerId)return;const name=cornerDrag.current.name,q=point(e);setCorners(c=>c?{...c,[name]:q}:c);return;}if(!start.current||start.current.pointerId!==e.pointerId)return;setBox(selectionStep(start.current,point(e)));};

 const actionBox=box||(corners?(()=>{const p=Object.values(corners),xs=p.map(q=>q.x),ys=p.map(q=>q.y);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}})():null);
 const selectEnd=e=>{if(cornerDrag.current){if(cornerDrag.current.pointerId===e.pointerId)cornerDrag.current=null;return;}if(!start.current||start.current.pointerId!==e.pointerId)return;start.current=null;if(zoomArmed&&box&&box.width>.01&&box.height>.01){zoomBox(box);setZoomArmed(false);setBox(null);}else setBox(b=>b && b.width>0.01 && b.height>0.01?b:null);};

 return <div className="camera-workspace" hidden={!cameraActive} inert={!cameraLoaded||!!cameraLoadError||pageOpening} aria-busy={pageOpening}>{tabsTarget.map(target=>createPortal(<>{pages.map((item,i)=><SheetTab key={item.pageId} name={item.name} live={!item.hasPicture&&!item.picture} guarded={!!item.hasPicture||!!item.picture||!!item.page.strokes.length||!!item.strokeCount} selected={cameraActive&&i===active} onSelect={()=>{onActivate();selectPage(i)}} onRename={name=>setPages(old=>old.map(p=>p.pageId===item.pageId?{...p,name}:p))} onClose={pages.length>1&&(item.hasPicture||item.picture||pages.filter(p=>!p.hasPicture&&!p.picture).length>1)?()=>closePage(item.page):undefined} onDragStart={e=>e.dataTransfer.setData('application/x-notemind-camera',item.pageId)} onDrop={e=>movePage(e.dataTransfer.getData('application/x-notemind-camera'),item.pageId)}/>)}</>,target))}<PaneChrome slot="header" active={cameraActive}><CameraHeader fit={headerFit({width:size.width,zoomed:!!zoom,backToNotes:!showEditor})} pictured={ready||!!still} busy={capturing||keeping} turn={rotate} zoomed={!!zoom} zoomPercent={Math.round(100/magnification)} zooming={zoomArmed} onZoom={()=>setZoomArmed(true)} onOriginalSize={()=>{setZoom(null);setZoomArmed(false)}} holding={!!held} holdOff={!ready||!!still} holdTitle={held?'Resume live camera':'Hold the current frame'} onHold={hold} keep={ready&&!hasPicture?{title:'Keep Page: save this picture in a new tab for the next page',off:keeping?'Keeping page…':capturing?'Capturing…':null,onKeep:keep}:null} findPage={!!corners} onFindPage={()=>find()} onZoomToPage={()=>{const quad=find(true);if(quad)zoomBox(bounds(quad));}} canUndoInk={page.current.canUndo||hasPendingInkMutations(page.current)} canClearInk={!!page.current.strokes.length||hasPendingInkMutations(page.current)} onUndoInk={()=>{ink.current?.undo();setRevision(x=>x+1)}} onClearInk={()=>{ink.current?.clear();setRevision(x=>x+1)}} mode={takeMode} onTake={mode=>{setTakeMode(mode);insert(mode==='ink'?'writing':mode)}} onHide={onClose} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))} empty={!ready&&!still}/></PaneChrome><div ref={stage} className="camera-stage" data-pad-content onContextMenu={e=>e.preventDefault()} onPointerDown={e=>selectStart(e)} onPointerMove={selectMove} onPointerUp={selectEnd} onPointerCancel={selectEnd} onDoubleClick={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}>

 <div className="camera-view" style={{position:"absolute",overflow:"hidden",left:centre.x-shown.width*magnification/2,top:centre.y-shown.height*magnification/2,width:shown.width*magnification,height:shown.height*magnification}}><video ref={video} playsInline muted className="camera-video" style={{display:held||hasPicture?'none':'block',left:"50%",top:"50%",width:rawFrame.width*factor*magnification,height:rawFrame.height*factor*magnification,transform:`translate(-50%,-50%) rotate(${rotation}deg)`}} onLoadedMetadata={e=>setFrame({width:e.currentTarget.videoWidth||1,height:e.currentTarget.videoHeight||1})}/><canvas ref={pictureCanvas} role="img" aria-label="Camera page" className="camera-video" hidden={!held&&!still} style={{left:"50%",top:"50%",width:rawFrame.width*factor*magnification,height:rawFrame.height*factor*magnification,transform:`translate(-50%,-50%) rotate(${rotation}deg)`}}/>

 </div><CameraInk ref={ink} targetKey={'camera-'+currentPage.pageId} turns={rotation/90} page={page.current} view={inkView} on={cameraActive && cameraLoaded && !cameraLoadError && !pageOpening && (ready || !!still)} colour={colour} width={width} onEdited={()=>setRevision(x=>x+1)} onError={failure=>{if(failure.code==='NOTEMIND_INK_CAPACITY')setToast(failure.message);else setError(failure.message);}} onDrawing={setDrawing} zooming={zoomArmed} onPenSelect={e=>selectStart(e,true)} onPenCorner={e=>{if(!corners)return false;const p=point(e);const found=Object.entries(corners).find(([_,q])=>Math.hypot((p.x-q.x)*shown.width*magnification,(p.y-q.y)*shown.height*magnification)<12);if(!found)return false;if(start.current&&start.current.pointerId!==e.pointerId)return false;cornerDrag.current={name:found[0],pointerId:e.pointerId};return true;}}/>

 {corners&&<svg className="page-corners" viewBox={`0 0 ${size.width} ${size.height}`}><polygon points={['topLeft','topRight','bottomRight','bottomLeft'].map(k=>`${onScreen(corners[k]).x},${onScreen(corners[k]).y}`).join(' ')}/>{Object.entries(corners).map(([name,p])=><circle key={name} cx={onScreen(p).x} cy={onScreen(p).y} r="8" onPointerDown={e=>{e.stopPropagation();if(start.current&&start.current.pointerId!==e.pointerId)return;cornerDrag.current={name,pointerId:e.pointerId};try{stage.current.setPointerCapture(e.pointerId)}catch{}}}/>)}</svg>}{box&&<div className="camera-selection" style={{left:onScreen(box).x,top:onScreen(box).y,width:box.width*shown.width*magnification,height:box.height*shown.height*magnification}}>{['nw','ne','se','sw'].map(k=><i key={k} data-handle={k}/>)}</div>}{actionBox&&!drawing&&<CameraSelectionActions box={{x:onScreen(actionBox).x,y:onScreen(actionBox).y,width:actionBox.width*shown.width*magnification,height:actionBox.height*shown.height*magnification}} size={size} mode={takeMode} reader={reader} hasInk={!!page.current.strokes.length} writing={()=>{setTakeMode('ink');insert('writing')}} picture={()=>{setTakeMode('page');insert('page')}} text={readText} clear={()=>{setBox(null);setCorners(null)}} erase={()=>clearSelection(actionBox)}/>}{held&&<><div className="held-frame"/><span className="held-badge"><Icon name="pause" size={12}/>Held · Esc</span></>}{toast&&<div className="toast">{toast}</div>}{zoomArmed&&<div className="zoom-hint">Drag a box to zoom · Escape cancels</div>}{error&&!ready&&!still&&<div className="placeholder"><div className="title">No picture yet</div><div className="detail">{error}</div><div className="source-cards"><button className="source-card" title="Switch to a drawing sheet" onClick={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))}><Icon name="pen" size={24}/><span className="name">Tablet sheet</span><span className="sub">Write with the pen</span></button></div><div className="source-links"><button title="Refresh the available cameras" onClick={()=>setDeviceTick(x=>x+1)}>Refresh devices</button></div></div>}</div><PaneChrome slot="footer" active={cameraActive}><div className="tablet-footer camera-foot"><span className="line">{cameraLoadError||error||(pageOpening?'Opening page…':rescan?'Rescan: take the picture to replace the sheet background':!ready&&!still?'Starting the camera…':corners?'Page selected · drag a corner if it is off':still?pages[active].name+' · drag a box for a part, or take all of it':held?'Held still · drag a box for a part':'The pen writes on it · Find Page, or drag a box for a part')}</span><span className="fact">{ready||still?Math.round(frame.width)+'×'+Math.round(frame.height):''}</span></div></PaneChrome></div>;

}




function CameraSelectionActions({box,size,mode,reader,hasInk,writing,picture,text,clear,erase}){
 const row=useRef(null),[width,setWidth]=useState(0);useLayoutEffect(()=>{if(!row.current)return;const observer=new ResizeObserver(()=>setWidth(elementSize(row.current).width));observer.observe(row.current);return()=>observer.disconnect()},[]);
 return <div ref={row} className="box-choices box-actions" data-camera="box-actions" role="group" aria-label="The selection" style={{left:width+12>size.width?size.width/2:Math.min(Math.max(box.x+box.width/2,width/2+6),size.width-width/2-6),top:Math.min(box.y+box.height+22,Math.max(size.height-18,18))}} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()}><button data-box-action="ink" title="Insert the writing in this area into the Notepad" className={mode!=='page'?'primary':undefined} onClick={writing}>Writing</button><button data-box-action="picture" title="Insert this camera area into the Notepad as a picture" className={mode==='page'?'primary':undefined} onClick={picture}>Image</button><span className="sep"/><button className="danger" data-box-action="erase" title="Erase the camera ink inside the selection" disabled={!hasInk} onClick={erase}>Clear</button><button data-box-action="clear" aria-label="Clear the selection" title="Dismiss the selection (Esc)" onClick={clear}><Icon name="close" size={11}/></button></div>
}
