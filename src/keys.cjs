// The editing shortcuts in one table: main builds the Format menu from it and the shortcut list reads it.
// `key` is an Electron accelerator; `mac` replaces it on macOS where Ctrl+<key> would collide with a system shortcut.
const table=[
 {id:'fmtBold',label:'Bold',key:'CmdOrCtrl+B'},
 {id:'fmtItalic',label:'Italic',key:'CmdOrCtrl+I'},
 {id:'fmtUnderline',label:'Underline',key:'CmdOrCtrl+U'},
 {id:'fmtStrike',label:'Strikethrough',key:'CmdOrCtrl+Shift+X'},
 {id:'fmtCode',label:'Inline Code'},
 {id:'fmtHighlight',label:'Highlight'},
 '-',
 ...[1,2,3,4,5,6].map(n=>({id:'fmtHeading'+n,label:'Heading '+n,key:'CmdOrCtrl+'+n})),
 {id:'fmtBody',label:'Body',key:'CmdOrCtrl+7'},
 {id:'fmtQuote',label:'Quote',key:'CmdOrCtrl+Q',mac:'Ctrl+Cmd+Q'},
 {id:'fmtCodeBlock',label:'Code Block',key:'CmdOrCtrl+8'},
 {id:'fmtList',label:'Bulleted List',key:'CmdOrCtrl+Shift+L'},
 '-',
 {id:'fmtIndent',label:'Indent',key:'CmdOrCtrl+]'},
 {id:'fmtOutdent',label:'Outdent',key:'CmdOrCtrl+['},
 '-',
 {id:'moveSectionUp',label:'Move Section Up',key:'CmdOrCtrl+Up',mac:'Ctrl+Cmd+Up'},
 {id:'moveSectionDown',label:'Move Section Down',key:'CmdOrCtrl+Down',mac:'Ctrl+Cmd+Down'},
 {id:'foldAll',label:'Collapse All Headings',key:'CmdOrCtrl+Alt+Shift+Left'},
 {id:'unfoldAll',label:'Expand All Headings',key:'CmdOrCtrl+Alt+Shift+Right'},
 {id:'collapseSubsections',label:'Collapse Subsections',key:'CmdOrCtrl+;'}
];
const accelerator=(item,platform=process.platform)=>platform==='darwin'&&item.mac?item.mac:item.key;
const menu=(command,platform=process.platform)=>table.map(item=>item==='-'?{type:'separator'}:{label:item.label,...(accelerator(item,platform)?{accelerator:accelerator(item,platform)}:{}),click:command(item.id)});
module.exports={table,accelerator,menu};
