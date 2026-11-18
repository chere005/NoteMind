import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {create as createSync} from '../src/document-sync.js';
import {create as createUpload} from '../src/document-asset-upload.js';
import {toMarkdown} from '../src/document-renderer.cjs';
import {PDFReferenceView} from '../src/pdf-reference-views.cjs';
import {PDFReferenceWorkspace} from '../src/tablet/renderer/PDFReferenceWorkspace';
import '../src/tablet/renderer/camera.css';
import '../src/tablet/renderer/document.css';
import '../src/tablet/renderer/pane.css';
import '../src/tablet/renderer/toolbar.css';
window.NoteMindDocumentSync=createSync({invoke:packet=>window.notemind.documentCall(packet),uuid:()=>crypto.randomUUID(),transfer:createUpload(window.notemind.documentAssets)});
window.testMarkupTransport='scoped-raw-assets';
window.testCloseCalls=[];const closeView=PDFReferenceView.prototype.close;PDFReferenceView.prototype.close=function(){window.testCloseCalls.push({key:this.key,closed:this.closed,hasActions:!!this.actions});return closeView.call(this);};
window.testImports=[];window.testOwner={tab:{id:'A',doc:{id:'A',title:'Fixture',created:'2026-01-01T00:00:00.000Z',path:null,text:'',assets:{},meta:{}}}};
window.NoteMindPDFReferences={isOwnerOpen:()=>window.testOwnerOpen!==false};
const imported=value=>{window.testImports.push(value);if(window.testCancelAt&&window.testImports.length===window.testCancelAt)document.querySelector('[title="Cancel after the current completed page"]')?.click();};
window.NoteMindNotes={captureInsertion:()=>({tab:window.testOwner.tab,text:window.testOwner.tab.doc.text,start:window.testOwner.tab.doc.text.length,end:window.testOwner.tab.doc.text.length,range:null}),insertTextFor:(owner,text)=>{if(window.testOwnerOpen===false)throw Error('The original Notepad is no longer open.');imported({owner:owner.tab.id,text})},insertAssetFor:(owner,name,data)=>{if(window.testOwnerOpen===false)throw Error('The original Notepad is no longer open.');imported({owner:owner.tab.id,name,data})},flush:async()=>{},createPageImport:(target,{createPageImport})=>{
 let revision=0;const readState=()=>({tab:target.tab,document:target.tab.doc,revision,text:target.tab.doc.text,assets:target.tab.doc.assets,meta:target.tab.doc.meta,visual:false});
 return createPageImport({target,document,serialize:toMarkdown,root:()=>null,range:()=>null,readState,readStamp:()=>readState(),projectDocument:value=>({...value,dirty:true,visual:false}),publish:plan=>{if(window.testOwnerOpen===false)throw Error('The original Notepad is no longer open.');Object.assign(target.tab.doc,plan.document);revision++;const assets=Object.entries(plan.add);if(assets.length)for(const[name,data]of assets)imported({owner:target.tab.id,name,data});else imported({owner:target.tab.id,text:plan.pageNodes.map(node=>node.textContent).join('\n')});}});
}};

function Fixture(){const [active,setActive]=useState(true);window.testSetActive=setActive;return <PDFReferenceWorkspace doc={{path:window.notemind.testSource,name:'PDF fixture'}} active={active} colour="#e02020" width={6} showEditor onToggleEditor={()=>{}} onClose={()=>window.NoteMindPDFReferenceViews.close(window.notemind.testSource)}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
