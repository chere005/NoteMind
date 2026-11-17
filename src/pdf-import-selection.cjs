const {pageNumbers}=require('./scan-page-selection.js');
const {encodedSize}=require('./asset-admission.js');
const cancelled=()=>Object.assign(Error('PDF import cancelled.'),{name:'AbortError'});
function choosePDFPages({document,count,page=1,signal}){
 if(!Number.isSafeInteger(count)||count<1||count>10000||!Number.isInteger(page)||page<1||page>count)return Promise.reject(Error('Invalid PDF page selection.'));
 if(signal?.aborted)return Promise.reject(cancelled());
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h2'),label=document.createElement('label'),input=document.createElement('input'),error=document.createElement('p'),actions=document.createElement('div');let settled=false;
  dialog.className='shell-dialog notes-dialog pdf-import-dialog';dialog.setAttribute('aria-label','Import PDF pages');heading.textContent='Import PDF pages';label.textContent='Pages';input.type='text';input.value=count===1?'1':'1-'+count;input.placeholder='1-3, 8';input.setAttribute('aria-label','PDF page numbers or ranges');input.title='Page numbers or ranges, separated by commas';input.autofocus=true;error.className='notes-message';error.setAttribute('role','alert');actions.className='dialog-actions';label.append(input);form.append(heading,label,error,actions);dialog.append(form);
  const finish=(value,failure)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(dialog.open)dialog.close();dialog.remove();failure?reject(failure):resolve(value);},abort=()=>finish(null,cancelled());
  const button=(text,title,run,type='button')=>{const item=document.createElement('button');item.type=type;item.textContent=text;item.title=title;if(run)item.addEventListener('click',run);actions.append(item);return item;};
  button('Current page','Import only the current PDF page',()=>{input.value=String(page);error.textContent='';input.focus();});button('All pages','Import all PDF pages',()=>{input.value=count===1?'1':'1-'+count;error.textContent='';input.focus();});button('Cancel','Cancel PDF import',abort);button('Import','Import the selected PDF pages',null,'submit');
  form.addEventListener('submit',event=>{event.preventDefault();try{const pages=pageNumbers(input.value,count,{maximum:10000,kind:'PDF'});finish(pages);}catch(failure){error.textContent=failure.message;input.focus();}});dialog.addEventListener('close',()=>finish(null,cancelled()));signal?.addEventListener('abort',abort,{once:true});document.body.append(dialog);
  try{dialog.showModal();input.focus();input.select();if(signal?.aborted)abort();}catch(failure){finish(null,failure);}
 });
}
function documentAssetBytes(assets={},chunksFor=()=>null){let bytes=0;for(const name of Object.keys(assets))bytes+=encodedSize(assets[name],chunksFor(assets,name));return bytes;}
module.exports={choosePDFPages,documentAssetBytes};
