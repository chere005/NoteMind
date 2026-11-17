const fs=require('node:fs/promises');
const path=require('node:path');
const {render,toMarkdown,md,mime}=require('./document-renderer.cjs');
const mammoth=require('mammoth');
const D=require('docx');
const syntaxCSS=require('node:fs').readFileSync(path.join(__dirname,'syntax.css'),'utf8');
async function importWord(bytes,{signal}={}){
 const check=()=>{if(signal?.aborted)throw Object.assign(Error('Conversion cancelled.'),{name:'AbortError'});};check();
 const assets={};let count=0;
 const result=await mammoth.convertToHtml({buffer:bytes},{styleMap:['highlight => mark','u => u'],convertImage:mammoth.images.imgElement(async image=>{check();let ext=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/svg+xml':'svg','image/tiff':'tiff'})[image.contentType];if(!ext)throw Error('Unsupported Word image: '+image.contentType);let data=await image.read('base64');check();if(ext==='tiff'){data=require('./tiff-images.cjs').tiffToPng(Buffer.from(data,'base64')).toString('base64');ext='png';}const name='assets/word-image-'+(++count)+'.'+ext;assets[name]=data;return {src:name};})});
 check();return {path:null,text:toMarkdown(result.value),assets,warnings:result.messages.map(m=>m.message)};
}
function inline(tokens,assets,style={}){
 const output=[];let props={...style},link=null,stack=[];
 const add=run=>{if(link)output.push(new D.ExternalHyperlink({link,children:[run]}));else output.push(run)};
 for(const t of tokens||[]){if(t.type==='task_check'){add(new D.CheckBox({checked:t.meta.checked}));add(new D.TextRun(' '))}else if(t.type==='mark_open'){stack.push(props);props={...props,highlight:'yellow'}}else if(t.type==='u_open'){stack.push(props);props={...props,underline:{}}}else if(t.type==='strong_open'){stack.push(props);props={...props,bold:true}}else if(t.type==='em_open'){stack.push(props);props={...props,italics:true}}else if(t.type==='s_open'){stack.push(props);props={...props,strike:true}}else if(['strong_close','em_close','s_close','mark_close','u_close'].includes(t.type)){props=stack.pop()||style}else if(t.type==='link_open'){link=t.attrGet('href');const attachment=assets.__attachments?.[link];if(attachment){const preview=assets[attachment.thumbnail];link=null;if(preview){const width=Math.min(preview.width,300),height=width*preview.height/preview.width;add(new D.ImageRun({data:Buffer.isBuffer(preview.data)?preview.data:Buffer.from(preview.data,'base64'),type:preview.type||'png',transformation:{width,height}}));add(new D.TextRun({break:1}));}}}else if(t.type==='link_close'){link=null}else if(t.type==='text'||t.type==='code_inline'){add(new D.TextRun({...props,text:t.content,...(link?{style:'Hyperlink'}:{}),...(t.type==='code_inline'?{font:'Consolas',shading:{fill:'F3F3F3'}}:{})}))}else if(t.type==='softbreak'||t.type==='hardbreak'){add(new D.TextRun({...props,break:1}))}else if(t.type==='image'){
  const image=assets[t.attrGet('src')];if(!image)throw Error('Missing document image: '+t.attrGet('src'));const width=Math.min(image.width||500,560),height=width*(image.height||300)/(image.width||500);add(new D.ImageRun({data:Buffer.isBuffer(image.data)?image.data:Buffer.from(image.data,'base64'),type:image.type||'png',transformation:{width,height},altText:{title:t.content,description:t.content,name:t.content}}));
 }}return output;
}
async function exportWord(doc,images={},options={}){
 images={...images,__attachments:doc.meta?.attachments||{}};const tokens=md.parse(doc.text,{}),children=[],lists=[],numbering=[];let heading,quote=0,listInstance=0;
 for(let i=0;i<tokens.length;i++){const t=tokens[i];
  if(t.type==='heading_open')heading=Number(t.tag.slice(1));
  else if(t.type==='heading_close')heading=null;
  else if(t.type==='blockquote_open')quote++;
  else if(t.type==='blockquote_close')quote=Math.max(0,quote-1);
  else if(t.type==='bullet_list_open')lists.push({kind:'bullet'});
  else if(t.type==='ordered_list_open'){const reference='ordered-'+(++listInstance),level=Math.min(8,lists.length),start=t.attrGet('start')===null?1:Number(t.attrGet('start'));numbering.push({reference,levels:Array.from({length:9},(_,index)=>({level:index,start:index===level?start:1,format:D.LevelFormat.DECIMAL,text:'%'+(index+1)+'.',alignment:D.AlignmentType.START,style:{paragraph:{indent:{left:720*(index+1),hanging:260}}}}))});lists.push({kind:'number',reference});}
  else if(t.type==='bullet_list_close'||t.type==='ordered_list_close')lists.pop();
  else if(t.type==='inline')children.push(new D.Paragraph({children:inline(t.children,images),...(heading?{heading:D.HeadingLevel['HEADING_'+heading]}:{}),...(quote?{indent:{left:480*quote},border:{left:{color:'A0A0A0',size:12,style:D.BorderStyle.SINGLE,space:12}}}:{}),...(lists.length?lists.at(-1).kind==='bullet'?{bullet:{level:Math.min(8,lists.length-1)}}:{numbering:{reference:lists.at(-1).reference,instance:1,level:Math.min(8,lists.length-1)}}:{}),spacing:{after:120}}));
  else if(t.type==='fence'||t.type==='code_block')for(const line of t.content.trimEnd().split('\n'))children.push(new D.Paragraph({children:[new D.TextRun({text:line,font:'Consolas',size:20})],shading:{fill:'F3F3F3'},spacing:{after:0}}));
  else if(t.type==='hr')children.push(new D.Paragraph({border:{bottom:{color:'AAAAAA',space:1,style:D.BorderStyle.SINGLE,size:4}}}));
  else if(t.type==='table_open'){
   const rows=[];let row=[],alignment;
   for(++i;i<tokens.length&&tokens[i].type!=='table_close';i++){const q=tokens[i];if(q.type==='tr_open')row=[];if(q.type==='th_open'||q.type==='td_open'){const style=q.attrGet('style')||'';alignment=/text-align:\s*right/i.test(style)?D.AlignmentType.RIGHT:/text-align:\s*center/i.test(style)?D.AlignmentType.CENTER:undefined;}if(q.type==='inline')row.push(new D.TableCell({children:[new D.Paragraph({children:inline(q.children,images),...(alignment?{alignment}:{})})]}));if(q.type==='tr_close')rows.push(new D.TableRow({children:row,tableHeader:false}));}
   if(rows.length)children.push(new D.Table({rows,width:{size:100,type:D.WidthType.PERCENTAGE}}));
  }
 }
 const file=new D.Document({creator:'NoteMind',title:doc.title||'Notepad',styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:120}}}}},numbering:{config:numbering},sections:[{properties:{page:{size:options.pageSize==='A4'?{width:11906,height:16838}:{width:12240,height:15840},margin:{top:1080,right:1080,bottom:1080,left:1080}}},footers:{default:new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[new D.TextRun({children:[D.PageNumber.CURRENT]})]})]})},children:children.length?children:[new D.Paragraph('')]}]});
 return D.Packer.toBuffer(file);
}
function printHtml(doc,options={}){return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:'+(options.preview?' blob:':'')+(options.files?' file:':'')+'; style-src \'unsafe-inline\'">'+(options.truncated?'<meta name="notemind-preview-truncated" content="1">':'')+'<style>@page{margin:0}body{font:11pt/1.5 Calibri,Arial,sans-serif;color:#191919}h1,h2,h3,h4,h5,h6{break-after:avoid}h1{font-size:25pt}h2{font-size:19pt}img{max-width:100%;max-height:240mm;object-fit:contain}table{border-collapse:collapse;width:100%;break-inside:avoid}td,th{border:1px solid #aaa;padding:6px;text-align:left}th{font-weight:normal}pre{white-space:pre-wrap;background:#f3f3f3;padding:10px}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:15px}a{color:#245ca4}p,li{orphans:3;widows:3}'+syntaxCSS+'</style><body class="syntax-light">'+render(doc.text,doc.assets,doc.meta,options.imageUrl,options.imageSize).replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,'')+'</body>';}
module.exports={importWord,exportWord,printHtml};
