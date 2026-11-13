// Every shortcut the app answers to, for the F1 list and the Quick Reference: read from the real application menu, so a new
// menu shortcut shows up by itself, plus the few keys the page handles on its own.
const names={CmdOrCtrl:['Ctrl','⌘'],CommandOrControl:['Ctrl','⌘'],Cmd:['⌘','⌘'],Command:['⌘','⌘'],Ctrl:['Ctrl','⌃'],Control:['Ctrl','⌃'],Alt:['Alt','⌥'],Option:['Alt','⌥'],Shift:['Shift','⇧'],Up:['Up','↑'],Down:['Down','↓'],Left:['Left','←'],Right:['Right','→']};
function display(accelerator,platform=process.platform){
 const mac=platform==='darwin',parts=String(accelerator).split('+').map(part=>names[part]?names[part][mac?1:0]:part);
 return parts.join(mac?'':'+');
}
const extras=[
 {group:'Tabs',label:'Next / previous tab',keys:'Ctrl+Tab / Ctrl+Shift+Tab'},
 {group:'Tabs',label:'Reopen closed tab',keys:'Ctrl+Shift+T'},
 {group:'Drawing',label:'Erase tool / Select tool',keys:'Ctrl+Alt+2 / 3'},
 {group:'Drawing',label:'Next / previous colour',keys:'Ctrl+Alt+4 / 5'},
 {group:'Drawing',label:'Thinner / wider line',keys:'Ctrl+Alt+6 / 7'},
 {group:'Drawing',label:'Send drawing / picture',keys:'Ctrl+Alt+8 / 9'}
];
function fromMenu(menu,platform=process.platform){
 const found=[];
 const walk=(items,group)=>{for(const item of items){if(item.submenu)walk(item.submenu.items,group);else if(item.accelerator&&item.label)found.push({group,label:item.label.replace(/…$/,'…'),keys:display(item.accelerator,platform)});}};
 // The macOS application menu (Hide, Quit…) is the system's, not NoteMind's.
 for(const top of menu?.items||[])if(top.submenu&&top.label&&!/^appmenu$/i.test(top.role||''))walk(top.submenu.items,top.label);
 return found;
}
const list=(menu,platform)=>[...fromMenu(menu,platform),...extras];
function markdown(entries){
 const groups=[...new Set(entries.map(entry=>entry.group))];
 return groups.map(group=>'### '+group+'\n\n'+entries.filter(entry=>entry.group===group).map(entry=>'- '+entry.keys+' — '+entry.label).join('\n')).join('\n\n');
}
module.exports={display,fromMenu,list,markdown,extras};
