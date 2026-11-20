import {copyInk,pasteInk} from './drawing-clipboard.cjs';
import {DRAWING_ZOOM as drawingZoomLevels} from './precision-view.cjs';
import {confirmCloseWrite,SheetActions,syncClosePaper,closeFlushState,watchCloseChanges,flushToQuiescence} from './close-flush-drain.js';
import {PageModels} from './camera-models.js';
import {PreviewDocuments} from './preview-documents.js';
import {PDFReferenceViews} from './pdf-reference-views.cjs';
import {applyCameraRescan} from './camera-rescan.js';
import './tablet/renderer/scanPages';
import {DocumentWorkspace} from './tablet/renderer/DocumentWorkspace';
import {PageOverview} from './tablet/renderer/PageOverview';
import {captureTabKey} from './tablet/renderer/captureTabKey.cjs';
import {restoreOverviewFocus} from './tablet/renderer/overviewFocus.cjs';
import {OverviewIntent} from './tablet/renderer/overviewIntent.cjs';
import {usePageOverview} from './tablet/renderer/usePageOverview';
import {cameraSnapshot} from './camera-persistence.js';
import {PDFReferenceWorkspace} from './tablet/renderer/PDFReferenceWorkspace';
import {PadHost} from './tablet/renderer/PadHost';
import {DrawingStage} from './tablet/renderer/DrawingStage';
import {DEFAULT_WACOM_SIZE,type DrawingDisplay} from './tablet/shared/layout';
import {PaneChrome} from './tablet/renderer/PaneChrome';
import {A5_ASPECT} from './tablet/renderer/padOrientation';
import {VideoControl} from './tablet/renderer/VideoControl';
import {ShellChrome} from './tablet/renderer/ShellChrome';
import React, {useEffect, useRef, useState,useSyncExternalStore} from 'react';

import graphics from './graphics-pane.js';
import {SheetSaveQueue} from './sheet-save-queue.js';
import {snapshotDrawing, drawingDisplayWidth, writingRegion, rasterDrawing, svgDrawing, denseDrawing, pngDrawingSvg, canvasPng} from './tablet/renderer/drawingSnapshot';
import {sheetSignature as signatureOf, prepareSheetSignature, bindSheetSignaturePage, savedSignatureAsync, primeStrokeFingerprintsAsync, primeBackdropFingerprint, primeSheetSource, isHydratedSheet} from './tablet/renderer/sheetSignature';
import {exportDrawingAssets} from './drawing-export.js';
import {saveDrawingPane,bindDrawingSaveChunks} from './drawing-save-upload.js';
import {projectInkSnapshot,flushInkMutations,flushAllInkMutations,beginInkMutation,hasPendingInkMutations,subscribeInkMutations} from './ink-mutations.js';
import {includeInk} from './tablet/renderer/sheetViewport';
import {hydrateSheetState,mergeRecoveredSheets} from './hydrate-sheet-state.js';
import {loadSheetState,pullSheetState} from './load-sheet-state.js';
import {SheetLazyLoader} from './sheet-lazy-loader.js';
import {SheetModelCache} from './sheet-model-cache.js';
import {TabletHeader,TabletOptions} from './tablet/renderer/CameraHeader';
import {PenControl} from './tablet/renderer/PenControl';
import {useToolPresets} from './tablet/renderer/useToolPresets';
import {SheetTab} from './tablet/renderer/SheetTab';
import './tablet/renderer/camera.css';
import './tablet/renderer/toolbar.css';
import {createRoot} from 'react-dom/client';

import {TabletSurface} from './tablet/renderer/TabletSurface';

import {TabletPage, paintStrokes, screenAspect} from './tablet/renderer/tabletPage';

import {paper, paintPaper, inkOn, usePaper, setPaper} from './tablet/renderer/tabletPaper';

import {CameraWorkspace,createCameraSession} from './tablet/renderer/CameraWorkspace';

import {outsideSelection} from './tablet/renderer/selection';

import {validSheets,validSheetsAsync} from './tablet/renderer/validateStorage';

import {usePenFeed} from './tablet/renderer/usePenFeed';

import {installPenGate} from './tablet/renderer/penGate';

import {PaperMenu} from './tablet/renderer/PaperMenu';


import {MenuButton} from './tablet/renderer/MenuButton';

import {Icon} from './tablet/renderer/icons';

import {PenSheet} from './tablet/renderer/PenMenu';

import {useOrientation, tabletAspect} from './tablet/renderer/orientation';

import {backdropReady, paintBackdrop} from './tablet/renderer/tabletBackdrop';

import {installPenActions, registerPenHandlers, runPenAction} from './tablet/renderer/penActions';

import {setSheetEraser, setSheetSelect, watchPen} from './tablet/renderer/penSettings';
import {watchLive} from './tablet/renderer/penLive';

import './tablet/renderer/bars.css';

import './tablet/renderer/pane.css';

installPenGate();

watchPen();

watchLive();

installPenActions();

