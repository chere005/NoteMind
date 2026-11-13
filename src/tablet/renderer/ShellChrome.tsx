import {FloatingMenu} from './FloatingMenu';
import {PaneDivider} from './PaneDivider';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icons';
import {MenuButton} from './MenuButton';
const toMenu=items=>items.map(item=>item==='-'?item:{...item,...(item.submenu?{submenu:toMenu(item.submenu)}:{}),...(item.run?{onClick:()=>Promise.resolve().then(item.run).catch(error=>window.alert(error.message))}:{})});
const click=id=>document.getElementById(id)?.click();
export function ShellChrome({source}){
 const [floating,setFloating]=useState(null),[visible,setVisible]=useState(!document.getElementById('pane').hidden);
 const dismissed=useRef({trigger:null,time:0}),serial=useRef(0);
 const close=reason=>{dismissed.current={trigger:reason==='toggle'?floating?.trigger:null,time:performance.now()};setFloating(null)};
 useEffect(()=>{
  const original=window.notemindMenu;
  const show=(items,x,y,options={})=>{if(options.trigger&&dismissed.current.trigger===options.trigger&&performance.now()-dismissed.current.time<100)return;setFloating({serial:++serial.current,x,y,...options,returnTo:document.activeElement,items:toMenu(items)})};
  window.notemindMenu=show;window.notemindFloatingMenu=show;
  const observer=new MutationObserver(()=>setVisible(!document.getElementById('pane').hidden));observer.observe(document.getElementById('pane'),{attributes:true,attributeFilter:['hidden']});
  return()=>{window.notemindMenu=original;delete window.notemindFloatingMenu;observer.disconnect()};
 },[]);
 useEffect(()=>{const trigger=floating?.trigger;if(!trigger)return;trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls','notemind-actions');return()=>{trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls')}},[floating]);
 const [sidebar,setSidebar]=useState(!document.getElementById('sidebar').hidden),[visual,setVisual]=useState(!document.getElementById('rich').hidden),[editing,setEditing]=useState(false),[count,setCount]=useState(1);
 useEffect(()=>{const update=()=>{setCount(document.querySelectorAll('.document-tab').length);setVisual(!document.getElementById('rich').hidden);setSidebar(!document.getElementById('sidebar').hidden)};const observer=new MutationObserver(update);observer.observe(document.getElementById('documentTabs'),{childList:true});observer.observe(document.getElementById('rich'),{attributes:true,attributeFilter:['hidden']});observer.observe(document.getElementById('sidebar'),{attributes:true,attributeFilter:['hidden']});return()=>observer.disconnect()},[]);
 const portal=(id,node)=>document.getElementById(id)?createPortal(node,document.getElementById(id)):null;
 return <>
  {floating&&<FloatingMenu key={floating.serial} {...floating} id="notemind-actions" onClose={close}/>}
  {portal('paneResize',<PaneDivider sidebar={sidebar}/>)}
  {portal('sidebar-buttons',<>
   <MenuButton icon="plus" name="New Notepad" title="New Notepad" optionsLabel="New Notepad options" dataBar="sidebar-new" onMain={()=>window.NoteMindSidebar?.newNotepad()} items={()=>toMenu(window.NoteMindSidebar?.newMenu()||[])}/>
   <button className={'bar-btn'+(editing?' tint':'')} data-sidebar="edit" title={editing?'Hide duplicate and delete controls':'Show duplicate and delete controls on Notepads'} aria-label={editing?'Done organizing':'Organize Notepads'} aria-pressed={editing} onClick={()=>{setEditing(!editing);window.dispatchEvent(new CustomEvent('sidebar-edit',{detail:!editing}))}}><Icon name={editing?'check':'edit'}/></button>
   <MenuButton icon="more" name="Notepads options" title="Notepads options" dataBar="sidebar-menu" items={()=>toMenu(window.NoteMindSidebar?.menuItems()||[])}/>
  </>)}
  {portal('tab-switches',<button className={'bar-btn'+(sidebar?' tint':'')} title={sidebar?'Hide Notepads sidebar':'Show Notepads sidebar'} aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded={sidebar} onClick={()=>click('sidebarToggle')}><Icon name="sidebar"/></button>)}
  {portal('editor-mode',<button className={'bar-btn editor-mode'+(visual?' tint':'')} title={visual?'Show Markdown source':'Show rendered page'} aria-label="Rendered view" aria-pressed={visual} onClick={()=>click(visual?'markdown':'visual')}><Icon name="eye"/></button>)}
  {portal('tab-new',<button hidden={sidebar} className="bar-btn tab-new" title="New Notepad" aria-label="New Notepad" onClick={()=>click('new')}><Icon name="plus"/></button>)}
  {portal('tab-list',<MenuButton icon="more" name="Notepad options" title="Save, find and manage the open Notepad" dataBar="notepad-menu" items={()=>[
   ...(window.NoteMindMenus?.noteItems()||[]),'-',
   {label:`Open Notepads (${count})`,submenu:Array.from(document.querySelectorAll('.document-tab>button:first-child')).map((button:HTMLButtonElement)=>({label:button.textContent||'Untitled',checked:button.getAttribute('aria-selected')==='true',onClick:()=>button.click()}))},
  ]}/>)}
  {portal('capture-toggle',<button className={'bar-btn'+(visible?' tint':'')} data-bar="capture-toggle" title={visible?'Hide capture pane':'Show drawing, camera or document pane'} aria-label="Toggle capture pane" aria-expanded={visible} aria-controls="pane" onClick={()=>click('paneToggle')}><Icon name="window"/></button>)}
 </>;
}
