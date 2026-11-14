const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const format=require('./notepad-format.cjs'),graphics=require('./graphics-pane.js'),{atomic,digest}=require('./notes-store.cjs');

function referencePDF(){
 const pages=[['A reference beside your notes','This PDF is attached inside the welcome Notepad.','Use the document pane to zoom, search, and select a region.'],['Bring useful parts into your writing','Select text or a picture region, then insert it into a Notepad.','The original reference stays unchanged.']];
 const stream=lines=>{const text='BT /F1 20 Tf 48 760 Td '+lines.map((line,i)=>(i?'0 -36 Td /F1 14 Tf ':'')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET';return '<< /Length '+Buffer.byteLength(text)+' >>\nstream\n'+text+'\nendstream';};
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',stream(pages[0]),'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',stream(pages[1]),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let data='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});const xref=Buffer.byteLength(data);data+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(data);
}
function document(){
 const stroke=(colorHex,points)=>({colorHex,width:7,points:points.map(([x,y])=>({x,y}))});
 const strokes=[stroke('#2d7dd2',[[.16,.72],[.16,.25],[.38,.72],[.38,.25]]),stroke('#16a085',[[.53,.48],[.62,.70],[.84,.25]]),stroke('#d88a20',Array.from({length:30},(_,i)=>[.16+i*.024,.86+Math.sin(i*.45)*.025]))];
 const sheet={name:'Welcome sketch',aspect:2.5,backdrop:null,strokes};
 const ink='assets/welcome-ink.svg',pdf='assets/example-reference.pdf',bytes=referencePDF();
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360"><rect width="900" height="360" fill="white"/>'+strokes.map(s=>'<polyline fill="none" stroke="'+s.colorHex+'" stroke-width="'+s.width*.9+'" stroke-linecap="round" stroke-linejoin="round" points="'+s.points.map(p=>(p.x*900).toFixed(1)+','+(p.y*360).toFixed(1)).join(' ')+'"/>').join('')+'</svg>';
 const text=[
  '# Welcome to NoteMind','',
  'A place for words, pictures, ink, and the references you are working from.','',
  'This page is a real, editable Notepad. Try the examples below. Your edits are kept; Help → Welcome to NoteMind opens this page again.','',
  '## What you can do','',
  '- **Write and format:** headings, bold, italic, underline, highlights, quotes, code, lists, and tables.',
  '- **Use Markdown:** the eye switches between the rendered page and its Markdown source.',
  '- **Draw:** write, erase, select, move, and resize ink; insert an editable drawing into a Notepad.',
  '- **Capture:** bring in a camera image or recognized writing, and combine scans into a PDF.',
  '- **Read beside your notes:** open PDF, Word, and image references in the capture pane; insert useful regions.',
  '- **Keep originals:** attach files inside a Notepad, crop or rotate pictures, and export to PDF or Word.',
  '- **Organize:** tabs, projects, folders, tags, pinned Notepads, saved filters, and full-text search.',
  '- **Recover:** autosave, recovered drafts, version history, Recently Deleted, and undo for file actions.',
  '- **Run Python files:** create a separate Notepad, save it as `.py`, and choose Tools → Run Python.','',
  '## Try writing','',
  '**Bold**, *italic*, <u>underline</u>, ~~strikethrough~~, ==highlight==, and `inline code` all work on the rendered page. Select some words and try the formatting bar.','',
  '> Keep a thought, a picture, and the source that helped you understand it together.','',
  '### A checklist you can actually use','',
  '- [ ] Tick this box.',
  '- [ ] Change a table cell below.',
  '- [ ] Open the example drawing.',
  '- [x] Open the welcome Notepad.','',
  'Lists can be nested:','',
  '- An idea',
  '    - A useful detail',
  '- The next idea','',
  '1. Capture something.',
  '2. Put it in your own words.',
  '3. Keep the reference nearby.','',
  '### An editable table','',
  '| Task | Next step | Status |',
  '| --- | --- | --- |',
  '| Sketch an idea | Add a drawing | Ready |',
  '| Read a reference | Open the attachment below | Ready |',
  '| Make it yours | Edit this cell | Try it |','',
  'Click a cell and type. Tab moves through the table; its menu adds or removes rows and columns.','',
  '### Code stays readable','',
  '```python','ideas = ["write", "draw", "connect"]','for idea in ideas:','    print(idea)','```','',
  'This block demonstrates Python syntax highlighting. Choose its language button to try another language, or use Plain Text. Tab indents, Return continues indentation, and Command/Ctrl+Return leaves the block. Python runs from a separate saved `.py` file, using Tools → Run Python.','',
  '## Try an editable drawing','',
  '![Editable pen strokes]('+ink+')','',
  'Choose **Edit in Wacom** on this drawing to open its real pen strokes in the capture pane. Try Pen, Eraser, or Select. Select ink and drag it; use Undo to take a change back. **Save to Original** updates this drawing.','',
  'Paper and orientation have their own controls. The screen icon switches **In this window** and **Wacom screen** when a pen display is available. The duplicate pane in the main window works with the mouse: draw, select, move, resize, and erase there while the pen stays near the Wacom. Edited pictures fill the available area at their original aspect ratio; saved drawings retain their page shape.','',
  '## Keep a reference beside your writing','',
  '[Example reference — two-page PDF]('+pdf+')','',
  'Click the attached PDF to open it beside this page. Try page navigation, zoom, or search. Select a region to bring text or a picture into your notes. The original attachment stays inside this Notepad.','',
  '| Capture source | What to try |',
  '| --- | --- |',
  '| Drawing | Pen, Eraser, Select, paper, and orientation |',
  '| Camera | Hold a frame, find the page, annotate, and insert |',
  '| Document | Open PDF, Word, or an image; select the useful part |','',
  'Use the capture source menu at the top of the right pane. Open references remain available when you switch sources.','',
  '## Find, organize, and keep your work','',
  '- The sidebar’s **+** makes a Notepad; its arrow makes a section. The pencil shows duplicate and delete controls.',
  '- A row’s **⋯** menu renames, duplicates, moves, or deletes that item. **Remove from Project** keeps the file on disk.',
  '- **Notepads options** in the sidebar has search filters, sorting, Smart Folders, and Recently Deleted.',
  '- The project name at the foot of the sidebar manages file and folder links and separate project windows.',
  '- **Notepad options** beside the tabs has Save, Export, Find, tags, attachments, and version history.',
  '- The footer shows readable word count and zoom. Each tab remembers where you left it.','',
  'Edits autosave. Save As chooses a visible `.nm` file. Recently Deleted restores deleted Notepads and drafts. Keep your own work in a new Notepad, or duplicate this page to use it as a starting point.','',
  '## Keep exploring','',
  'Help → **Quick Reference** explains the controls in more detail. Help → **Keyboard Shortcuts** lists the keys for this computer and lets you search them.','',
  'Try the eye to see the Markdown behind this page, then switch it back on to keep writing here.','',
 ].join('\n');
 return {id:randomUUID(),title:'Welcome to NoteMind',text,assets:{[ink]:Buffer.from(svg).toString('base64'),[ink+'.json']:Buffer.from(graphics.encode(sheet)).toString('base64'),[pdf]:bytes.toString('base64')},meta:{tags:['Guide'],graphicsPanes:{[ink]:{version:1}},attachments:{[pdf]:{title:'Example reference.pdf',bytes:bytes.length,pages:2,text:'A reference beside your notes. Bring useful parts into your writing.'}}}};
}
let pending=Promise.resolve();
function ensure({directory,stateFile,version,preserve=false,blocked=[]}){
 const task=pending.catch(()=>{}).then(async()=>{
  await fs.mkdir(directory,{recursive:true});let state;try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const allowed=file=>path.dirname(path.resolve(file))===path.resolve(directory)&&!blocked.some(p=>p&&path.resolve(p).toLowerCase()===path.resolve(file).toLowerCase());
  if(state?.file&&allowed(state.file))try{
   const bytes=await fs.readFile(state.file);
   if(!preserve&&state.version!==version&&state.hash===digest(bytes)){const old=format.decode(bytes),next=document();await atomic(state.file,format.encode({...next,id:old.id,created:old.created}));state={file:state.file,version,hash:digest(await fs.readFile(state.file))};await atomic(stateFile,JSON.stringify(state));}
   return state.file;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const bytes=format.encode(document());
  for(let n=1;;n++){const file=path.join(directory,'Welcome to NoteMind'+(n===1?'':' '+n)+'.nm');if(!allowed(file))continue;try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(error){if(error.code==='EEXIST')continue;throw error;}await atomic(stateFile,JSON.stringify({file,version,hash:digest(bytes)}));return file;}
 });pending=task;return task;
}
module.exports={document,ensure,referencePDF};
