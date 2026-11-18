import {useEffect,useState} from 'react';
import {MenuButton} from './MenuButton';
import {usePadLocation} from './DrawingLocation';
import {watchCameraDevices} from '../../camera-device-watch.cjs';
const command=detail=>window.dispatchEvent(new CustomEvent('notemind-command',{detail}));
const input=detail=>window.dispatchEvent(new CustomEvent('notemind-input',{detail}));
export function VideoControl({source,visible,documentActive=false,documentId=null,openDocuments=[],onDocument}){
 const [devices,setDevices]=useState([]),[device,setDevice]=useState(''),[scanning,setScanning]=useState(false),[editor,setEditor]=useState(!document.querySelector('main').hidden);
 const refresh=()=>{if(!navigator.mediaDevices)return;setScanning(true);navigator.mediaDevices.enumerateDevices().then(list=>setDevices(list.filter(item=>item.kind==='videoinput'))).catch(()=>setDevices([])).finally(()=>setScanning(false));};
 useEffect(()=>watchCameraDevices(()=>navigator.mediaDevices,visible&&!documentActive&&source==='camera',()=>setDevices([])),[source,visible,documentActive]);
 useEffect(()=>{const receive=event=>{setDevice(event.detail.device);setDevices(event.detail.devices)};window.addEventListener('notemind-camera-device',receive);const observer=new MutationObserver(()=>setEditor(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>{window.removeEventListener('notemind-camera-device',receive);observer.disconnect()}},[]);
 const pad=usePadLocation();
 const label=documentActive?'Document':source==='tablet'?'Drawing':source==='camera'?'Camera':'Capture';
 return <MenuButton icon={documentActive?'doc':source==='tablet'?'pen':'camera'} label={label} chevron name="Capture source" title="Choose drawing, camera or a document" dataBar="video-menu" menuBar="video-options" onOpen={refresh} live items={()=>[
  {label:'Drawing',icon:'pen',checked:!documentActive&&source==='tablet',dataBar:'video-tablet',onClick:()=>command('source:tablet')},
  {label:'Camera',icon:'camera',checked:!documentActive&&source==='camera',dataBar:'video-camera',onClick:()=>command('source:camera')},
  ...(openDocuments.length?[{label:'Open Documents',submenu:openDocuments.map(item=>({label:item.name,checked:(item.key||item.path)===documentId,onClick:()=>onDocument(item.key||item.path)}))}]:[]),
  {label:'Open Document…',icon:'doc',onClick:()=>document.getElementById('open').click()},'-',
  {label:'Camera Device',submenu:devices.length?devices.map(item=>({label:item.label||'Camera',checked:item.deviceId===device||(!device&&item===devices[0]),onClick:()=>{command('source:camera');input({device:item.deviceId})}})):[{label:scanning?'Finding cameras…':'No cameras found',disabled:true}]},
  {label:'Refresh Devices',dataBar:'video-refresh',onClick:()=>{refresh();input({refresh:true})}},'-',
  {label:'Use Wacom Screen',checked:pad.wacom,disabled:pad.busy||!pad.available,dataBar:'video-wacom',onClick:pad.toggle},
  {label:'Show Editor',checked:editor,dataBar:'video-only',onClick:()=>command('toggleEditor')},
  {label:'Hide Capture Pane',dataBar:'video-show',onClick:()=>document.getElementById('paneToggle').click()},
 ]}/>;
}
