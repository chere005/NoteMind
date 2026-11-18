const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const source=fs.readFileSync(require.resolve('../src/tablet/renderer/CameraWorkspace.tsx'),'utf8'),effect=source.match(/useEffect\(\(\)=>\{const key=e=>\{[\s\S]*?\},\[cameraActive\]\);/)?.[0];
function fixture({active=true,modal=false,pad=false,field=false}={}){
 assert.ok(effect,'production camera Escape effect must remain exercised');let key;const overlay=domino.createWindow(modal==='pen'?'<div class="pen-pop" data-pen="sheet"></div>':modal?'<dialog open></dialog>':'').document,changes=[],main={querySelector:selector=>!pad?overlay.querySelector(selector):null,activeElement:null},owner=pad?{querySelector:selector=>overlay.querySelector(selector),activeElement:null}:main;
 const input={ownerDocument:owner,closest:()=>({}),isContentEditable:false};if(field)owner.activeElement=input;
 const context={cameraActive:active,stage:{current:{ownerDocument:owner}},document:main,useEffect:run=>run(),window:{addEventListener:(name,callback)=>{assert.equal(name,'keydown');key=callback},removeEventListener(){}},setBox:value=>changes.push(['box',value]),setCorners:value=>changes.push(['corners',value]),setZoomArmed:value=>changes.push(['zoomArmed',value]),setZoom:value=>changes.push(['zoom',value]),setHeld:value=>changes.push(['held',value])};
 vm.runInNewContext(effect,context);return{changes,input,owner,key:event=>key({key:'Escape',...event})};
}
test('dialog, field, consumed and composition Escape cannot discard camera state',()=>{
 for(const event of [{defaultPrevented:true},{isComposing:true},{keyCode:229}]){const f=fixture();f.key(event);assert.deepEqual(f.changes,[])}
 const field=fixture();field.key({target:field.input});assert.deepEqual(field.changes,[]);
 const editable=fixture();editable.key({target:{ownerDocument:editable.owner,isContentEditable:true,closest:()=>null}});assert.deepEqual(editable.changes,[]);
 for(const pad of [false,true]){for(const overlay of [true,'pen']){const modal=fixture({modal:overlay,pad});modal.key({});assert.deepEqual(modal.changes,[])}const forwarded=fixture({pad,field:true});forwarded.key({});assert.deepEqual(forwarded.changes,[])}
});
test('ordinary and PadHost-forwarded camera Escape still clear the camera view once',()=>{
 for(const pad of [false,true]){const f=fixture({pad});f.key({});assert.deepEqual(f.changes,[['box',null],['corners',null],['zoomArmed',false],['zoom',null],['held',null]])}
 const inactive=fixture({active:false});inactive.key({});assert.deepEqual(inactive.changes,[]);const other=fixture();other.key({key:'Enter'});assert.deepEqual(other.changes,[]);
});
