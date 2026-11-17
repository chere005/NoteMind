import './tablet/renderer/scanPages';
import {DocumentWorkspace} from './tablet/renderer/DocumentWorkspace';
import {PadHost} from './tablet/renderer/PadHost';
import {PaneChrome} from './tablet/renderer/PaneChrome';
import {A5_ASPECT} from './tablet/renderer/padOrientation';
import {VideoControl} from './tablet/renderer/VideoControl';
import {ShellChrome} from './tablet/renderer/ShellChrome';
import React, {useEffect, useRef, useState} from 'react';

import graphics from './graphics-pane.js';
import {SheetSaveQueue} from './sheet-save-queue.js';
import {snapshotDrawing, rasterDrawing, svgDrawing, denseDrawing, pngDrawingSvg, canvasPng} from './tablet/renderer/drawingSnapshot';
import {sheetSignature as signatureOf, savedSignature, primeStrokeFingerprints, primeBackdropFingerprint} from './tablet/renderer/sheetSignature';
import {exportDrawingAssets} from './drawing-export.js';
import {TabletHeader} from './tablet/renderer/CameraHeader';
import {PenControl} from './tablet/renderer/PenControl';
import {useToolPresets} from './tablet/renderer/useToolPresets';
import {SheetTab} from './tablet/renderer/SheetTab';
import './tablet/renderer/camera.css';
import './tablet/renderer/toolbar.css';
import {createRoot} from 'react-dom/client';

import {TabletSurface} from './tablet/renderer/TabletSurface';

import {TabletPage, paintStrokes, screenAspect} from './tablet/renderer/tabletPage';

import {paper, paintPaper, inkOn, usePaper, setPaper} from './tablet/renderer/tabletPaper';

import {CameraWorkspace} from './tablet/renderer/CameraWorkspace';

import {outsideSelection} from './tablet/renderer/selection';

import {validSheets} from './tablet/renderer/validateStorage';

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