const sheetSignature=s=>s.loaded===false?(s.name===s.lazyMetadata?.name&&JSON.stringify(s.paper)===JSON.stringify(s.lazyMetadata?.paper)?s.lazySignature:'pending:'+JSON.stringify([s.name,s.paper])):signatureOf(s,paper());
const importedAspectIsFixed=(item,strokeCount)=>item.fixedAspect===true||(item.fixedAspect==null&&strokeCount>0);
function App(){
 const [drawingZoom,setDrawingZoom]=useState<number|null>(null);
 const [drawingDisplay,setDrawingDisplay]=useState<DrawingDisplay>(DEFAULT_WACOM_SIZE);
 const [matchWacom,setMatchWacom]=useState(false);
 const [dockIncoming,setDockIncoming]=useState(()=>localStorage.getItem('notemind.insertDocked')==='true');
 const setDocked=(docked:boolean)=>{localStorage.setItem('notemind.insertDocked',String(docked));setDockIncoming(docked);};
 const cameraSession=useRef(null),cameraLifetime=useRef(0);if(!cameraSession.current)cameraSession.current=createCameraSession();
 useEffect(()=>{const owned=cameraSession.current,generation=++cameraLifetime.current,flush=e=>{e.detail.promises.push(owned.flush())};window.addEventListener('camera-flush',flush);return()=>{window.removeEventListener('camera-flush',flush);queueMicrotask(()=>{if(cameraLifetime.current===generation)void owned.shutdown().catch(()=>{})})}},[]);

 const pdfViews=useRef(null),pdfLifetime=useRef(0);if(!pdfViews.current)pdfViews.current=new PDFReferenceViews();
 useEffect(()=>{const owned=pdfViews.current,generation=++pdfLifetime.current,flush=e=>e.detail.promises.push(owned.flush());window.addEventListener('camera-flush',flush);return()=>{window.removeEventListener('camera-flush',flush);queueMicrotask(()=>{if(pdfLifetime.current===generation)void owned.shutdown().catch(()=>{})});}},[]);
 const previewModels=useRef(null),previewLifetime=useRef(0);if(!previewModels.current)previewModels.current=new PreviewDocuments({release:token=>window.NoteMindNotes?.api?.releaseAttachmentPreview?.(token)});
 const documents=useSyncExternalStore(previewModels.current.subscribe,previewModels.current.getSnapshot),[documentId,setDocumentId]=useState(null);
 useEffect(()=>{const owned=previewModels.current,generation=++previewLifetime.current,open=e=>{const detail=e.detail,value={...detail,key:detail.bindingId?'pdf:'+detail.attachment.noteId+':'+detail.attachment.logicalId+':'+detail.path:detail.key||detail.path},selected=owned.open(value);setDocumentId(selected.key||selected.path);if(document.getElementById('pane').hidden)document.getElementById('paneToggle').click()};window.addEventListener('notemind-preview',open);return()=>{window.removeEventListener('notemind-preview',open);queueMicrotask(()=>{if(previewLifetime.current===generation)void pdfViews.current.shutdown().then(()=>owned.dispose()).catch(()=>{});});}},[]);
 const sheetModels=useRef(null);if(!sheetModels.current)sheetModels.current=new PageModels([{name:'Sheet 1',page:new TabletPage(1/A5_ASPECT)}]);
 const sheets=useSyncExternalStore(sheetModels.current.subscribe,sheetModels.current.getSnapshot),setSheets=sheetModels.current.update;

 const [loaded,setLoaded]=useState(false), [loadFailed,setLoadFailed]=useState(false); const saves=useRef(Promise.resolve()), saveTimer=useRef(null), latestSheets=useRef(null), liveSheets=sheetModels.current, sheetSaver=useRef(null), lazySheets=useRef(null), pageIdentities=useRef(new WeakMap()), modelCache=useRef(new SheetModelCache()), modelPrune=useRef(null), pendingSheetActions=useRef(new SheetActions()), persistence=useRef({loaded:false,loadFailed:false});

 const bindPage=owner=>bindSheetSignaturePage(owner,()=>liveSheets.current.find(item=>item.page===owner));for(const row of sheets)bindPage(row.page);
 const [active,setActive]=useState(0), [source,setSource]=useState(()=>localStorage.getItem('notemind.inputSource')==='camera'?'camera':'tablet'), [cameraTabs,setCameraTabs]=useState(null),[mirrorCameraTabs,setMirrorCameraTabs]=useState(null); const page=useRef(sheets[0].page), surface=useRef(null); page.current=sheets[active]?.page || sheets[0].page;



 const [showing,setShowing]=useState(true),[rescan,setRescan]=useState(null),[overviewState,setOverviewState]=useState({epoch:0,open:false});
 const currentCapture=useRef(null);currentCapture.current={source,rescan,documentId,showing};

 const sheetReady=sheets[active]?.loaded!==false;
 usePenFeed(showing && loaded && (source!=='tablet'||!!documentId||sheetReady));



 useEffect(()=>{const f=e=>setShowing(e.detail);window.addEventListener('tablet-visibility',f);return()=>window.removeEventListener('tablet-visibility',f)},[]);

 const [bringTo,setBringTo]=useState('writing'),[reading,setReading]=useState(false),[reader,setReader]=useState(false),[showEditor,setShowEditor]=useState(!document.querySelector('main').hidden);
 useEffect(()=>{window.notemind.ocrAvailable?.().then(setReader);const observer=new MutationObserver(()=>setShowEditor(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>observer.disconnect()},[]);
 const [saveError,setSaveError]=useState(''), [penSheet,setPenSheet]=useState(false);
 const overviewIntent=useRef(null),overviewLifetime=useRef(0);if(!overviewIntent.current)overviewIntent.current=new OverviewIntent({publish:(epoch,open)=>setOverviewState({epoch,open}),onError:error=>setSaveError(error.message),restoreFocus:restoreOverviewFocus});
 const overviewOwner=JSON.stringify([source,documentId,showing]),overviewEpoch=overviewIntent.current.bind(overviewOwner),overviewOpen=overviewState.epoch===overviewEpoch&&overviewState.open;
 useEffect(()=>{const generation=++overviewLifetime.current;return()=>queueMicrotask(()=>{if(overviewLifetime.current===generation)overviewIntent.current.cancel();});},[]);
 const closeCapture=event=>{if(event.currentTarget.ownerDocument!==document){void window.notemind.pad.close().catch(error=>setSaveError(error.message));}else document.getElementById('paneToggle').click();};

 const [box,setBox]=useState(null), [revision,setRevision]=useState(0);
 const {controller:toolPresetController,state:toolPresetState,colour,width,setColour,setWidth}=useToolPresets(setSaveError);

 useEffect(()=>{localStorage.setItem('notemind.penColour',colour);localStorage.setItem('notemind.penWidth',String(width));},[colour,width]);
 const refresh=()=>setRevision(x=>x+1);

 const orientation=useOrientation();const activePaper=usePaper();

 // Orientation and window size change the viewport, never the canonical ink or its undo history.

 useEffect(()=>{if(source==='tablet'&&!documentId&&sheets[active]?.paper)setPaper(sheets[active].paper);},[active,loaded,source,documentId,sheets[active]?.page,sheets[active]?.loaded]);

 useEffect(()=>{if(!loaded||source!=='tablet'||documentId||sheets[active]?.loaded===false)return;const current=paper();if(sheets[active].paper!==current){sheets[active].paper=current;refresh();}},[activePaper,active,loaded,source,documentId,sheetReady]);

 useEffect(()=>{let disposed=false;const edit=e=>{const detail=e.detail;void(async()=>{
  const saved=detail.sheet,valid=saved&&(isHydratedSheet(saved)?await validSheetsAsync([{...saved,strokes:[]}],{valid:()=>!disposed}):await validSheetsAsync([saved],{valid:()=>!disposed})),p=new TabletPage(valid?saved.aspect:screenAspect());
  try{p.backdrop=valid?saved.backdrop:detail.url;if(valid){if(!await p.loadGeometryAsync(saved.strokes,{valid:()=>!disposed}))return;p.restoreExtent(saved.extent);primeSheetSource(saved,p);}else if(p.backdrop){const image=await backdropReady(p.backdrop);if(!image)throw Error('Could not load the picture for editing.');p.setAspect(image.naturalWidth/image.naturalHeight);}
   p.target=detail.target||null;const item={name:valid?saved.name:'Image',page:p,paper:valid?saved.paper:paper(),fixedAspect:true};await prepareSheetSignature(item,{valid:()=>!disposed});if(disposed)return;bindPage(p);setSheets(old=>[...old,item]);setActive(liveSheets.current.findIndex(row=>row.page===p));setSource('tablet');setBox(null);
  }finally{if(!liveSheets.current.some(row=>row.page===p))await p.disposeAsync();}
 })().catch(error=>{if(!disposed&&error.name!=='AbortError')setSaveError(error.message);});};window.addEventListener('tablet-edit-image',edit);return()=>{disposed=true;window.removeEventListener('tablet-edit-image',edit);};},[]);

 const ensureSheetReady=chosen=>{const item=liveSheets.current.find(item=>item.page===(chosen||page.current));if(!item)return Promise.reject(Error('The drawing sheet was closed.'));return item.loaded===false?lazySheets.current.ensure(item.page):Promise.resolve(item);};
 useEffect(()=>{let cancelled=false;const loading=new AbortController(),stagedPages=[];(async()=>{
  let saved=null,fromDisk=false,storedState=null,compact=false,recovered=null;
  try{
   if(window.notemind.listSheets&&window.notemind.loadSheetPage&&window.notemind.saveSheetsDelta){
    const catalog=await window.notemind.listSheets();if(cancelled)return;const queue=new SheetSaveQueue(window.notemind);queue.seedCatalog(catalog);sheetSaver.current=queue;
    lazySheets.current=new SheetLazyLoader({api:window.notemind,queue,getSheets:()=>liveSheets.current,subscribe:listener=>liveSheets.subscribe(listener),install:async(item,stored,state,ownership)=>{const p=item.page;bindPage(p);if(p.loadGeometryAsync){if(!await p.loadGeometryAsync(stored.strokes,{...ownership,signatureMetadata:{backdrop:stored.backdrop||null,extent:stored.extent||{x:0,y:0,width:1,height:1}}}))throw Error('Drawing page recovery was cancelled.');}else p.strokes=stored.strokes;item=liveSheets.current.find(row=>row.page===p);if(!item)throw Error('The drawing sheet was closed.');p.restoreExtent(stored.extent);p.backdrop=stored.backdrop||null;primeSheetSource(stored,p);if(state.backdropHashes&&0 in state.backdropHashes)primeBackdropFingerprint(p,state.backdropHashes[0]);const hydrated={...item,loaded:true,geometryRevision:stored.geometryRevision};await prepareSheetSignature(hydrated,{...ownership,owner:p},paper());const next=liveSheets.current.map(row=>row.page===p?hydrated:row);liveSheets.current=next;setSheets(next);refresh();return hydrated;}});
    if(catalog.recoveryWarning)setSaveError(catalog.recoveryWarning);
    if(catalog.pages.length){fromDisk=true;recovered=catalog.pages.map(row=>{const item=row.metadata,p=new TabletPage(item.aspect);p.restoreExtent(item.extent);return {...item,fixedAspect:importedAspectIsFixed(item,row.strokeCount),pageId:row.pageId,geometryRevision:row.geometryRevision,name:item.name,page:p,paper:item.paper||paper(),file:item.file||null,fileRevision:item.fileRevision||null,saved:item.saved||null,loaded:false,lazySignature:row.signature,lazyMetadata:{name:item.name,paper:item.paper||paper()},strokeCount:row.strokeCount,pointCount:row.pointCount};});}
   }else if(window.notemind.loadSheetState&&window.notemind.saveSheetsDelta){const raw=await loadSheetState(window.notemind,{signal:loading.signal});compact=Object.hasOwn(raw,'encodedSheets');storedState=await hydrateSheetState(raw,{signal:loading.signal});saved=storedState.sheets;fromDisk=saved!=null;}else{saved=await window.notemind.loadSheets();fromDisk=saved!=null;}
   if(saved==null&&!recovered){compact=false;try{saved=JSON.parse(localStorage.getItem('notemind.sheets')||'[]');}catch{}}
   if(cancelled)return;
   if(storedState){const queue=new SheetSaveQueue(window.notemind);sheetSaver.current=queue;await queue.seedAsync(storedState);if(cancelled)return;}
   if(!recovered&&saved!=null&&(fromDisk||!(Array.isArray(saved)&&saved.length===0))){
    if(!await validSheetsAsync(compact?saved.map(item=>({...item,strokes:[],backdrop:null})):saved,{signal:loading.signal}))throw Error('Saved sheets have an invalid structure. The original file has been preserved; saving is disabled.');
    recovered=[];for(let index=0;index<saved.length;index++){const item=saved[index],p=new TabletPage(item.aspect);stagedPages.push(p);if(!await p.loadGeometryAsync(item.strokes,{signal:loading.signal}))throw Error('Drawing page recovery was cancelled.');p.restoreExtent(item.extent);p.backdrop=item.backdrop||null;if(!compact&&storedState?.strokeHashes?.[index])await primeStrokeFingerprintsAsync(p.strokes,storedState.strokeHashes[index],{signal:loading.signal});if(storedState?.backdropHashes&&index<storedState.backdropHashes.length)primeBackdropFingerprint(p,storedState.backdropHashes[index]);const sheet={pageId:item.pageId,geometryRevision:item.geometryRevision,name:item.name,page:p,paper:item.paper||paper(),file:item.file||null,fileRevision:item.fileRevision||null,saved:null,keptNote:!!item.keptNote,keptProject:!!item.keptProject,fixedAspect:importedAspectIsFixed(item,item.strokes.length)};await prepareSheetSignature(sheet,{signal:loading.signal});sheet.saved=await savedSignatureAsync(item.saved,sheet,{signal:loading.signal},paper());bindPage(p);recovered.push(sheet);}
   }
   if(recovered){const provisional=liveSheets.current.filter(item=>item.page.strokes.length>0||item.page.backdrop),selected=provisional.findIndex(item=>item.page===page.current),next=mergeRecoveredSheets(recovered,liveSheets.current);liveSheets.current=next;setSheets(next);setActive(selected>=0?recovered.length+selected:Math.min(Math.max(0,Number(localStorage.getItem('notemind.activeSheet'))||0),Math.max(0,recovered.length-1)));}else setActive(0);
  }catch(error){if(!cancelled){setLoadFailed(true);setSaveError('Could not load saved sheets; current drawings remain open and saving is disabled: '+(error.message||error));}}
  for(const owner of stagedPages)if(!liveSheets.current.some(row=>row.page===owner))await owner.disposeAsync();
  if(!cancelled)setLoaded(true);
 })();return()=>{cancelled=true;loading.abort();lazySheets.current?.dispose();sheetSaver.current?.dispose();};},[]);
 useEffect(()=>{if(!loaded||loadFailed||source!=='tablet'||documentId||sheets[active]?.loaded!==false)return;void ensureSheetReady(sheets[active].page).catch(error=>{if(error.name!=='AbortError')setSaveError(error.message);});},[loaded,loadFailed,source,documentId,active,sheets[active]?.page,sheets[active]?.loaded]);

 useEffect(()=>{if(loaded){localStorage.setItem('notemind.activeSheet',String(active));localStorage.setItem('notemind.inputSource',source);}},[active,source,loaded]);
 persistence.current={loaded,loadFailed};

 const snapshotSheet=s=>{let pageId=s.pageId||pageIdentities.current.get(s.page);if(!pageId){pageId=crypto.randomUUID();pageIdentities.current.set(s.page,pageId);}s.pageId=pageId;return {pageId,geometryRevision:s.geometryRevision||null,name:s.name,aspect:s.page.aspect,...(s.loaded===false?{loaded:false}:{strokes:s.page.strokes,backdrop:s.page.backdrop||null}),extent:s.page.extent,paper:s.paper||paper(),file:s.file||null,fileRevision:s.fileRevision||null,saved:s.saved||null,keptNote:!!s.keptNote,keptProject:!!s.keptProject,fixedAspect:!!s.fixedAspect};};const sheetsSnapshot=()=>liveSheets.current.map(snapshotSheet);latestSheets.current=sheetsSnapshot();

 const pruneInactiveModels=()=>{if(modelPrune.current)return modelPrune.current;const queue=sheetSaver.current;if(!queue)return Promise.resolve();const run=(async()=>{modelCache.current.touch(page.current);const selected=modelCache.current.candidates(liveSheets.current,{activePage:page.current,queue,pending:pendingSheetActions.current,signature:sheetSignature,metadata:snapshotSheet});for(const entry of selected){const item=liveSheets.current.find(item=>item.page===entry.item.page);if(!item||item.page===page.current||pendingSheetActions.current.has(item.page)||!queue.canUnload(item.pageId,item.page.strokes,item.page.backdrop||null,snapshotSheet(item))||item.page.geometryRetained||typeof item.page.unloadGeometryAsync!=='function'&&typeof item.page.unloadGeometry!=='function')continue;const head=queue.pageHeads.get(item.pageId),unloaded={...item,loaded:false,geometryRevision:head.geometryRevision,lazySignature:head.signature,lazyMetadata:{name:item.name,paper:item.paper}};liveSheets.current=liveSheets.current.map(row=>row.page===item.page?unloaded:row);setSheets(liveSheets.current);const snapshot=sheetsSnapshot().find(row=>row.pageId===item.pageId),released=await queue.releasePage(item.pageId,snapshot,{unload:()=>item.page.unloadGeometryAsync?item.page.unloadGeometryAsync({valid:()=>!item.page.geometryRetained,preserveTarget:true}):(item.page.unloadGeometry({preserveTarget:true}),true)});if(released===false){liveSheets.current=liveSheets.current.map(row=>row.page===item.page?{...row,loaded:true}:row);setSheets(liveSheets.current);}}})();modelPrune.current=run;return run.finally(()=>{if(modelPrune.current===run)modelPrune.current=null;});};
 useEffect(()=>{modelCache.current.touch(page.current);void pruneInactiveModels().catch(error=>setSaveError(error.message));},[active,sheets,revision]);
 const saveNow=async()=>{await flushAllInkMutations();const data=sheetsSnapshot();if(sheetSaver.current){saves.current=sheetSaver.current.save(data).then(async answer=>{await pruneInactiveModels();return answer;});return saves.current;}saves.current=saves.current.catch(()=>{}).then(()=>window.notemind.saveSheets(data));return saves.current;};

 useEffect(()=>{if(!loaded||loadFailed)return;saveTimer.current=setTimeout(()=>{saveTimer.current=null;saveNow().then(answer=>setSaveError(answer?.durabilityWarning||'')).catch(e=>setSaveError('Could not save sheets; the current drawings remain open: '+(e.message||e)));},500);return()=>{if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}};},[sheets,active,revision,loaded,loadFailed]);

 useEffect(()=>window.notemind.onSheetsFlush(async request=>{const current=()=>request?.current?.()!==false;if(!current())return;if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}if(!persistence.current.loaded||persistence.current.loadFailed){window.notemind.sheetsFlushDone('The drawing sheets could not be safely loaded.',request?.requestId);return;}const changes=watchCloseChanges({sheets:liveSheets,camera:cameraSession.current,pdfs:pdfViews.current,subscribeInk:subscribeInkMutations});try{await flushToQuiescence({current,capture:()=>{syncClosePaper(liveSheets.current,page.current,currentCapture.current,persistence.current,paper());return[changes.revision(),...closeFlushState({sheets:liveSheets.current,sheetSnapshot:snapshotSheet,camera:cameraSession.current,cameraSnapshot,pdfs:pdfViews.current,notes:window.NoteMindNotes,sheetActions:pendingSheetActions.current,pendingInk:hasPendingInkMutations})]},flush:async()=>{if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}const owners=[...liveSheets.current.map(row=>row.page),...(cameraSession.current?.models?.current||[]).map(row=>row.page),...[...(pdfViews.current?.values?.values()||[])].flatMap(view=>[...(view.refs?.models?.current?.values()||[])].map(value=>value.model))];const pending=[...(pendingSheetActions.current.metadataPending||[]),...(pendingSheetActions.current.writePending||[]),...owners.map(owner=>owner?.flushMetadata?.()).filter(Boolean),...(cameraSession.current?.workRef?.current||[]),...[...(pdfViews.current?.values?.values()||[])].flatMap(view=>[...(view.refs?.pendingActions?.current||[])])];if(pending.length)await Promise.all(pending);if(!current())return;await confirmCloseWrite(async()=>{const detail={promises:[],requireDurable:true};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));return Promise.all(detail.promises);},{current});if(!current())return;await flushAllInkMutations();if(!current())return;await confirmCloseWrite(saveNow,{current});},onStable:()=>window.notemind.sheetsFlushDone(null,request?.requestId)});}catch(e){if(current())window.notemind.sheetsFlushDone(e.message||String(e),request?.requestId);}finally{changes.dispose();}}),[]);



 useEffect(()=>subscribeInkMutations(()=>refresh()),[]);
 useEffect(()=>{const failed=e=>setSaveError(e.detail);window.addEventListener('notemind-drawing-error',failed);return()=>window.removeEventListener('notemind-drawing-error',failed)},[]);
 const drawingSvg=(full=false,chosen=page.current)=>{const captured=captureDrawing(full,chosen),finish=snapshot=>{const svg=svgDrawing(snapshot);return svg?btoa(svg):null;};return captured&&typeof captured.then==='function'?captured.then(finish):finish(captured);};
 const captureDrawing=(full=false,chosen=page.current,writing=false)=>{const finished=chosen===page.current?surface.current?.flush?.():flushInkMutations(chosen);const source=liveSheets.current.find(sheet=>sheet.page===chosen);if(source?.loaded===false)throw Error('The drawing is still loading.');const viewport=chosen.extent||chosen.viewport,snapshot=snapshotDrawing({name:source?.name||'Drawing',aspect:chosen.aspect,strokes:chosen.strokes,viewport,backdrop:chosen.backdrop,paper:source?.paper||paper(),target:chosen.target},full?null:(chosen===sheets[active]?.page&&(surface.current?.captureRegion?.()||box))||(writing?writingRegion(chosen.strokes,chosen.aspect):null)),projected=projectInkSnapshot(chosen,snapshot.strokes);return projected&&typeof projected.then==='function'||finished&&typeof finished.then==='function'?Promise.all([projected,finished]).then(([strokes])=>({...snapshot,strokes})):snapshot;};
 const captureReadyDrawing=(full=false,chosen=page.current,writing=false)=>{const item=liveSheets.current.find(sheet=>sheet.page===chosen);if(item?.loaded!==false)return captureDrawing(full,chosen,writing);const release=chosen.retainGeometry?.()||(()=>{});return ensureSheetReady(chosen).then(()=>captureDrawing(full,chosen,writing)).finally(release);};
 const editableSheet=(full=false,snapshot=captureDrawing(full))=>{const region=snapshot.region,result=graphics.crop({name:snapshot.name,aspect:snapshot.aspect,strokes:snapshot.strokes,backdrop:snapshot.backdrop,paper:snapshot.paper},region);if(snapshot.backdrop&&region.x===0&&region.y===0&&region.width===1&&region.height===1)result.backdrop=snapshot.backdrop;if(snapshot.backdrop&&(region.x!==0||region.y!==0||region.width!==1||region.height!==1)){const w=1000,h=1000/snapshot.aspect;result.backdrop='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x*w} ${region.y*h} ${region.width*w} ${region.height*h}"><image href="${snapshot.backdrop}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`);}return result;};
 const drawingPreview=(full=false,chosen=page.current,given=null)=>{const source=sheets.find(sheet=>sheet.page===chosen),snapshot=given||snapshotDrawing({name:source?.name||'Drawing',aspect:chosen.aspect,strokes:chosen.strokes,viewport:chosen.viewport,backdrop:chosen.backdrop,paper:source?.paper||paper(),target:chosen.target},full?null:box);if(!denseDrawing(snapshot)){const svg=svgDrawing(snapshot);return svg?btoa(svg):null;}return (async()=>{let png=chosen===page.current?await surface.current?.preview?.(snapshot):null;if(!png)png=(await exportDrawingAssets(snapshot,{maxPixels:4*1024*1024,maxDimension:4096})).png;return btoa(pngDrawingSvg(snapshot,png));})();};
 const denseAssets=async(snapshot,chosen,{crop=false,png=false,withPaper=true}={})=>{const cached=!png&&withPaper&&chosen===page.current?surface.current?.preview?.(snapshot):null;const [result,cachedImage]=await Promise.all([exportDrawingAssets(snapshot,{png:!cached,sidecar:true,crop,withPaper,maxPixels:(png?16:4)*1024*1024,maxDimension:png?8192:4096}),cached]),image=cachedImage||result.png;return {sidecar:result.sidecar,sidecarChunks:result.sidecarChunks,data:png?image.split(',')[1]:btoa(pngDrawingSvg(snapshot,image))};};
 const insert=(docked=undefined)=>{if(surface.current?.captureRegion?.()&&surface.current.selectedInk()===0)return;const chosen=page.current,captured=captureReadyDrawing(false,chosen,true),insertion=window.NoteMindNotes?.captureInsertion();const run=capturedDrawing=>{
  const snapshot={...capturedDrawing,backdrop:null};
  const finish=(data,sidecar=null,sidecarChunks=null)=>{if(data)window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/drawing-${Date.now()}.svg`,data,...(sidecar?{sidecar,sidecarChunks}:{sheet:editableSheet(false,snapshot)}),inkOnly:true,docked,displayWidth:drawingDisplayWidth(snapshot.region),insertion}}));};
  if(denseDrawing(snapshot))return denseAssets(snapshot,chosen,{crop:true,withPaper:false}).then(result=>finish(result.data,result.sidecar,result.sidecarChunks));
  const svg=svgDrawing(snapshot,false);return svg&&finish(btoa(svg));
 };try{return captured&&typeof captured.then==='function'?captured.then(run).catch(error=>setSaveError(error.message)):run(captured);}catch(error){setSaveError(error.message)}};

 const selectionRaster=async(withPaper,full=false,snapshot=captureDrawing(full))=>rasterDrawing(await snapshot,withPaper,{canvas:()=>document.createElement('canvas'),paintPaper,paintBackdrop,paintStrokes,inkOn,backdropReady});

 const selectionPng=async(withPaper,full=false,snapshot=captureDrawing(full))=>{snapshot=await snapshot;if(denseDrawing(snapshot))return (await exportDrawingAssets(snapshot,{withPaper,maxPixels:16*1024*1024,maxDimension:8192})).png;return canvasPng(await selectionRaster(withPaper,full,snapshot));};
 const insertPicture=async(full=false,docked=undefined)=>{try{const chosen=page.current,captured=captureReadyDrawing(full,chosen),insertion=window.NoteMindNotes?.captureInsertion(),snapshot=captured&&typeof captured.then==='function'?await captured:captured;if(denseDrawing(snapshot)){const result=await denseAssets(snapshot,chosen,{crop:true,png:true});window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/sheet-${Date.now()}.png`,data:result.data,sidecar:result.sidecar,sidecarChunks:result.sidecarChunks,docked,displayWidth:drawingDisplayWidth(snapshot.region),insertion}}));}else{const png=await selectionPng(true,full,snapshot);window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/sheet-${Date.now()}.png`,data:png.split(',')[1],sheet:editableSheet(full,snapshot),docked,displayWidth:drawingDisplayWidth(snapshot.region),insertion}}));}}catch(error){setSaveError(error.message);}};
 const readText=async(full=false)=>{if(reading)return;const chosen=page.current,captured=captureReadyDrawing(full,chosen),insertion=window.NoteMindNotes?.captureInsertion();setReading(true);try{const snapshot=captured&&typeof captured.then==='function'?await captured:captured,png=await selectionPng(true,full,snapshot);window.dispatchEvent(new CustomEvent('notemind-read-image',{detail:{data:png.split(',')[1],insertion}}));}catch(e){setSaveError(e.message)}finally{setReading(false)}};
 const copyDrawing=async()=>{
	const chosen=page.current,release=chosen.retainGeometry?.()||(()=>{});
	try{
		const selected=surface.current?.selectedStrokes?.();
		let snapshot=await captureReadyDrawing(false,chosen);
		if(selected?.length)snapshot={...snapshot,strokes:selected};
		const copied=await copyInk(snapshot);
		const png=(await selectionPng(false,false,snapshot)).split(',')[1];
		await window.notemind.drawingClipboard.copy({png,...copied});
	}catch(error){setSaveError('Could not copy drawing: '+error.message);}finally{release();}
 };
 const pasteDrawing=async()=>{
	const chosen=page.current,view={...chosen.viewport};
	try{
		const value=await window.notemind.drawingClipboard.read();
		if(!value)return;
		if(value.ink){
			await pendingSheetActions.current.write(chosen,async()=>{
				await ensureSheetReady(chosen);
				if(chosen===page.current)await surface.current?.flush?.();
				await flushInkMutations(chosen);
				await pasteInk(chosen,value.ink,view,{valid:()=>liveSheets.current.some(item=>item.page===chosen)});
				if(chosen===page.current){surface.current?.repaint();setBox(null);}
				refresh();
			});
		}else if(value.image){
			// A picture gets its own drawable sheet, preserving the current sheet and its ink.
			window.dispatchEvent(new CustomEvent('tablet-edit-image',{detail:{url:value.image}}));
		}
	}catch(error){setSaveError('Could not paste: '+error.message);}
 };
 const drawingClipboardKey=event=>{
	if(event.defaultPrevented||event.isComposing||event.keyCode===229||!showing&&event.target?.ownerDocument===document||overviewOpen||documentId||source!=='tablet')return;
	if(event.target?.closest?.('input,textarea,select,[contenteditable=true]'))return;
	if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey)return;
	const key=event.key.toLowerCase();
	if(key!=='c'&&key!=='v')return;
	event.preventDefault();event.stopPropagation();
	void(key==='c'?copyDrawing():pasteDrawing());
 };


 const eraseSelection=async()=>{if(!box)return;try{const chosen=page.current,area={...box},captured=captureReadyDrawing(false,chosen),snapshot=captured&&typeof captured.then==='function'?await captured:captured,replacements=new Map();for(let i=0;i<snapshot.strokes.length;i++){const stroke=snapshot.strokes[i];if(graphics.selected(stroke,area))replacements.set(stroke,null);if(i%4096===4095)await graphics.yieldTask();}if(replacements.size)await beginInkMutation(chosen,()=>replacements,{onCommit:()=>{surface.current?.repaint();refresh()}}).done;}catch(error){setSaveError(error.message)}};

 useEffect(()=>{const handlers={undo:()=>!sheetReady&&source==='tablet'?undefined:source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'undo'})):surface.current?.undo?.(),redo:()=>!sheetReady&&source==='tablet'?undefined:source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'redo'})):surface.current?.redo?.(),nextSheet:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'nextSheet'}));return;}setActive(i=>(i+1)%sheets.length);setBox(null)},prevSheet:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'prevSheet'}));return;}setActive(i=>(i+sheets.length-1)%sheets.length);setBox(null)},nextColour:()=>setColour(c=>palette[(palette.indexOf(c)+1)%palette.length]),prevColour:()=>setColour(c=>palette[(palette.indexOf(c)+palette.length-1)%palette.length]),deleteSelection:()=>{if(!sheetReady&&source==='tablet')return;if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'deleteSelection'}));return;}if(!surface.current?.deleteSelectedInk?.())void eraseSelection();},sendWriting:()=>!sheetReady&&source==='tablet'?undefined:source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'writing'})):insert(dockIncoming),sendPage:()=>!sheetReady&&source==='tablet'?undefined:source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'page'})):insertPicture(false,dockIncoming),clearSheet:()=>{if(!sheetReady&&source==='tablet')return;if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'clear'}));return;}void surface.current?.clear?.()},wider:()=>setWidth(w=>Math.min(16,w+1)),thinner:()=>setWidth(w=>Math.max(1,w-1)),clearSelection:()=>{if(source==='camera')window.dispatchEvent(new CustomEvent('camera-action',{detail:'clearSelection'}));else{surface.current?.clearInkSelection?.();setBox(null);}}};for(const action of ['undo','redo','nextSheet','prevSheet','deleteSelection','sendWriting','sendPage','clearSheet','clearSelection']){const fallback=handlers[action];handlers[action]=()=>{if(overviewOpen){if(action==='nextSheet'||action==='prevSheet'){const models=source==='camera'?cameraSession.current.models:sheetModels.current,rows=models.current,selected=source==='camera'?cameraSession.current.page.current:page.current,index=rows.findIndex(row=>row.page===selected),next=(index+(action==='nextSheet'?1:rows.length-1))%rows.length;if(source==='camera'){cameraSession.current.setter('active')(next);setRevision(value=>value+1);}else setActive(next);}return;}if(documentId){void pdfViews.current.values.get(documentId)?.command(action);return;}fallback();};}return registerPenHandlers(handlers);},[sheets,box,revision,source,colour,active,sheetReady,documentId,overviewOpen,dockIncoming]);

 useEffect(()=>{const key=e=>{if(e.defaultPrevented||e.isComposing||e.keyCode===229||!(e.ctrlKey||e.metaKey)||!showing||(!documentId&&!sheetReady&&source==='tablet'))return;const isField=e.target?.closest?.('input,textarea,[contenteditable=true]');if(isField)return;const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();runPenAction(k==='y'||e.shiftKey?'redo':'undo');}if(e.altKey){const action=({'2':'toggleErase','3':'toggleSelect','4':'nextColour','5':'prevColour','6':'thinner','7':'wider','8':'sendWriting','9':'sendPage','0':'clearSheet'})[k];if(action){e.preventDefault();runPenAction(action);}}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[showing,sheetReady,source,documentId]);

 useEffect(()=>{const moved=e=>{const {from,to}=e.detail;setSheets(old=>old.map(s=>s.file&&(s.file.toLowerCase()===from.toLowerCase()||s.file.toLowerCase().startsWith(from.toLowerCase()+'\\'))?{...s,file:to+s.file.slice(from.length)}:s));};window.addEventListener('notemind-path-renamed',moved);return()=>window.removeEventListener('notemind-path-renamed',moved);},[]);
 const palette=['#1C1C1E','#2D7DD2','#ee5533','#e8ad22','#32a66a'];

 const openLifecycle=useRef({active:true,requests:new Set()});useEffect(()=>{const owner=openLifecycle.current;owner.active=true;return()=>{owner.active=false;for(const request of owner.requests)request.abort();};},[]);
 const signatureStamp=item=>({name:item.name,aspect:item.page.aspect,backdrop:item.page.backdrop||null,paper:JSON.stringify(item.paper||paper()),extent:JSON.stringify(item.page.extent)});
 const sameSignatureStamp=(item,stamp)=>{if(!item)return false;const current=signatureStamp(item);return Object.keys(stamp).every(key=>current[key]===stamp[key]);};
 const currentSheetSignature=async chosen=>{for(;;){const item=liveSheets.current.find(row=>row.page===chosen);if(!item)return null;const strokes=chosen.strokes,stamp=signatureStamp(item),valid=()=>{const latest=liveSheets.current.find(row=>row.page===chosen);return !!latest&&chosen.strokes===strokes&&sameSignatureStamp(latest,stamp);};try{const result=await prepareSheetSignature(item,{valid,owner:chosen},paper());if(valid())return{item,signature:result.signature};}catch(error){if(error.name!=='AbortError')throw error;}}};
 const renameIntents=useRef(new WeakMap());
 const renameSheet=(chosen,name)=>pendingSheetActions.current.metadata(chosen,async()=>{const intent={};renameIntents.current.set(chosen,intent);const active=()=>renameIntents.current.get(chosen)===intent&&liveSheets.current.some(row=>row.page===chosen);const release=chosen.retainGeometry?.()||(()=>{});try{await ensureSheetReady(chosen);while(active()){const item=liveSheets.current.find(row=>row.page===chosen),source=chosen.strokes,stamp=signatureStamp(item),valid=()=>active()&&chosen.strokes===source&&sameSignatureStamp(liveSheets.current.find(row=>row.page===chosen),stamp);try{await prepareSheetSignature({...item,name},{valid,owner:chosen},paper());if(!valid())continue;setSheets(old=>old.map(row=>row.page===chosen?{...row,name}:row));return;}catch(error){if(error.name!=='AbortError')throw error;}}}catch(error){if(active()){setSaveError(error.message);throw error;}}finally{release();}});
 const prepareSheetSave=(data,chosen)=>{const snapshot=snapshotDrawing({...data,viewport:data.viewport||chosen.viewport});if(denseDrawing(snapshot))return denseAssets(snapshot,chosen).then(result=>({data:bindDrawingSaveChunks({encodedGraphics:result.sidecar},result.sidecarChunks),svg:result.data}));const preview=drawingPreview(true,chosen,snapshot),finish=svg=>({data,svg:svg||btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')});return preview&&typeof preview.then==='function'?preview.then(finish):finish(preview);};
 const saveSheet=(asNew=false,target=page.current)=>pendingSheetActions.current.write(target,async()=>{const release=target.retainGeometry?.()||(()=>{});try{const initial=liveSheets.current.find(item=>item.page===target);if(!initial)throw Error('The drawing sheet was closed.');const capturedMeta={name:initial.name,paper:{...(initial.paper||paper())}},file=asNew?null:initial.file,expected=initial.fileRevision?{...initial.fileRevision}:null;if(initial.loaded===false)await ensureSheetReady(target);const finished=target===page.current?surface.current?.flush?.():flushInkMutations(target);let data={...sheetsSnapshot()[liveSheets.current.findIndex(item=>item.page===target)],...capturedMeta,aspect:target.aspect,strokes:target.strokes,backdrop:target.backdrop||null,extent:target.extent?{...target.extent}:undefined,viewport:{...target.viewport}};const projected=projectInkSnapshot(target,data.strokes);if(projected&&typeof projected.then==='function'||finished&&typeof finished.then==='function'){const [strokes]=await Promise.all([projected,finished]);data={...data,strokes,extent:includeInk(data.extent||{x:0,y:0,width:1,height:1},strokes)};}const saved=(await prepareSheetSignature({name:data.name,paper:data.paper,page:data},{owner:target},paper())).signature,prepared=prepareSheetSave(data,target),result=prepared&&typeof prepared.then==='function'?await prepared:prepared;const written=await saveDrawingPane(window.notemind,result.data,result.svg,file,{versioned:true,expected}),path=typeof written==='string'?written:written?.file,fileRevision=typeof written==='object'?written?.revision:null;if(path){setSheets(old=>old.map(sheet=>sheet.page===target?{...sheet,file:path,fileRevision,saved}:sheet));refresh();}return path;}catch(e){setSaveError(e.message);throw e;}finally{release();}});
 const closeSheet=(chosen,fromPad=false)=>pendingSheetActions.current.write(chosen,async()=>{const release=chosen.retainGeometry?.()||(()=>{});try{
  const pending=chosen===page.current?surface.current?.flush?.():flushInkMutations(chosen);if(pending)await pending;if(liveSheets.current.find(item=>item.page===chosen)?.loaded===false)await ensureSheetReady(chosen);let preparedSignature=await currentSheetSignature(chosen);if(!preparedSignature)return;let sheet=preparedSignature.item;
  if(sheet.saved!==preparedSignature.signature&&(sheet.file||chosen.strokes.length||chosen.backdrop)){
   const choice=await window.notemind.closeSheetChoice(sheet.name,fromPad);if(choice==='cancel')return;
   if(choice==='save'){const finishing=chosen===page.current?surface.current?.flush?.():flushInkMutations(chosen);if(finishing)await finishing;preparedSignature=await currentSheetSignature(chosen);if(!preparedSignature)return;sheet=preparedSignature.item;const saved=preparedSignature.signature,data={...sheetsSnapshot()[liveSheets.current.findIndex(item=>item.page===chosen)],viewport:{...chosen.viewport}},file=sheet.file,expected=sheet.fileRevision?{...sheet.fileRevision}:null,prepared=prepareSheetSave(data,chosen),result=prepared&&typeof prepared.then==='function'?await prepared:prepared,written=await saveDrawingPane(window.notemind,result.data,result.svg,file,{versioned:true,expected}),path=typeof written==='string'?written:written?.file,fileRevision=typeof written==='object'?written?.revision:null;if(!path)return;setSheets(old=>old.map(item=>item.page===chosen?{...item,file:path,fileRevision,saved}:item));const latest=await currentSheetSignature(chosen);if(latest&&(latest.signature!==saved||hasPendingInkMutations(chosen))){setSaveError('The drawing changed while saving and remains open.');return;}}
  }
  const selected=page.current,next=liveSheets.current.filter(item=>item.page!==chosen);setSheets(old=>old.filter(item=>item.page!==chosen));setActive(Math.max(0,next.findIndex(item=>item.page===selected)));setBox(null);
 }catch(error){setSaveError(error.message);throw error;}finally{release();}});

 const openSheet=async()=>{const lifecycle=openLifecycle.current,request=new AbortController();if(!lifecycle.active)return;lifecycle.requests.add(request);let p;const valid=()=>lifecycle.active&&!request.signal.aborted;try{
  const opened=await window.notemind.openPane({compact:true});if(!opened)return;const packet=opened.transfer?await pullSheetState(window.notemind,opened.transfer,{signal:request.signal,consume:true,maxBytes:graphics.MAX_BINARY_BYTES}):null;if(!valid())return;
  const encoded=packet?.encodedSheets?.[0]?.bytes||opened.encodedSheet,saved=encoded?await graphics.decodeAsync(encoded,{owned:true,signal:request.signal}):opened.sheet;if(!await validSheetsAsync([{...saved,strokes:encoded?[]:saved.strokes}],{signal:request.signal,valid}))throw Error('Invalid drawing sheet');p=new TabletPage(saved.aspect);if(!await p.loadGeometryAsync(saved.strokes,{signal:request.signal,valid}))return;p.restoreExtent(saved.extent);p.backdrop=saved.backdrop||null;primeSheetSource(saved,p);const item={name:saved.name,page:p,paper:saved.paper||paper(),file:opened.file,fileRevision:opened.fileRevision||null};item.saved=(await prepareSheetSignature(item,{signal:request.signal,valid})).signature;if(!valid())return;bindPage(p);setSheets(old=>[...old,item]);setActive(liveSheets.current.findIndex(item=>item.page===p));setSource('tablet');
 }catch(e){if(valid()&&e.name!=='AbortError')setSaveError(e.message)}finally{lifecycle.requests.delete(request);if(p&&!liveSheets.current.some(row=>row.page===p))await p.disposeAsync();}};

 const openPicture=async()=>{const image=await window.notemind.image();if(!image)return;const ext=image.name.split('.').pop().toLowerCase(),mime=({svg:'image/svg+xml',jpg:'image/jpeg',jpeg:'image/jpeg'})[ext]||'image/'+ext;window.dispatchEvent(new CustomEvent('tablet-edit-image',{detail:{url:'data:'+mime+';base64,'+image.data}}));};

 const saveOriginal=()=>{const chosen=page.current;return pendingSheetActions.current.write(chosen,async()=>{const release=chosen.retainGeometry?.()||(()=>{});try{const binding=chosen.target,originalName=binding?.assetName,captured=captureReadyDrawing(true,chosen),snapshot=captured&&typeof captured.then==='function'?await captured:captured;if(!snapshot.target)return;const withPaper=binding.inkOnly!==true,dense=denseDrawing(snapshot),result=dense?await denseAssets(snapshot,chosen,{crop:true,png:true,withPaper}):{data:(await selectionPng(withPaper,true,snapshot)).split(',')[1]};if(chosen.target!==binding||binding?.assetName!==originalName)throw Error('The original drawing changed while this update was preparing. Try Update again.');const accepted=window.dispatchEvent(new CustomEvent('tablet-replace',{cancelable:true,detail:{target:snapshot.target,name:'assets/edited-'+Date.now()+'.png',data:result.data,...(dense?{sidecar:result.sidecar,sidecarChunks:result.sidecarChunks}:{sheet:editableSheet(true,snapshot)})}}));if(accepted&&chosen.target===binding&&binding.assetName===originalName)chosen.target=snapshot.target;}catch(error){setSaveError(error.message);throw error;}finally{release();}});};

 useEffect(()=>{const hear=e=>{const id=e.detail;if(id.startsWith('pen:'))runPenAction(id.slice(4));if(id==='source:tablet'||id==='source:camera'){setDocumentId(null);setSource(id.slice(7));if(document.getElementById('pane').hidden)document.getElementById('paneToggle').click();}if(id==='inputOff'){setDocumentId(null);setSource('off');}if(id.startsWith('cameraAspect:'))window.dispatchEvent(new CustomEvent('notemind-input',{detail:{aspect:id.slice(13)}}));if(id==='cameraRefresh')window.dispatchEvent(new CustomEvent('notemind-input',{detail:{refresh:true}}));if(id==='penSettings')setPenSheet(true);if(id==='exportDrawing'){const chosen=page.current;void pendingSheetActions.current.write(chosen,async()=>{try{const snapshot=await captureReadyDrawing(false,chosen),data=await drawingPreview(false,chosen,snapshot);return data&&await window.notemind.exportImage(data,'svg');}catch(error){setSaveError(error.message);throw error;}});}};window.addEventListener('notemind-command',hear);return()=>window.removeEventListener('notemind-command',hear);},[source,active,box,revision]);

 const buttons={erase:eraseSelection,bring:()=>insert(dockIncoming),picture:()=>insertPicture(false,dockIncoming),copy:copyDrawing,text:reader?()=>readText(false):undefined,bringOff:null};

 const closeDocument=async key=>{try{await pdfViews.current.close(key);const closed=previewModels.current.close(key);if(closed)setDocumentId(current=>current===key?closed.next:current);}catch(error){setSaveError(error.message);}};
 const overviewModels=source==='camera'?cameraSession.current.models:sheetModels.current,overviewSource=source==='camera',overview=usePageOverview({open:overviewOpen&&!documentId&&showing&&source!=='off',models:overviewModels,api:overviewSource?{loadSheetPage:(...args)=>window.notemind.loadCameraPage(...args),cancelSheetPageLoad:id=>window.notemind.cancelCameraPageLoad?.(id),loadSheetChunk:(...args)=>window.notemind.loadSheetChunk(...args),finishSheetLoad:(...args)=>window.notemind.finishSheetLoad(...args)}:window.notemind,head:row=>(overviewSource?cameraSession.current.storeRef.current?.queue:sheetSaver.current)?.pageHeads.get(row.pageId),metadata:row=>{if(overviewSource){const value=cameraSnapshot(row);return{aspect:value.aspect,extent:row.page.extent,camera:value.camera}}return{aspect:row.page.aspect,extent:row.page.extent,paper:row.paper||paper()}},project:projectInkSnapshot});
 if(!loaded)return <div className="tablet-pane"><div className="tablet-footer camera-foot">Loading sheets…</div></div>;


 const closeOverview=ownerDocument=>overviewIntent.current.close(overviewOwner,ownerDocument);
 const chooseOverview=(id,ownerDocument)=>{const rows=overviewModels.current,index=rows.findIndex(row=>row.pageId===id);if(index<0)return;if(overviewSource)cameraSession.current.setter('active')(index);else{setActive(index);setBox(null);}closeOverview(ownerDocument);};
 const reorderOverview=(id,before)=>{const selected=overviewSource?cameraSession.current.page.current:page.current;if(!overview.move(id,before))return;const index=overviewModels.current.findIndex(row=>row.page===selected);if(index>=0){if(overviewSource)cameraSession.current.setter('active')(index);else setActive(index);}};
 const toggleOverview=ownerDocument=>{if(documentId||!showing||source==='off')return;const drawing=surface.current,camera=overviewSource?cameraSession.current:null;return overviewIntent.current.toggle(overviewOwner,async current=>{await drawing?.flush?.();if(current()&&camera)await camera.flush();},ownerDocument)};
 const showTabletActions=!overviewOpen&&!documentId&&source==='tablet'&&sheetReady;
 const tabletFiles=showTabletActions?{save:()=>saveSheet(),saveAs:()=>saveSheet(true),open:openSheet,file:sheets[active].file||null,dirty:hasPendingInkMutations(page.current)||sheets[active].saved!==sheetSignature(sheets[active]),rescan:page.current.backdrop?()=>{setRescan({page:page.current,id:crypto.randomUUID()});setSource('camera');}:null,picture:page.current.target||page.current.backdrop?{saveOriginal:page.current.target?saveOriginal:null,saveNew:async()=>{const png=await selectionPng(true,true);await window.notemind.exportImage(png.split(',')[1],'png')}}:null,keptNote:!!sheets[active].keptNote,keptProject:!!sheets[active].keptProject,canKeepNote:true,canKeepProject:true,onKeep:async(to,on)=>{const chosen=page.current,insertion=window.NoteMindNotes?.captureInsertion();pendingSheetActions.current.add(chosen);const release=chosen.retainGeometry?.()||(()=>{});try{if(to==='note'){if(on){const captured=captureReadyDrawing(true,chosen),snapshot=captured&&typeof captured.then==='function'?await captured:captured;let svg,sidecar,sidecarChunks;if(denseDrawing(snapshot)){const result=await denseAssets(snapshot,chosen,{crop:true});svg=result.data;sidecar=result.sidecar;sidecarChunks=result.sidecarChunks;}else{const preview=drawingPreview(true,chosen,snapshot);svg=(preview&&typeof preview.then==='function'?await preview:preview)||btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');}const accepted=window.dispatchEvent(new CustomEvent('notemind-keep-drawing',{cancelable:true,detail:{...(sidecar?{sidecar,sidecarChunks}:{sheet:editableSheet(true,snapshot)}),svg,insertion}}));if(!accepted)return;}setSheets(old=>old.map(sheet=>sheet.page===chosen?{...sheet,keptNote:on}:sheet));}else{if(on){const file=await saveSheet(false,chosen);if(!file)return;window.dispatchEvent(new CustomEvent('notemind-keep-file',{detail:file}));}setSheets(old=>old.map(sheet=>sheet.page===chosen?{...sheet,keptProject:on}:sheet));}refresh();}finally{pendingSheetActions.current.delete(chosen);release();}}}:null;
 const canClearDrawing=!!page.current.strokes.length||hasPendingInkMutations(page.current);
 const clearDrawing=()=>{void surface.current?.clear?.()};
 const tabletHead=showTabletActions?<TabletHeader canClear={canClearDrawing} onClear={clearDrawing} canUndo={page.current.canUndo||hasPendingInkMutations(page.current)} undoTitle="Take back the last stroke" onUndo={()=>{void surface.current?.undo?.()}} canRedo={page.current.canRedo} redoTitle="Bring back the stroke taken back" onRedo={()=>{void surface.current?.redo?.()}} to={bringTo} onBringTo={setBringTo} bringTitle={bringTo==='text'?'Read the writing as text':'Bring the writing into the Notepad'} bringOff={null} onBring={to=>to==='text'?readText(false):insert(dockIncoming)} onBringPage={()=>insertPicture(true,dockIncoming)} docked={dockIncoming} onDocked={setDocked} onBringSheetText={()=>readText(true)} reader={reader} textOff={reading?'Reading…':null} onHide={()=>document.getElementById('paneToggle').click()} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}/>:null;
 const drawingTabs=!documentId&&source==='tablet';
 const addPageTitle=source==='camera'?'New camera tab':'New drawing sheet';
 const addPage=<button hidden={!!documentId||source==='off'} type="button" className="bar-btn sheet-add"
   title={addPageTitle} aria-label={addPageTitle} onClick={()=>{
    if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'newTab'}));return;}
    const added={name:'Sheet '+(liveSheets.current.length+1),page:new TabletPage(1/A5_ASPECT)};
    setSheets(old=>[...old,added]);
    setActive(liveSheets.current.findIndex(item=>item.page===added.page));
    setBox(null);
   }}><Icon name="plus"/></button>;
 const zoomPercent=drawingZoom===null?null:Math.round(drawingZoom*100);
 const drawingFooter=<PaneChrome slot="footer"><div className="tablet-footer camera-foot">
  <span className="line" role="status">{saveError||''}</span>
  <select data-drawing-zoom aria-label="Drawing zoom" title="Zoom the drawing page" value={zoomPercent??'fit'}
    onChange={event=>{const value=event.currentTarget.value;if(value==='fit')surface.current?.fitView();else surface.current?.magnifyView(Number(value)/100);}}>
   <option value="fit">Fit</option>
   {zoomPercent!==null&&!drawingZoomLevels.includes(zoomPercent)&&<option value={zoomPercent}>{zoomPercent}%</option>}
   {drawingZoomLevels.map(level=><option key={level} value={level}>{level}%</option>)}
  </select>
 </div></PaneChrome>;
 return <PadHost onDisplaySize={setDrawingDisplay}><div className="tablet-pane camera" onKeyDown={drawingClipboardKey} onPaste={event=>{if(event.defaultPrevented||source!=='tablet'||documentId||overviewOpen||event.target?.closest?.('input,textarea,select,[contenteditable=true]'))return;event.preventDefault();void pasteDrawing();}}><ShellChrome source={source} onResetDrawing={drawingTabs&&!overviewOpen?()=>{surface.current?.fitView();setMatchWacom(true);}:undefined}/><PaneChrome slot="tabs">{(mirror,onPad)=><div className="sheet-tabs" role="toolbar" aria-label="Capture pane" data-sheets={documentId?"documents":drawingTabs?"drawing":""}><span id="video-options"><VideoControl source={source} visible={showing} documentActive={!!documentId} documentId={documentId} openDocuments={documents} onDocument={setDocumentId}/></span><div className="sheet-scroll" role="tablist" aria-label={documentId?"Documents":"Sheets and camera pages"} onWheel={e=>{e.currentTarget.scrollLeft+=e.deltaY;}}><div id="camera-tabs" hidden={!!documentId||source!=='camera'} ref={mirror?setMirrorCameraTabs:setCameraTabs}/>{!documentId&&source==='tablet'&&sheets.map((sheet,i)=><SheetTab key={sheet.pageId} name={sheet.name} dirty={(!!sheet.file||!!sheet.page.strokes.length||!!sheet.page.backdrop||!!sheet.strokeCount||hasPendingInkMutations(sheet.page))&&sheet.saved!==sheetSignature(sheet)} selected={!documentId&&source==='tablet'&&active===i} onSelect={()=>{const index=liveSheets.current.findIndex(item=>item.page===sheet.page);if(index<0)return;surface.current?.flush?.();page.current=sheet.page;setDocumentId(null);setSource('tablet');setActive(index);setBox(null);if(sheet.loaded===false)void ensureSheetReady(sheet.page).catch(error=>setSaveError(error.message));}} onRename={name=>{void renameSheet(sheet.page,name).catch(()=>{})}} onClose={sheets.length>1?event=>closeSheet(sheet.page,event?.currentTarget?.ownerDocument!==document):undefined} onDragStart={e=>e.dataTransfer.setData('application/x-notemind-sheet',sheet.pageId)} onDrop={e=>{const id=e.dataTransfer.getData('application/x-notemind-sheet'),before=liveSheets.current,from=before.findIndex(item=>item.pageId===id),to=before.findIndex(item=>item.page===sheet.page);if(from<0||to<0||from===to)return;const selected=page.current,next=[...before];next.splice(to,0,...next.splice(from,1));setSheets(next);setActive(next.findIndex(item=>item.page===selected));}}/>)}{documentId&&documents.map(d=><div key={d.key||d.path} role="tab" tabIndex={documentId===(d.key||d.path)?0:-1} aria-selected={documentId===(d.key||d.path)} data-doc-tab={d.path} data-doc-path={d.path} className={'sheet-tab doc'+(documentId===(d.key||d.path)?' on':'')} title={d.path} onKeyDown={event=>captureTabKey(event,()=>setDocumentId(d.key||d.path))} onClick={()=>setDocumentId(d.key||d.path)} onMouseDown={e=>{if(e.button===1)e.preventDefault()}} onAuxClick={e=>{if(e.button===1){e.preventDefault();closeDocument(d.key||d.path)}}}><Icon name="doc" size={12}/><span className="name">{d.name}</span><button tabIndex={documentId===(d.key||d.path)?0:-1} className="sheet-close" data-doc-close={d.path} aria-label={'Close '+d.name} title="Close this document" onClick={e=>{e.stopPropagation();closeDocument(d.key||d.path)}}><Icon name="close" size={10}/></button></div>)}</div>{drawingTabs&&addPage}
  <button hidden={!!documentId||source==='off'} type="button" className="bar-btn" aria-label="Page overview" data-page-overview-toggle="" title="Browse and reorder pages" aria-pressed={overviewOpen} onClick={event=>void toggleOverview(event.currentTarget.ownerDocument)}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg></button>{!drawingTabs&&addPage}{tabletFiles&&<TabletOptions
    files={tabletFiles}
    canClear={canClearDrawing} onClear={clearDrawing}
  />}<button className="bar-btn pane-hide" aria-label={!mirror&&onPad?"Close tablet window":"Hide capture pane"} title={!mirror&&onPad?"Close tablet window":"Hide capture pane"} onClick={closeCapture}><Icon name="close"/></button></div>}</PaneChrome><PaneChrome slot="pen"><div id="pen-control" className="pen-bar" role="toolbar" aria-label="Pen controls"><PenControl colour={colour} width={width} onColour={setColour} onWidth={setWidth} presets={{controller:toolPresetController,state:toolPresetState}} presetsEnabled={showing&&!documentId&&source==='tablet'} onError={setSaveError} surface={documentId||source==='tablet'&&page.current.backdrop?'picture':source==='camera'?'camera':'sheet'} onPenSettings={()=>setPenSheet(true)} trailing={tabletHead}/></div></PaneChrome>{penSheet&&<PenSheet at={{top:76,right:16}} onClose={()=>setPenSheet(false)}/>} <CameraWorkspace session={cameraSession.current} rescan={rescan} onRescan={async(url,target)=>{pendingSheetActions.current.add(target.page);try{return await applyCameraRescan(target,url,{getMode:()=>currentCapture.current,getSheets:()=>liveSheets.current,ensure:ensureSheetReady,onApplied:(owner,{focus})=>{if(focus){setActive(liveSheets.current.findIndex(item=>item.page===owner));setSource('tablet');}setRescan(value=>value===target?null:value);refresh();}});}finally{pendingSheetActions.current.delete(target.page);}}} tabsTarget={[cameraTabs,mirrorCameraTabs].filter(Boolean)} onActivate={()=>{setDocumentId(null);setSource('camera');setBox(null)}} active={!overviewOpen&&!documentId&&source==='camera' && showing} colour={colour} width={width} onClose={()=>document.getElementById('paneToggle').click()}/>{documents.map(d=>{const Workspace=/\.pdf$/i.test(d.path)?PDFReferenceWorkspace:DocumentWorkspace;return <Workspace key={d.key||d.path} doc={d} session={Workspace===PDFReferenceWorkspace?pdfViews.current.get(d):undefined} active={documentId===(d.key||d.path)} onClose={()=>closeDocument(d.key||d.path)} colour={colour} width={width} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}/>;})}{!documentId&&source==='off'&&<><PaneChrome slot="header"><div className="bar-row camera-head empty"><span className="grow"/><button className="bar-btn" aria-label="Put the pane away" title="Hide capture pane" onClick={()=>document.getElementById('paneToggle').click()}><Icon name="close"/></button></div></PaneChrome><div className="camera-body" data-pad-content><div className="placeholder"><div className="title">What should this pane show?</div><div className="detail">A document camera, the Wacom tablet as a sheet, or nothing.</div><div className="source-cards"><button className="source-card" title="Write or draw on a tablet sheet" onClick={()=>setSource('tablet')}><Icon name="tablet" size={22}/><span className="name">Tablet sheet</span><span className="sub">write with the pen</span></button><button className="source-card" title="Capture a page or picture with a camera" onClick={()=>setSource('camera')}><Icon name="camera" size={22}/><span className="name">Camera</span><span className="sub">point it at a page</span></button></div><div className="source-links"><button title="Find connected cameras" onClick={()=>setSource('camera')}>Refresh devices</button><button title="Hide capture pane" onClick={()=>document.getElementById('paneToggle').click()}>Hide this pane</button></div></div></div><PaneChrome slot="footer"><div className="camera-foot"><span className="line">Choose an input device</span></div></PaneChrome></>}{!overviewOpen&&!documentId&&source==='tablet'&&!sheetReady&&<div className="tablet-stage" data-pad-content aria-busy="true"><span role="status">{saveError||'Opening page…'}</span>{saveError?<button className="bar-btn" title="Retry opening this drawing page" onClick={()=>{setSaveError('');void ensureSheetReady(page.current).catch(error=>setSaveError(error.message));}}>Retry</button>:null}</div>}{!overviewOpen&&!documentId&&source==='tablet'&&sheetReady&&<><DrawingStage display={matchWacom?drawingDisplay:null}><TabletSurface ref={surface} page={page.current} colour={colour} width={width} box={box} onBox={setBox} onEdited={refresh} buttons={buttons} showPrecisionControls={false} onDrawingZoom={setDrawingZoom}/></DrawingStage>{drawingFooter}</>}{overviewOpen&&!documentId&&showing&&source!=='off'&&<PageOverview pages={overview.pages} activeId={(overviewSource?cameraSession.current.models.current[cameraSession.current.state.active]:sheets[active])?.pageId||null} onSelect={chooseOverview} onReorder={reorderOverview} loadCompact={overview.load} coordinator={overview.coordinator} onClose={closeOverview} focusOnOpen/>}</div></PadHost>



}

createRoot(document.getElementById('tablet-root')).render(<App/>);



