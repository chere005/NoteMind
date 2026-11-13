(() => {
 let restoring=false,batching=0;
 const state=tab=>({text:tab===activeTab?currentText():tab.doc.text,assets:{...tab.doc.assets},meta:structuredClone(tab.doc.meta||{})});
 function initialize(tab){if(tab&&!tab.textHistory)tab.textHistory={past:[],future:[],last:state(tab)};}
 function record(tab){initialize(tab);if(batching)return;const history=tab.textHistory,next=state(tab),last=history.last;
  const differs=last.text!==next.text||JSON.stringify(last.meta)!==JSON.stringify(next.meta)||Object.keys(last.assets).length!==Object.keys(next.assets).length||Object.keys(next.assets).some(n=>next.assets[n]!==last.assets[n]);
  if(differs&&!restoring){history.past.push(last);if(history.past.length>100)history.past.shift();history.future=[];}history.last=next;
 }
 function step(redo=false){const tab=activeTab;initialize(tab);const history=tab.textHistory,from=redo?history.future:history.past,to=redo?history.past:history.future;if(!from.length)return;to.push(state(tab));const next=from.pop();Object.assign(doc,{...next,assets:{...next.assets},meta:structuredClone(next.meta)});source.value=doc.text;rich.innerHTML=render(doc.text);richChanged=false;restoring=true;try{markDirty();}finally{restoring=false;}window.NoteMindWriting.decorate();window.NoteMindFind.refresh();}
 function command(redo){const focused=document.activeElement;if(focused===source||focused===rich||rich.contains(focused)||focused===document.body)step(redo);else document.execCommand(redo?'redo':'undo');}
 window.addEventListener('notemind-command',e=>{if(e.detail==='undoText')command(false);if(e.detail==='redoText')command(true);});
 document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const focused=document.activeElement;if(focused!==rich&&focused!==source&&!rich.contains(focused))return;const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();step(key==='y'||e.shiftKey);}});
 function transaction(run){initialize(activeTab);batching++;try{return run();}finally{batching--;if(!batching)record(activeTab);}}
 window.NoteMindHistory={initialize,record,step,transaction};
})();