const sheetSignature=s=>signatureOf(s,paper());
function App(){

 const [documents,setDocuments]=useState([]),[documentId,setDocumentId]=useState(null);
 useEffect(()=>{const open=e=>{setDocuments(old=>old.some(d=>d.path===e.detail.path)?old:[...old,e.detail]);setDocumentId(e.detail.path);if(document.getElementById('pane').hidden)document.getElementById('paneToggle').click()};window.addEventListener('notemind-preview',open);return()=>window.removeEventListener('notemind-preview',open)},[]);
 const [sheets,setSheets]=useState([{name:'Sheet 1',page:new TabletPage(1/A5_ASPECT)}]);

 const [loaded,setLoaded]=useState(false), [loadFailed,setLoadFailed]=useState(false); const saves=useRef(Promise.resolve()), saveTimer=useRef(null), latestSheets=useRef(null), liveSheets=useRef(sheets), sheetSaver=useRef(null), persistence=useRef({loaded:false,loadFailed:false});

 const [active,setActive]=useState(0), [source,setSource]=useState(()=>localStorage.getItem('notemind.inputSource')==='camera'?'camera':'tablet'), [cameraTabs,setCameraTabs]=useState(null),[mirrorCameraTabs,setMirrorCameraTabs]=useState(null); const page=useRef(sheets[0].page), surface=useRef(null); page.current=sheets[active]?.page || sheets[0].page;



 const [showing,setShowing]=useState(true),[rescan,setRescan]=useState(null);

 usePenFeed(showing && loaded);



 useEffect(()=>{const f=e=>setShowing(e.detail);window.addEventListener('tablet-visibility',f);return()=>window.removeEventListener('tablet-visibility',f)},[]);

 const [bringTo,setBringTo]=useState('writing'),[reading,setReading]=useState(false),[reader,setReader]=useState(false),[showEditor,setShowEditor]=useState(!document.querySelector('main').hidden);
 useEffect(()=>{window.notemind.ocrAvailable?.().then(setReader);const observer=new MutationObserver(()=>setShowEditor(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>observer.disconnect()},[]);
 const [saveError,setSaveError]=useState(''), [penSheet,setPenSheet]=useState(false);
 const closeCapture=event=>{if(event.currentTarget.ownerDocument!==document){void window.notemind.pad.close().catch(error=>setSaveError(error.message));}else document.getElementById('paneToggle').click();};

 const [box,setBox]=useState(null), [revision,setRevision]=useState(0);
 const {controller:toolPresetController,state:toolPresetState,colour,width,setColour,setWidth}=useToolPresets(setSaveError);

 useEffect(()=>{localStorage.setItem('notemind.penColour',colour);localStorage.setItem('notemind.penWidth',String(width));},[colour,width]);
 const refresh=()=>setRevision(x=>x+1);

 const orientation=useOrientation();const activePaper=usePaper();

 // Orientation and window size change the viewport, never the canonical ink or its undo history.

 useEffect(()=>{if(sheets[active]?.paper)setPaper(sheets[active].paper);},[active,loaded]);

 useEffect(()=>{sheets[active].paper=activePaper;refresh();},[activePaper]);

 useEffect(()=>{const edit=e=>{const saved=e.detail.sheet,valid=saved&&validSheets([saved]);const p=new TabletPage(valid?saved.aspect:screenAspect());p.backdrop=valid?saved.backdrop:e.detail.url;if(valid){p.strokes=saved.strokes;p.restoreExtent(saved.extent);}else if(p.backdrop)void backdropReady(p.backdrop).then(image=>{if(image){p.setAspect(image.naturalWidth/image.naturalHeight);refresh();}else setSaveError('Could not load the picture for editing.');});p.target=e.detail.target||null;setSheets(old=>[...old,{name:saved?.name||'Image',page:p,paper:valid?saved.paper:paper(),fixedAspect:true}]);setActive(sheets.length);setSource('tablet');setBox(null);};window.addEventListener('tablet-edit-image',edit);return()=>window.removeEventListener('tablet-edit-image',edit);},[sheets.length]);

 useEffect(()=>{let cancelled=false;(async()=>{let saved=null,fromDisk=false,storedState=null;try{if(window.notemind.loadSheetState&&window.notemind.saveSheetsDelta){storedState=await window.notemind.loadSheetState();saved=storedState.sheets;}else saved=await window.notemind.loadSheets();fromDisk=saved!=null;}catch(e){if(!cancelled){setLoadFailed(true);setSaveError('Could not load saved sheets; new drawings will not be saved: '+(e.message||e));}}if(saved==null){try{saved=JSON.parse(localStorage.getItem('notemind.sheets')||'[]');}catch{}}if(cancelled)return;if(storedState){try{const queue=new SheetSaveQueue(window.notemind);queue.seed(storedState);sheetSaver.current=queue;}catch(error){setLoadFailed(true);setSaveError('Could not load saved drawing state: '+error.message);}}if(saved!=null&&(fromDisk||!(Array.isArray(saved)&&saved.length===0))){if(!validSheets(saved)){setLoadFailed(true);setSaveError('Saved sheets have an invalid structure. The original file has been preserved; saving is disabled.');}else setSheets(saved.map((item,index)=>{const p=new TabletPage(item.aspect);p.strokes=item.strokes;p.restoreExtent(item.extent);p.backdrop=item.backdrop||null;if(storedState?.strokeHashes)primeStrokeFingerprints(p.strokes,storedState.strokeHashes[index]);if(storedState?.backdropHashes)primeBackdropFingerprint(p,storedState.backdropHashes[index]);const sheet={name:item.name,page:p,paper:item.paper||paper(),file:item.file||null,saved:null,keptNote:!!item.keptNote,keptProject:!!item.keptProject,fixedAspect:item.fixedAspect===true||(item.fixedAspect==null&&item.strokes.length>0)};sheet.saved=savedSignature(item.saved,sheet,paper());return sheet;}));}setActive(Math.min(Math.max(0,Number(localStorage.getItem('notemind.activeSheet'))||0),Array.isArray(saved)?Math.max(0,saved.length-1):0));setLoaded(true);})();return()=>{cancelled=true;sheetSaver.current?.dispose();};},[]);

 useEffect(()=>{if(loaded){localStorage.setItem('notemind.activeSheet',String(active));localStorage.setItem('notemind.inputSource',source);}},[active,source,loaded]);
 persistence.current={loaded,loadFailed};liveSheets.current=sheets;

 const sheetsSnapshot=()=>liveSheets.current.map(s=>({name:s.name,aspect:s.page.aspect,strokes:s.page.strokes,extent:s.page.extent,backdrop:s.page.backdrop||null,paper:s.paper||paper(),file:s.file||null,saved:s.saved||null,keptNote:!!s.keptNote,keptProject:!!s.keptProject,fixedAspect:!!s.fixedAspect}));latestSheets.current=sheetsSnapshot();

 const saveNow=()=>{const data=sheetsSnapshot();if(sheetSaver.current){saves.current=sheetSaver.current.save(data);return saves.current;}saves.current=saves.current.catch(()=>{}).then(()=>window.notemind.saveSheets(data));return saves.current;};

 useEffect(()=>{if(!loaded||loadFailed)return;saveTimer.current=setTimeout(()=>{saveTimer.current=null;saveNow().then(()=>setSaveError('')).catch(e=>setSaveError('Could not save sheets; the current drawings remain open: '+(e.message||e)));},500);return()=>{if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}};},[sheets,active,revision,loaded,loadFailed]);

 useEffect(()=>window.notemind.onSheetsFlush(async()=>{if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}if(!persistence.current.loaded||persistence.current.loadFailed){window.notemind.sheetsFlushDone('The drawing sheets could not be safely loaded.');return;}try{const detail={promises:[]};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));await Promise.all([saveNow(),...detail.promises]);window.notemind.sheetsFlushDone(null);}catch(e){window.notemind.sheetsFlushDone(e.message||String(e));}}),[]);



 const drawingSvg=(full=false,chosen=page.current)=>{const source=sheets.find(sheet=>sheet.page===chosen);const snapshot=snapshotDrawing({name:source?.name||'Drawing',aspect:chosen.aspect,strokes:chosen.strokes,viewport:chosen.viewport,backdrop:chosen.backdrop,paper:source?.paper||paper(),target:chosen.target},full?null:box);const svg=svgDrawing(snapshot);return svg?btoa(svg):null;};

 const captureDrawing=(full=false)=>{const chosen=page.current,source=sheets.find(sheet=>sheet.page===chosen);return snapshotDrawing({name:source?.name||'Drawing',aspect:chosen.aspect,strokes:chosen.strokes,viewport:chosen.viewport,backdrop:chosen.backdrop,paper:source?.paper||paper(),target:chosen.target},full?null:box);};
 const editableSheet=(full=false,snapshot=captureDrawing(full))=>{const region=snapshot.region,result=graphics.crop({name:snapshot.name,aspect:snapshot.aspect,strokes:snapshot.strokes,backdrop:snapshot.backdrop,paper:snapshot.paper},region);if(snapshot.backdrop&&region.x===0&&region.y===0&&region.width===1&&region.height===1)result.backdrop=snapshot.backdrop;if(snapshot.backdrop&&(region.x!==0||region.y!==0||region.width!==1||region.height!==1)){const w=1000,h=1000/snapshot.aspect;result.backdrop='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x*w} ${region.y*h} ${region.width*w} ${region.height*h}"><image href="${snapshot.backdrop}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`);}return result;};
 const drawingPreview=(full=false,chosen=page.current,given=null)=>{const source=sheets.find(sheet=>sheet.page===chosen),snapshot=given||snapshotDrawing({name:source?.name||'Drawing',aspect:chosen.aspect,strokes:chosen.strokes,viewport:chosen.viewport,backdrop:chosen.backdrop,paper:source?.paper||paper(),target:chosen.target},full?null:box);if(!denseDrawing(snapshot)){const svg=svgDrawing(snapshot);return svg?btoa(svg):null;}return (async()=>{let png=chosen===page.current?await surface.current?.preview?.(snapshot):null;if(!png)png=(await exportDrawingAssets(snapshot,{maxPixels:4*1024*1024,maxDimension:4096})).png;return btoa(pngDrawingSvg(snapshot,png));})();};
 const denseAssets=async(snapshot,chosen,{crop=false,png=false,withPaper=true}={})=>{const cached=!png&&withPaper&&chosen===page.current?surface.current?.preview?.(snapshot):null;const [result,cachedImage]=await Promise.all([exportDrawingAssets(snapshot,{png:!cached,sidecar:true,crop,withPaper,maxPixels:(png?16:4)*1024*1024,maxDimension:png?8192:4096}),cached]),image=cachedImage||result.png;return {sidecar:result.sidecar,data:png?image.split(',')[1]:btoa(pngDrawingSvg(snapshot,image))};};
 const insert=()=>{const snapshot=captureDrawing(),insertion=window.NoteMindNotes?.captureInsertion(),chosen=page.current,finish=(data,sidecar=null)=>{if(data)window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/drawing-${Date.now()}.svg`,data,...(sidecar?{sidecar}:{sheet:editableSheet(false,snapshot)}),insertion}}));};if(denseDrawing(snapshot))return denseAssets(snapshot,chosen,{crop:true}).then(result=>finish(result.data,result.sidecar)).catch(error=>setSaveError(error.message));const data=drawingPreview(false,chosen,snapshot);if(data&&typeof data.then==='function')return data.then(finish).catch(error=>setSaveError(error.message));return finish(data);};

 const selectionRaster=(withPaper,full=false,snapshot=captureDrawing(full))=>rasterDrawing(snapshot,withPaper,{canvas:()=>document.createElement('canvas'),paintPaper,paintBackdrop,paintStrokes,inkOn,backdropReady});

 const selectionPng=async(withPaper,full=false,snapshot=captureDrawing(full))=>{if(denseDrawing(snapshot))return (await exportDrawingAssets(snapshot,{withPaper,maxPixels:16*1024*1024,maxDimension:8192})).png;return canvasPng(await selectionRaster(withPaper,full,snapshot));};
 const insertPicture=async(full=false)=>{try{const snapshot=captureDrawing(full),insertion=window.NoteMindNotes?.captureInsertion(),chosen=page.current;if(denseDrawing(snapshot)){const result=await denseAssets(snapshot,chosen,{crop:true,png:true});window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/sheet-${Date.now()}.png`,data:result.data,sidecar:result.sidecar,insertion}}));}else{const png=await selectionPng(true,full,snapshot);window.dispatchEvent(new CustomEvent('tablet-insert',{detail:{name:`assets/sheet-${Date.now()}.png`,data:png.split(',')[1],sheet:editableSheet(full,snapshot),insertion}}));}}catch(error){setSaveError(error.message);}};
 const readText=async(full=false)=>{if(reading)return;const snapshot=captureDrawing(full),insertion=window.NoteMindNotes?.captureInsertion();setReading(true);try{const png=await selectionPng(true,full,snapshot);window.dispatchEvent(new CustomEvent('notemind-read-image',{detail:{data:png.split(',')[1],insertion}}));}catch(e){setSaveError(e.message)}finally{setReading(false)}};
 const copyDrawing=async()=>{try{const data=(await selectionPng(false)).split(',')[1];await window.notemind.copyPng(data);}catch(e){alert('Could not copy image: '+(e.message||e));}};


 useEffect(()=>registerPenHandlers({undo:()=>source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'undo'})):(page.current.undo(),refresh()),redo:()=>source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'redo'})):(page.current.redo(),refresh()),nextSheet:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'nextSheet'}));return;}setActive(i=>(i+1)%sheets.length);setBox(null)},prevSheet:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'prevSheet'}));return;}setActive(i=>(i+sheets.length-1)%sheets.length);setBox(null)},nextColour:()=>setColour(c=>palette[(palette.indexOf(c)+1)%palette.length]),prevColour:()=>setColour(c=>palette[(palette.indexOf(c)+palette.length-1)%palette.length]),deleteSelection:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'deleteSelection'}));return;}if(box){page.current.replace(outsideSelection(page.current.strokes,box));refresh();}},sendWriting:()=>source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'writing'})):insert(),sendPage:()=>source==='camera'?window.dispatchEvent(new CustomEvent('camera-action',{detail:'page'})):insertPicture(),clearSheet:()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'clear'}));return;}page.current.clear();surface.current?.repaint();refresh()},wider:()=>setWidth(w=>Math.min(16,w+1)),thinner:()=>setWidth(w=>Math.max(1,w-1)),clearSelection:()=>{if(source==='camera')window.dispatchEvent(new CustomEvent('camera-action',{detail:'clearSelection'}));else setBox(null);}}),[sheets,box,revision,source,colour]);

 useEffect(()=>{const key=e=>{if(!(e.ctrlKey||e.metaKey)||!showing)return;const isField=e.target?.closest?.('input,textarea,[contenteditable=true]');if(isField)return;const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();runPenAction(k==='y'||e.shiftKey?'redo':'undo');}if(e.altKey){const action=({'2':'toggleErase','3':'toggleSelect','4':'nextColour','5':'prevColour','6':'thinner','7':'wider','8':'sendWriting','9':'sendPage','0':'clearSheet'})[k];if(action){e.preventDefault();runPenAction(action);}}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[showing]);

 useEffect(()=>{const moved=e=>{const {from,to}=e.detail;setSheets(old=>old.map(s=>s.file&&(s.file.toLowerCase()===from.toLowerCase()||s.file.toLowerCase().startsWith(from.toLowerCase()+'\\'))?{...s,file:to+s.file.slice(from.length)}:s));};window.addEventListener('notemind-path-renamed',moved);return()=>window.removeEventListener('notemind-path-renamed',moved);},[]);
 const palette=['#1C1C1E','#2D7DD2','#ee5533','#e8ad22','#32a66a'];

 const prepareSheetSave=(data,chosen)=>{const snapshot=snapshotDrawing({...data,viewport:chosen.viewport});if(denseDrawing(snapshot))return denseAssets(snapshot,chosen).then(result=>({data:{encodedGraphics:result.sidecar},svg:result.data}));const preview=drawingPreview(true,chosen,snapshot),finish=svg=>({data,svg:svg||btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')});return preview&&typeof preview.then==='function'?preview.then(finish):finish(preview);};
 const saveSheet=async(asNew=false)=>{try{const chosen=sheets[active],saved=sheetSignature(chosen),data=latestSheets.current[active],prepared=prepareSheetSave(data,chosen.page),result=prepared&&typeof prepared.then==='function'?await prepared:prepared;const file=await window.notemind.savePane(result.data,result.svg,asNew?null:chosen.file);if(file){setSheets(old=>old.map(sheet=>sheet.page===chosen.page?{...sheet,file,saved}:sheet));refresh();}return file;}catch(e){setSaveError(e.message);}};
 const closeSheet=async(chosen)=>{try{let sheet=liveSheets.current.find(item=>item.page===chosen);if(!sheet)return;if(sheet.saved!==sheetSignature(sheet)&&(sheet.file||sheet.page.strokes.length||sheet.page.backdrop)){const choice=await window.notemind.closeSheetChoice(sheet.name);if(choice==='cancel')return;if(choice==='save'){sheet=liveSheets.current.find(item=>item.page===chosen);if(!sheet)return;const saved=sheetSignature(sheet),data=sheetsSnapshot()[liveSheets.current.findIndex(item=>item.page===chosen)],prepared=prepareSheetSave(data,chosen),result=prepared&&typeof prepared.then==='function'?await prepared:prepared,file=await window.notemind.savePane(result.data,result.svg,sheet.file);if(!file)return;setSheets(old=>old.map(item=>item.page===chosen?{...item,file,saved}:item));const latest=liveSheets.current.find(item=>item.page===chosen);if(latest&&sheetSignature(latest)!==saved){setSaveError('The drawing changed while saving and remains open.');return;}}}const selected=page.current,next=liveSheets.current.filter(item=>item.page!==chosen);setSheets(old=>old.filter(item=>item.page!==chosen));setActive(Math.max(0,next.findIndex(item=>item.page===selected)));setBox(null);}catch(error){setSaveError(error.message);}};

 const openSheet=async()=>{try{const opened=await window.notemind.openPane();if(!opened)return;if(!validSheets([opened.sheet]))throw Error('Invalid drawing sheet');const p=new TabletPage(opened.sheet.aspect);p.strokes=opened.sheet.strokes;p.restoreExtent(opened.sheet.extent);p.backdrop=opened.sheet.backdrop||null;const item={name:opened.sheet.name,page:p,paper:opened.sheet.paper||paper(),file:opened.file};item.saved=sheetSignature(item);setSheets(old=>[...old,item]);setActive(sheets.length);setSource('tablet');}catch(e){setSaveError(e.message)}};

 const openPicture=async()=>{const image=await window.notemind.image();if(!image)return;const ext=image.name.split('.').pop().toLowerCase(),mime=({svg:'image/svg+xml',jpg:'image/jpeg',jpeg:'image/jpeg'})[ext]||'image/'+ext;window.dispatchEvent(new CustomEvent('tablet-edit-image',{detail:{url:'data:'+mime+';base64,'+image.data}}));};

 const saveOriginal=async()=>{try{const chosen=page.current,binding=chosen.target,originalName=binding?.assetName,snapshot=captureDrawing(true);if(!snapshot.target)return;const dense=denseDrawing(snapshot),result=dense?await denseAssets(snapshot,chosen,{crop:true,png:true}):{data:(await selectionPng(true,true,snapshot)).split(',')[1]};if(chosen.target!==binding||binding?.assetName!==originalName)throw Error('The original drawing changed while this update was preparing. Try Update again.');const accepted=window.dispatchEvent(new CustomEvent('tablet-replace',{cancelable:true,detail:{target:snapshot.target,name:'assets/edited-'+Date.now()+'.png',data:result.data,...(dense?{sidecar:result.sidecar}:{sheet:editableSheet(true,snapshot)})}}));if(accepted&&chosen.target===binding&&binding.assetName===originalName)chosen.target=snapshot.target;}catch(error){setSaveError(error.message);}};

 useEffect(()=>{const hear=e=>{const id=e.detail;if(id.startsWith('pen:'))runPenAction(id.slice(4));if(id==='source:tablet'||id==='source:camera'){setDocumentId(null);setSource(id.slice(7));if(document.getElementById('pane').hidden)document.getElementById('paneToggle').click();}if(id==='inputOff'){setDocumentId(null);setSource('off');}if(id.startsWith('cameraAspect:'))window.dispatchEvent(new CustomEvent('notemind-input',{detail:{aspect:id.slice(13)}}));if(id==='cameraRefresh')window.dispatchEvent(new CustomEvent('notemind-input',{detail:{refresh:true}}));if(id==='penSettings')setPenSheet(true);if(id==='exportDrawing'){const snapshot=captureDrawing(),preview=drawingPreview(false,page.current,snapshot);if(preview&&typeof preview.then==='function')void preview.then(data=>data&&window.notemind.exportImage(data,'svg')).catch(error=>setSaveError(error.message));else if(preview)void window.notemind.exportImage(preview,'svg');}};window.addEventListener('notemind-command',hear);return()=>window.removeEventListener('notemind-command',hear);},[source,active,box,revision]);

 const buttons={erase:()=>{if(!box)return; page.current.replace(outsideSelection(page.current.strokes,box)); refresh();},bring:insert,picture:()=>insertPicture(false),copy:copyDrawing,text:reader?()=>readText(false):undefined,bringOff:null};

 const closeDocument=path=>{const at=documents.findIndex(d=>d.path===path),remaining=documents.filter(d=>d.path!==path);setDocuments(remaining);if(documentId===path)setDocumentId(remaining[Math.min(at,remaining.length-1)]?.path||null)};
 if(!loaded)return <div className="tablet-pane"><div className="tablet-footer camera-foot">Loading sheets…</div></div>;

 return <PadHost><div className="tablet-pane camera"><ShellChrome source={source}/><PaneChrome slot="tabs">{(mirror,onPad)=><div className="sheet-tabs" role="toolbar" aria-label="Capture pane" data-sheets={documentId?"documents":""}><span id="video-options"><VideoControl source={source} visible={showing} documentActive={!!documentId} documentId={documentId} openDocuments={documents} onDocument={setDocumentId}/></span><div className="sheet-scroll" role="tablist" aria-label={documentId?"Documents":"Sheets and camera pages"} onWheel={e=>{e.currentTarget.scrollLeft+=e.deltaY;}}><div id="camera-tabs" hidden={!!documentId||source!=='camera'} ref={mirror?setMirrorCameraTabs:setCameraTabs}/>{!documentId&&source==='tablet'&&sheets.map((sheet,i)=><SheetTab key={i} name={sheet.name} dirty={(!!sheet.file||!!sheet.page.strokes.length||!!sheet.page.backdrop)&&sheet.saved!==sheetSignature(sheet)} selected={!documentId&&source==='tablet'&&active===i} onSelect={()=>{setDocumentId(null);setSource('tablet');setActive(i);setBox(null);}} onRename={name=>setSheets(old=>old.map((x,j)=>i===j?{...x,name}:x))} onClose={sheets.length>1?()=>closeSheet(sheet.page):undefined} onDragStart={e=>e.dataTransfer.setData('application/x-notemind-sheet',String(i))} onDrop={e=>{const raw=e.dataTransfer.getData('application/x-notemind-sheet');if(!raw)return;const from=Number(raw),selected=sheets[active],next=[...sheets];next.splice(i,0,...next.splice(from,1));setSheets(next);setActive(next.indexOf(selected));}}/>)}{documentId&&documents.map(d=><div key={d.path} role="tab" tabIndex={documentId===d.path?0:-1} aria-selected={documentId===d.path} data-doc-tab={d.path} data-doc-path={d.path} className={'sheet-tab doc'+(documentId===d.path?' on':'')} title={d.path+' (read-only)'} onClick={()=>setDocumentId(d.path)} onMouseDown={e=>{if(e.button===1)e.preventDefault()}} onAuxClick={e=>{if(e.button===1){e.preventDefault();closeDocument(d.path)}}}><Icon name="doc" size={12}/><span className="name">{d.name}</span><button tabIndex={documentId===d.path?0:-1} className="sheet-close" data-doc-close={d.path} aria-label={'Close '+d.name} title="Close this document" onClick={e=>{e.stopPropagation();closeDocument(d.path)}}><Icon name="close" size={10}/></button></div>)}</div><button hidden={!!documentId||source==='off'} className="bar-btn sheet-add" title={source==='camera'?'New camera tab':'New drawing sheet'} onClick={()=>{if(source==='camera'){window.dispatchEvent(new CustomEvent('camera-action',{detail:'newTab'}));return;}setSheets(old=>[...old,{name:'Sheet '+(old.length+1),page:new TabletPage(1/A5_ASPECT)}]);setActive(sheets.length);setBox(null);}}><Icon name="plus"/></button><button className="bar-btn pane-hide" aria-label={!mirror&&onPad?"Close tablet window":"Hide capture pane"} title={!mirror&&onPad?"Close tablet window":"Hide capture pane"} onClick={closeCapture}><Icon name="close"/></button></div>}</PaneChrome><PaneChrome slot="pen"><div id="pen-control" className="pen-bar" role="toolbar" aria-label="Pen controls"><PenControl colour={colour} width={width} onColour={setColour} onWidth={setWidth} presets={{controller:toolPresetController,state:toolPresetState}} presetsEnabled={showing&&!documentId&&source==='tablet'} onError={setSaveError}/></div></PaneChrome>{penSheet&&<PenSheet at={{top:76,right:16}} onClose={()=>setPenSheet(false)}/>} <CameraWorkspace rescan={rescan!==null} onRescan={url=>{const s=sheets[rescan];if(s){s.page.backdrop=url;setActive(rescan);setSource('tablet');refresh();}setRescan(null);}} tabsTarget={[cameraTabs,mirrorCameraTabs].filter(Boolean)} onActivate={()=>{setDocumentId(null);setSource('camera');setBox(null)}} active={!documentId&&source==='camera' && showing} colour={colour} width={width} onClose={()=>document.getElementById('paneToggle').click()}/>{documents.map(d=><DocumentWorkspace key={d.path} doc={d} active={documentId===d.path} onClose={()=>closeDocument(d.path)} colour={colour} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}/>)}{!documentId&&source==='off'&&<><PaneChrome slot="header"><div className="bar-row camera-head empty"><span className="grow"/><button className="bar-btn" aria-label="Put the pane away" title="Hide capture pane" onClick={()=>document.getElementById('paneToggle').click()}><Icon name="close"/></button></div></PaneChrome><div className="camera-body" data-pad-content><div className="placeholder"><div className="title">What should this pane show?</div><div className="detail">A document camera, the Wacom tablet as a sheet, or nothing.</div><div className="source-cards"><button className="source-card" title="Write or draw on a tablet sheet" onClick={()=>setSource('tablet')}><Icon name="tablet" size={22}/><span className="name">Tablet sheet</span><span className="sub">write with the pen</span></button><button className="source-card" title="Capture a page or picture with a camera" onClick={()=>setSource('camera')}><Icon name="camera" size={22}/><span className="name">Camera</span><span className="sub">point it at a page</span></button></div><div className="source-links"><button title="Find connected cameras" onClick={()=>setSource('camera')}>Refresh devices</button><button title="Hide capture pane" onClick={()=>document.getElementById('paneToggle').click()}>Hide this pane</button></div></div></div><PaneChrome slot="footer"><div className="camera-foot"><span className="line">Choose an input device</span></div></PaneChrome></>}{!documentId&&source==='tablet' && <><PaneChrome slot="header"><TabletHeader canUndo={page.current.canUndo} undoTitle="Take back the last stroke" onUndo={()=>{page.current.undo();surface.current?.repaint();refresh()}} canClear={!!page.current.strokes.length} onClear={()=>{page.current.clear();surface.current?.repaint();refresh()}} to={bringTo} onBringTo={setBringTo} bringTitle={bringTo==='text'?'Read the writing as text':'Bring the writing into the Notepad'} bringOff={null} onBring={to=>to==='text'?readText(false):insert()} onBringPage={()=>insertPicture(true)} onBringSheetText={()=>readText(true)} reader={reader} textOff={reading?'Reading…':null} files={{save:()=>saveSheet(),saveAs:()=>saveSheet(true),open:openSheet,file:sheets[active].file||null,dirty:sheets[active].saved!==sheetSignature(sheets[active]),rescan:page.current.backdrop?()=>{setRescan(active);setSource('camera');}:null,picture:page.current.target||page.current.backdrop?{saveOriginal:page.current.target?saveOriginal:null,saveNew:async()=>{const png=await selectionPng(true,true);await window.notemind.exportImage(png.split(',')[1],'png')}}:null,keptNote:!!sheets[active].keptNote,keptProject:!!sheets[active].keptProject,canKeepNote:true,canKeepProject:true,onKeep:async(to,on)=>{const chosen=sheets[active].page;if(to==='note'){if(on){const snapshot=captureDrawing(true),insertion=window.NoteMindNotes?.captureInsertion();let svg,sidecar;if(denseDrawing(snapshot)){const result=await denseAssets(snapshot,chosen,{crop:true});svg=result.data;sidecar=result.sidecar;}else{const preview=drawingPreview(true,chosen,snapshot);svg=(preview&&typeof preview.then==='function'?await preview:preview)||btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');}const accepted=window.dispatchEvent(new CustomEvent('notemind-keep-drawing',{cancelable:true,detail:{...(sidecar?{sidecar}:{sheet:editableSheet(true,snapshot)}),svg,insertion}}));if(!accepted)return;}setSheets(old=>old.map(sheet=>sheet.page===chosen?{...sheet,keptNote:on}:sheet));}else{if(on){const file=await saveSheet();if(!file)return;window.dispatchEvent(new CustomEvent('notemind-keep-file',{detail:file}));}setSheets(old=>old.map(sheet=>sheet.page===chosen?{...sheet,keptProject:on}:sheet));}refresh();}}} onHide={()=>document.getElementById('paneToggle').click()} showEditor={showEditor} onToggleEditor={()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'toggleEditor'}))}/></PaneChrome><div className="tablet-stage" data-pad-content><TabletSurface ref={surface} page={page.current} colour={colour} width={width} box={box} onBox={setBox} onEdited={refresh} buttons={buttons}/></div><PaneChrome slot="footer"><div className="tablet-footer camera-foot"><span className="line" role="status">{saveError||''}</span></div></PaneChrome></>}</div></PadHost>

}

createRoot(document.getElementById('tablet-root')).render(<App/>);



