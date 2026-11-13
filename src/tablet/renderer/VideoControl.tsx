import React,{useEffect,useState} from 'react';
import {MenuButton} from './MenuButton';
import {videoMenu} from './videoMenu';
import {useOrientation,setOrientation} from './orientation';
const command=id=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:id}));
const input=detail=>window.dispatchEvent(new CustomEvent('notemind-input',{detail}));
export function VideoControl({source,visible}){
 const [devices,setDevices]=useState([]),[device,setDevice]=useState(''),[notes,setNotes]=useState(!document.querySelector('main').hidden);const orientation=useOrientation();
 const refresh=()=>navigator.mediaDevices?.enumerateDevices().then(list=>setDevices(list.filter(d=>d.kind==='videoinput'))).catch(()=>{});
 useEffect(()=>{refresh();const receive=e=>{setDevice(e.detail.device);setDevices(e.detail.devices)};window.addEventListener('notemind-camera-device',receive);navigator.mediaDevices?.addEventListener('devicechange',refresh);const observer=new MutationObserver(()=>setNotes(!document.querySelector('main').hidden));observer.observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});return()=>{window.removeEventListener('notemind-camera-device',receive);navigator.mediaDevices?.removeEventListener('devicechange',refresh);observer.disconnect()}},[]);
 return <MenuButton icon="camera" tint={visible} name="Video" title="Show or hide video" onMain={()=>document.getElementById('paneToggle').click()} dataBar="video" caretDataBar="video-menu" menuBar="video-options" items={()=>videoMenu({platform:'win32',camera:visible,cameras:devices.map(d=>({id:d.deviceId,name:d.label||'Camera'})),cameraId:source==='tablet'?'tablet':source==='off'?null:device,notesPane:notes,orientation},{toggleVideo:()=>document.getElementById('paneToggle').click(),pick:id=>{command(id==='tablet'?'source:tablet':'source:camera');if(id!=='tablet')input({device:id})},off:()=>command('inputOff'),refresh:()=>{refresh();input({refresh:true})},turn:direction=>input({turn:direction==='turn-left'?'left':'right'}),orient:setOrientation,toggleNotesPane:()=>command('toggleEditor')})}/>;
}
