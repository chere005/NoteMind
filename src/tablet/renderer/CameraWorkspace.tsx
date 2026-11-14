import {CameraHeader} from './CameraHeader';
import {headerFit} from './cameraHeaderFit';
import {SheetTab} from './SheetTab';
import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';

import {createPortal} from 'react-dom';

import {validCameraPages} from './validateStorage';

import {CameraInk} from './CameraInk';

import {turnInk,inkToScreen,screenToInk} from './cameraInkGeometry';

import {zoomScale} from '../core';

import {TabletPage, paintStrokes} from './tabletPage';

import {BoxActions} from './BoxActions';

import {outsideSelection} from './selection';

import {selectionHit, selectionStep} from './selectionGesture';

import {MenuButton} from './MenuButton';

import {Icon} from './icons';

import {findPage} from './findPage';

import {liftedWriting} from './liftedWriting';

import {warpToPage,quadFromPixels} from './perspective';

import './cameraWorkspace.css';



export function CameraWorkspace({rescan,onRescan,colour, width, onClose, onActivate, tabsTarget, active: cameraActive}) {

 const video=useRef(null), stage=useRef(null), ink=useRef(null), page=useRef(new TabletPage()), stream=useRef(null), start=useRef(null), cornerDrag=useRef(null);

 const [pages,setPages]=useState(()=>[{name:'Live',picture:null,page:page.current,device:''}]),[active,setActive]=useState(0),[cameraLoaded,setCameraLoaded]=useState(false),[cameraLoadError,setCameraLoadError]=useState('');const cameraSaves=useRef(Promise.resolve()),cameraTimer=useRef(null),latestCamera=useRef(null);  page.current=pages[active]?.page||pages[0].page; const still=pages[active]?.picture||null;

 const [toast,setToast]=useState(''),[devices,setDevices]=useState([]),[error,setError]=useState(''),[ready,setReady]=useState(false),[deviceTick,setDeviceTick]=useState(0),[held,setHeld]=useState(null),[box,setBox]=useState(null),[corners,setCorners]=useState(null),[zoom,setZoom]=useState(null),[zoomArmed,setZoomArmed]=useState(false),[drawing,setDrawing]=useState(false),[size,setSize]=useState({width:1,height:1}),[videoFrame,setFrame]=useState({width:1,height:1}),[revision,setRevision]=useState(0);

 const currentView=useRef(null);currentView.current={page:page.current,box,corners};
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer)},[toast]);
 useEffect(()=>{const entry=pages[active];if(entry){entry.box=box;entry.corners=corners;entry.zoom=zoom}},[box,corners,zoom,active]);
 const selectPage=i=>{ink.current?.finish();const next=pages[i];setActive(i);setBox(next?.box||null);setCorners(next?.corners||null);setZoom(next?.zoom||null);setHeld(null)};
 const [takeMode,setTakeMode]=useState('ink'),[showEditor,setShowEditor]=useState(!document.querySelector('main').hidden),[reader,setReader]=useState(false);
 useEffect(()=>{window.notemind.ocrAvailable?.().then(setReader);const observer=new MutationObserver(()=>setShowEditor(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>observer.disconnect()},[]);
 const aspect=pages[active]?.aspect||'free';const setAspect=value=>{setBox(null);setCorners(null);setZoom(null);setPages(old=>old.map((p,i)=>i===active?{...p,aspect:value}:p));};
 const device=pages[active]?.device||'';const setDevice=value=>setPages(old=>old.map((p,i)=>i===active?{...p,device:value}:p));

 useEffect(()=>{const receive=e=>{const d=e.detail;if(d.device!==undefined)setDevice(d.device);if(d.aspect)setAspect(d.aspect);if(d.refresh)setDeviceTick(x=>x+1);if(d.turn)rotate(d.turn==='left'?-90:90);if(d.keep)keep();};window.addEventListener('notemind-input',receive);return()=>window.removeEventListener('notemind-input',receive)});
 useEffect(()=>{window.dispatchEvent(new CustomEvent('notemind-camera-device',{detail:{devices,device}}))},[devices,device]);
 const rotation=pages[active]?.rotation || 0; const setRotation=value=>setPages(old=>old.map((p,i)=>i===active?{...p,rotation:typeof value==='function'?value(p.rotation||0):value}:p));

 const rawFrame=still?{width:still.width,height:still.height}:videoFrame, upright=rotation%180?{width:rawFrame.height,height:rawFrame.width}:rawFrame;const ratio=aspect==='free'?upright.width/upright.height:Number(aspect),frame={width:Math.min(upright.width,upright.height*ratio),height:Math.min(upright.height,upright.width/ratio)},crop={x:(upright.width-frame.width)/2,y:(upright.height-frame.height)/2};

 useEffect(()=>{if(cameraLoaded)localStorage.setItem('notemind.activeCamera',String(active));},[active,cameraLoaded]);
 latestCamera.current=pages;

 const saveNow=()=>{const data=latestCamera.current.map(p=>({name:p.name,picture:p.picture?p.picture.toDataURL('image/png'):null,strokes:p.page.strokes,rotation:p.rotation||0,device:p.device||'',aspect:p.aspect||'free',box:p.box||null,corners:p.corners||null,zoom:p.zoom||null}));cameraSaves.current=cameraSaves.current.catch(()=>{}).then(()=>window.notemind.saveCameraPages(data));return cameraSaves.current;};

 useEffect(()=>{let cancelled=false;(async()=>{try{const data=await window.notemind.loadCameraPages();if(data!=null){if(!validCameraPages(data))throw Error('The camera pages file has an invalid structure.');const restored=await Promise.all(data.map(async item=>{const page=new TabletPage();page.strokes=Array.isArray(item.strokes)?item.strokes:[];if(!item.picture)return {name:item.name||'Live',picture:null,page,rotation:item.rotation||0,device:item.device||'',aspect:item.aspect||'free',box:item.box||null,corners:item.corners||null,zoom:item.zoom||null};const image=new Image();image.src=item.picture;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);return {name:item.name||'Page',picture:c,page,rotation:item.rotation||0,device:item.device||'',aspect:item.aspect||'free',box:item.box||null,corners:item.corners||null,zoom:item.zoom||null};}));if(!cancelled){const index=Math.min(restored.length-1,Math.max(0,Number(localStorage.getItem('notemind.activeCamera'))||0));setPages(restored);setActive(index);setBox(restored[index].box||null);setCorners(restored[index].corners||null);setZoom(restored[index].zoom||null);}}}catch(e){if(!cancelled)setCameraLoadError('Camera pages could not be loaded; saving is disabled: '+(e.message||e));}if(!cancelled)setCameraLoaded(true);})();return()=>{cancelled=true;};},[]);

 useEffect(()=>{if(!cameraLoaded||cameraLoadError)return;cameraTimer.current=setTimeout(()=>{cameraTimer.current=null;saveNow().catch(e=>setError('Could not save camera pages: '+(e.message||e)));},500);return()=>{if(cameraTimer.current){clearTimeout(cameraTimer.current);cameraTimer.current=null;}};},[pages,revision,cameraLoaded,cameraLoadError]);

 useEffect(()=>{const flush=e=>{if(cameraTimer.current){clearTimeout(cameraTimer.current);cameraTimer.current=null;}if(!cameraLoaded||cameraLoadError){e.detail.promises.push(Promise.reject(Error(cameraLoadError||'Camera pages are loading.')));return;}e.detail.promises.push(saveNow());};window.addEventListener('camera-flush',flush);return()=>window.removeEventListener('camera-flush',flush);},[cameraLoaded,cameraLoadError]);

 useEffect(()=>{const changed=()=>setDeviceTick(x=>x+1);navigator.mediaDevices?.addEventListener('devicechange',changed);return()=>navigator.mediaDevices?.removeEventListener('devicechange',changed);},[]);

 const stop=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};

 useEffect(()=>{let live=true;setReady(false);setError('');setHeld(null);if(!cameraActive||!cameraLoaded||still){stop();return;} if(!navigator.mediaDevices?.getUserMedia){setError('Camera access is unavailable.');return;}

  navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30},...(device?{deviceId:{exact:device}}:{}),...(aspect!=='free'?{aspectRatio:{ideal:Number(aspect)}}:{})},audio:false}).then(async s=>{if(!live){s.getTracks().forEach(t=>t.stop());return;}stream.current=s;video.current.srcObject=s;await video.current.play();if(!live)return;setFrame({width:video.current.videoWidth,height:video.current.videoHeight});setReady(true);const found=await navigator.mediaDevices.enumerateDevices();if(live)setDevices(found.filter(d=>d.kind==='videoinput'));}).catch(e=>{if(live)setError(e.message||'Could not start the camera.');});return()=>{live=false;stop()};},[device,cameraActive,cameraLoaded,still,aspect,deviceTick]);

 useLayoutEffect(()=>{if(!stage.current)return;let ro=new ResizeObserver(entries=>{let r=entries[0].contentRect;setSize({width:r.width,height:r.height});});ro.observe(stage.current);return()=>ro.disconnect()},[]);

 const factor=Math.min(size.width/frame.width,size.height/frame.height), shown={width:frame.width*factor,height:frame.height*factor,x:(size.width-frame.width*factor)/2,y:(size.height-frame.height*factor)/2};

 const view={size,shown,zoom};const magnification=zoom?zoomScale(zoom,size):1;const centre=zoom?{x:size.width/2+(size.width/2-(zoom.x+zoom.width/2)*size.width)*magnification,y:size.height/2+(size.height/2-(zoom.y+zoom.height/2)*size.height)*magnification}:{x:size.width/2,y:size.height/2};const onScreen=p=>inkToScreen(p,view);

 const snapshot=useCallback((selected=true,includeInk=true,allowPerspective=true)=>{const source=held||still||video.current;if((!ready&&!still)||!source)return null;const c=document.createElement('canvas');c.width=frame.width;c.height=frame.height;const ctx=c.getContext('2d');ctx.save();if(rotation===90)ctx.setTransform(0,1,-1,0,rawFrame.height,0);else if(rotation===180)ctx.setTransform(-1,0,0,-1,rawFrame.width,rawFrame.height);else if(rotation===270)ctx.setTransform(0,-1,1,0,0,rawFrame.width);ctx.drawImage(source,0,0,rawFrame.width,rawFrame.height);ctx.restore();const full=document.createElement('canvas');full.width=upright.width;full.height=upright.height;const fc=full.getContext('2d');fc.save();if(rotation===90)fc.setTransform(0,1,-1,0,rawFrame.height,0);else if(rotation===180)fc.setTransform(-1,0,0,-1,rawFrame.width,rawFrame.height);else if(rotation===270)fc.setTransform(0,-1,1,0,0,rawFrame.width);fc.drawImage(source,0,0,rawFrame.width,rawFrame.height);fc.restore();ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(full,crop.x,crop.y,frame.width,frame.height,0,0,c.width,c.height);if(includeInk)paintStrokes(ctx,page.current.strokes,p=>({x:p.x*c.width,y:p.y*c.height}),Math.max(c.width,c.height)/1000);if(selected&&corners&&allowPerspective){const cc=Object.fromEntries(Object.entries(corners).map(([name,p])=>[name,{x:p.x*c.width,y:p.y*c.height}]));const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y), rw=Math.max(1,Math.round((dist(cc.topLeft,cc.topRight)+dist(cc.bottomLeft,cc.bottomRight))/2)),rh=Math.max(1,Math.round((dist(cc.topLeft,cc.bottomLeft)+dist(cc.topRight,cc.bottomRight))/2)),scale=Math.min(1,1600/Math.max(rw,rh)),w=Math.max(1,Math.round(rw*scale)),h=Math.max(1,Math.round(rh*scale)),out=document.createElement('canvas');out.width=w;out.height=h;out.getContext('2d').putImageData(new ImageData(warpToPage(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,quadFromPixels(cc,c.height),{width:w,height:h}),w,h),0,0);return out;}if(selected&&box){let crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(box.width*c.width));crop.height=Math.max(1,Math.round(box.height*c.height));crop.getContext('2d').drawImage(c,box.x*c.width,box.y*c.height,box.width*c.width,box.height*c.height,0,0,crop.width,crop.height);return crop;}return c;},[ready,held,still,frame,rawFrame,rotation,box,corners,revision,active]);

 const taken=()=>({page:page.current,live:!still,box,corners,strokes:new Set(page.current.strokes)});
 const spend=(took,withInk=true)=>{if(currentView.current.page===took.page){ink.current?.leave();setBox(value=>value===took.box?null:value);if(took.live)setCorners(value=>value===took.corners?null:value);}if(took.live&&withInk){const left=took.page.strokes.filter(s=>!took.strokes.has(s));if(left.length!==took.page.strokes.length)took.page.replace(left);setRevision(x=>x+1);}};
 useEffect(()=>{const capture=e=>{ink.current?.finish();const picture=snapshot();if(picture)e.detail.pages.push({name:'Camera page',data:picture.toDataURL('image/png')});};window.addEventListener('notes-scan-current',capture);return()=>window.removeEventListener('notes-scan-current',capture);},[snapshot]);
 const insert=(mode='page')=>{ink.current?.finish();const c=snapshot(true,mode!=='raw',mode!=='raw');if(!c)return;const took=taken();if(rescan){onRescan(c.toDataURL('image/png'));spend(took,mode!=='raw');return;}if(mode==='writing'){const ctx=c.getContext('2d',{willReadFrequently:true}),pixels=ctx.getImageData(0,0,c.width,c.height),out=liftedWriting(pixels.data,c.width,c.height,colour);ctx.putImageData(new ImageData(out,c.width,c.height),0,0);}const data=c.toDataURL('image/png').split(',')[1];if(window.dispatchEvent(new CustomEvent('tablet-insert',{cancelable:true,detail:{name:`assets/camera-${Date.now()}.png`,data}}))){spend(took,mode!=='raw');setToast(mode==='writing'?'Writing added':mode==='raw'?'Raw picture added':'Image added');}};
 const readText=()=>{ink.current?.finish();const c=snapshot();if(!c)return;const took=taken();window.dispatchEvent(new CustomEvent('notemind-read-image',{detail:{data:c.toDataURL('image/png').split(',')[1],onInsert:()=>{spend(took);setToast('Text added');}}}));};
 const find=(force=false)=>{if(corners&&!force){setCorners(null);return null;}const c=snapshot(false,false);if(!c)return null;const k=Math.min(1,960/Math.max(c.width,c.height)),w=Math.max(16,Math.round(c.width*k)),h=Math.max(16,Math.round(c.height*k)),small=document.createElement('canvas');small.width=w;small.height=h;const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,0,0,w,h);const found=findPage(ctx.getImageData(0,0,w,h).data,w,h);const next=found?Object.fromEntries(Object.entries(found.corners).map(([name,p])=>[name,{x:p.x/w,y:p.y/h}])):{topLeft:{x:.08,y:.08},topRight:{x:.92,y:.08},bottomRight:{x:.92,y:.92},bottomLeft:{x:.08,y:.92}};setBox(null);setCorners(next);setToast(found?'Page found · drag a corner if it is off':'No page found: drag the corners to the page');return next;};
 const bounds=quad=>{const pts=Object.values(quad),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}};
 const keep=()=>{ink.current?.finish();const source=held||video.current;if(!ready||still||!source)return;const picture=document.createElement('canvas');picture.width=rawFrame.width;picture.height=rawFrame.height;picture.getContext('2d').drawImage(source,0,0);const keptPage=new TabletPage();keptPage.strokes=[...page.current.strokes];const kept={name:'Page '+(pages.filter(p=>p.picture).length+1),picture,page:keptPage,device,aspect,rotation,box,corners,zoom};setPages(old=>{const next=[...old];next.splice(active,0,kept);return next});setActive(active+1);page.current.clear();setRevision(x=>x+1);setBox(null);setCorners(null);setHeld(null);setToast('Kept as '+kept.name+': ready for the next page');};

 const rotate=by=>{ink.current?.finish();page.current.replace(turnInk(page.current.strokes,by));setRotation(r=>(r+by+360)%360);setBox(null);setCorners(null);setZoom(null);setRevision(x=>x+1)};

 const hold=()=>{if(still)return;if(held){setHeld(null);return;} if(!video.current||!ready)return; const c=document.createElement('canvas');c.width=rawFrame.width;c.height=rawFrame.height;c.getContext('2d').drawImage(video.current,0,0);setHeld(c);};

 useEffect(()=>{const h=e=>{if(!cameraActive)return;if(e.detail==='newTab'){onActivate();ink.current?.finish();setPages(old=>[...old,{name:'Live '+(old.filter(p=>!p.picture).length+1),picture:null,page:new TabletPage(),device:''}]);setActive(pages.length);setBox(null);setCorners(null);setZoom(null);setHeld(null);return;}if(e.detail==='undo'||e.detail==='redo'){ink.current?.[e.detail]();setRevision(x=>x+1);}else if(e.detail==='clearSelection'){setBox(null);setCorners(null);}else if(e.detail==='deleteSelection'){if(box){page.current.replace(outsideSelection(page.current.strokes,box));setRevision(x=>x+1);}}else if(e.detail==='nextSheet'||e.detail==='prevSheet'){selectPage((active+(e.detail==='nextSheet'?1:pages.length-1))%pages.length);}else if(e.detail==='clear'){ink.current?.clear();setRevision(x=>x+1);}else insert(e.detail);};window.addEventListener('camera-action',h);return()=>window.removeEventListener('camera-action',h);},[cameraActive,snapshot,box,pages.length]);

 const zoomBox=b=>setZoom({x:(shown.x+b.x*shown.width)/size.width,y:(shown.y+b.y*shown.height)/size.height,width:b.width*shown.width/size.width,height:b.height*shown.height/size.height});

 useEffect(()=>{const key=e=>{if(!cameraActive)return;if(e.key==='Escape'){setBox(null);setCorners(null);setZoomArmed(false);setZoom(null);setHeld(null);} };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[cameraActive]);

 const point=e=>{const r=stage.current.getBoundingClientRect(),p=screenToInk({x:e.clientX-r.left,y:e.clientY-r.top},view);return {x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};};

 const selectStart=(e,allowPen=false)=>{if(cornerDrag.current || (start.current&&start.current.pointerId!==e.pointerId) || (e.pointerType==='pen'&&!allowPen&&!zoomArmed)||(!ready&&!still)||e.button!==0)return;setCorners(null);const p=point(e);start.current={pointerId:e.pointerId,start:p,box,mode:zoomArmed?'new':selectionHit(box,p,{x:9/(shown.width*magnification),y:9/(shown.height*magnification)})};try{stage.current.setPointerCapture(e.pointerId)}catch{} if(start.current.mode==='new')setBox(null);};

 const selectMove=e=>{if(cornerDrag.current){if(cornerDrag.current.pointerId!==e.pointerId)return;const name=cornerDrag.current.name,q=point(e);setCorners(c=>c?{...c,[name]:q}:c);return;}if(!start.current||start.current.pointerId!==e.pointerId)return;setBox(selectionStep(start.current,point(e)));};

 const actionBox=box||(corners?(()=>{const p=Object.values(corners),xs=p.map(q=>q.x),ys=p.map(q=>q.y);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}})():null);
 const selectEnd=e=>{if(cornerDrag.current){if(cornerDrag.current.pointerId===e.pointerId)cornerDrag.current=null;return;}if(!start.current||start.current.pointerId!==e.pointerId)return;start.current=null;if(zoomArmed&&box&&box.width>.01&&box.height>.01){zoomBox(box);setZoomArmed(false);setBox(null);}else setBox(b=>b && b.width>0.01 && b.height>0.01?b:null);};

 return <div className="camera-workspace" hidden={!cameraActive} inert={!cameraLoaded}>{tabsTarget&&createPortal(<>{pages.map((item,i)=><SheetTab key={i} name={item.name} live={!item.picture} guarded={!!item.picture||!!item.page.strokes.length} selected={cameraActive&&i===active} onSelect={()=>{onActivate();selectPage(i)}} onRename={name=>setPages(old=>old.map((p,j)=>i===j?{...p,name}:p))} onClose={pages.length>1&&(!!item.picture||pages.filter(p=>!p.picture).length>1)?()=>{setPages(p=>p.filter((_,j)=>j!==i));setActive(a=>a===i?0:a>i?a-1:a);setBox(null)}:undefined} onDragStart={e=>e.dataTransfer.setData('application/x-notemind-camera',String(i))} onDrop={e=>{const raw=e.dataTransfer.getData('application/x-notemind-camera');if(!raw)return;const from=Number(raw),selected=pages[active],next=[...pages];next.splice(i,0,...next.splice(from,1));setPages(next);setActive(next.indexOf(selected));}}/>)}</>,tabsTarget)}<CameraHeader fit={headerFit({width:size.width,zoomed:!!zoom,backToNotes:!showEditor})} pictured={ready||!!still} busy={false} turn={rotate} zoomed={!!zoom} zoomPercent={Math.round(100/magnification)} zooming={zoomArmed} onZoom={()=>setZoomArmed(true)} onOriginalSize={()=>{setZoom(null);setZoomArmed(false)}} holding={!!held} holdOff={!ready||!!still} holdTitle={held?'Resume live camera':'Hold the current frame'} onHold={hold} keep={ready&&!still?{title:'Keep Page: save this picture in a new tab for the next page',off:null,onKeep:keep}:null} findPage={!!corners} onFindPage={()=>find()} onZoomToPage={()=>{const quad=find(true);if(quad)zoomBox(bounds(quad));}} canUndoInk={page.current.canUndo} canClearInk={!!page.current.strokes.length} onUndoInk={()=>{ink.current?.undo();setRevision(x=>x+1)}} onClearInk={()=>{ink.current?.clear();setRevision(x=>x+1)}} mode={takeMode} onTake={mode=>{setTakeMode(mode);insert(mode==='ink'?'writing':mode)}} onHide={onClose} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))} empty={!ready&&!still}/><div ref={stage} className="camera-stage" onPointerDown={e=>selectStart(e)} onPointerMove={selectMove} onPointerUp={selectEnd} onPointerCancel={selectEnd} onDoubleClick={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}>

 <div className="camera-view" style={{position:"absolute",overflow:"hidden",left:centre.x-shown.width*magnification/2,top:centre.y-shown.height*magnification/2,width:shown.width*magnification,height:shown.height*magnification}}><video ref={video} playsInline muted className="camera-video" style={{display:held||still?'none':'block',left:"50%",top:"50%",width:rawFrame.width*factor*magnification,height:rawFrame.height*factor*magnification,transform:`translate(-50%,-50%) rotate(${rotation}deg)`}} onLoadedMetadata={e=>setFrame({width:e.currentTarget.videoWidth||1,height:e.currentTarget.videoHeight||1})}/>{held&&<img alt="Camera page" className="camera-video" style={{left:"50%",top:"50%",width:rawFrame.width*factor*magnification,height:rawFrame.height*factor*magnification,transform:`translate(-50%,-50%) rotate(${rotation}deg)`}} src={(held||still).toDataURL('image/png')}/>}

 </div><CameraInk ref={ink} targetKey={'camera-'+active} turns={rotation/90} page={page.current} view={view} on={cameraActive && (ready || !!still)} colour={colour} width={width} onEdited={()=>setRevision(x=>x+1)} onDrawing={setDrawing} zooming={zoomArmed} onPenSelect={e=>selectStart(e,true)} onPenCorner={e=>{if(!corners)return false;const p=point(e);const found=Object.entries(corners).find(([_,q])=>Math.hypot((p.x-q.x)*shown.width*magnification,(p.y-q.y)*shown.height*magnification)<12);if(!found)return false;if(start.current&&start.current.pointerId!==e.pointerId)return false;cornerDrag.current={name:found[0],pointerId:e.pointerId};return true;}}/>

 {corners&&<svg className="page-corners" viewBox={`0 0 ${size.width} ${size.height}`}><polygon points={['topLeft','topRight','bottomRight','bottomLeft'].map(k=>`${onScreen(corners[k]).x},${onScreen(corners[k]).y}`).join(' ')}/>{Object.entries(corners).map(([name,p])=><circle key={name} cx={onScreen(p).x} cy={onScreen(p).y} r="8" onPointerDown={e=>{e.stopPropagation();if(start.current&&start.current.pointerId!==e.pointerId)return;cornerDrag.current={name,pointerId:e.pointerId};try{stage.current.setPointerCapture(e.pointerId)}catch{}}}/>)}</svg>}{box&&<div className="camera-selection" style={{left:onScreen(box).x,top:onScreen(box).y,width:box.width*shown.width*magnification,height:box.height*shown.height*magnification}}>{['nw','ne','se','sw'].map(k=><i key={k} data-handle={k}/>)}</div>}{actionBox&&!drawing&&<CameraSelectionActions box={{x:onScreen(actionBox).x,y:onScreen(actionBox).y,width:actionBox.width*shown.width*magnification,height:actionBox.height*shown.height*magnification}} size={size} mode={takeMode} reader={reader} hasInk={!!page.current.strokes.length} writing={()=>{setTakeMode('ink');insert('writing')}} picture={()=>{setTakeMode('page');insert('page')}} text={readText} clear={()=>{setBox(null);setCorners(null)}} erase={()=>{page.current.replace(outsideSelection(page.current.strokes,actionBox));setRevision(x=>x+1)}}/>}{held&&<><div className="held-frame"/><span className="held-badge"><Icon name="pause" size={12}/>Held · Esc</span></>}{toast&&<div className="toast">{toast}</div>}{zoomArmed&&<div className="zoom-hint">Drag a box to zoom · Escape cancels</div>}{error&&<div className="placeholder"><div className="title">No picture yet</div><div className="detail">{error}</div><div className="source-cards"><button className="source-card" onClick={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))}><Icon name="pen" size={24}/><span className="name">Tablet sheet</span><span className="sub">Write with the pen</span></button></div><div className="source-links"><button onClick={()=>setDeviceTick(x=>x+1)}>Refresh devices</button></div></div>}</div><div className="tablet-footer camera-foot"><span className="line">{cameraLoadError||(rescan?'Rescan: take the picture to replace the sheet background':!ready&&!still?'Starting the camera…':corners?'Page selected · drag a corner if it is off':still?pages[active].name+' · drag a box for a part, or take all of it':held?'Held still · drag a box for a part':'The pen writes on it · Find Page, or drag a box for a part')}</span><span className="fact">{ready||still?Math.round(frame.width)+'×'+Math.round(frame.height):''}</span></div></div>;

}




function CameraSelectionActions({box,size,mode,reader,hasInk,writing,picture,text,clear,erase}){
 const row=useRef(null),[width,setWidth]=useState(0);useLayoutEffect(()=>{if(!row.current)return;const observer=new ResizeObserver(()=>setWidth(row.current.getBoundingClientRect().width));observer.observe(row.current);return()=>observer.disconnect()},[]);
 return <div ref={row} className="box-choices box-actions" data-camera="box-actions" role="group" aria-label="The selection" style={{left:width+12>size.width?size.width/2:Math.min(Math.max(box.x+box.width/2,width/2+6),size.width-width/2-6),top:Math.min(box.y+box.height+22,Math.max(size.height-18,18))}} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()}><button data-box-action="ink" className={mode!=='page'?'primary':undefined} onClick={writing}>Writing</button><button data-box-action="picture" className={mode==='page'?'primary':undefined} onClick={picture}>Image</button><span className="sep"/><button className="danger" data-box-action="erase" disabled={!hasInk} onClick={erase}>Clear</button><button data-box-action="clear" aria-label="Clear the selection" onClick={clear}><Icon name="close" size={11}/></button></div>
}
