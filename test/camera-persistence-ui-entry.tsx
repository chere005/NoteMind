import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CameraWorkspace} from '../src/tablet/renderer/CameraWorkspace'
import {CameraPersistence} from '../src/camera-persistence.js'
import {CameraPictures} from '../src/camera-pictures.js'
const load=CameraPersistence.prototype.load,save=CameraPersistence.prototype.save,run=CameraPictures.prototype.run
CameraPersistence.prototype.load=async function(...args){window.fixturePersistence=this;window.fixtureModels=this.models;return load.apply(this,args)}
CameraPersistence.prototype.save=function(...args){if(window.fixtureHoldAutosaves)return Promise.resolve({fixtureHeld:true});return save.apply(this,args)}
CameraPictures.prototype.run=function(job){window.fixturePictures=this;return run.call(this,job)}
let host
function Fixture(){const[active,setActive]=useState(false);window.fixtureSetActive=setActive;return <CameraWorkspace rescan={false} onRescan={()=>{}} colour="#112233" width={3} onClose={()=>setActive(false)} onActivate={()=>setActive(true)} tabsTarget={[document.getElementById('tabs')]} active={active}/>}
window.fixtureMount=()=>{host=createRoot(document.getElementById('root'));host.render(<Fixture/>)}
window.fixtureUnmount=()=>{host?.unmount();host=null}
window.fixtureFlush=async()=>{const detail={promises:[]};dispatchEvent(new CustomEvent('camera-flush',{detail}));await Promise.all(detail.promises)}
window.fixtureView=()=>({ids:fixtureModels.current.map(row=>row.pageId),names:fixtureModels.current.map(row=>row.name),loaded:fixtureModels.current.filter(row=>row.loaded!==false).map(row=>row.pageId),strokeCounts:fixtureModels.current.map(row=>row.page.strokes.length),activeId:fixtureModels.current.find(row=>row.page===fixturePersistence.getActive())?.pageId,decoded:window.fixturePictures?.stats(),errors:window.fixtureErrors})
window.fixtureMount()
