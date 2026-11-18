// A bounded semantic sink for the existing Word XML visitor. It never parses
// Word independently; paragraph/list/table/style decisions arrive from that visitor.
const {createHash}=require('node:crypto');
const {createPreviewFile}=require('./word-preview-files.cjs');
const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
class PreviewHTML {
 constructor(authority,{segmentBytes=256*1024,check=()=>{},assetInfo=()=>null,link=()=>null,longAttribute=async()=>null,files=null}={}){if(!Number.isSafeInteger(segmentBytes)||segmentBytes<4096)throw Error('Invalid Word preview segment size.');Object.assign(this,{authority,segmentBytes,check,assetInfo,link,longAttribute,files});this.stack=[];this.writtenStack=[];this.parts=[];this.bytes=0;this.segments=[];this.pending=[];this.block=0;this.list=[];this.cellParagraphs=0;this.firstRow=false;this.currentCell=0;this.tableWidth=0;this.closed=false;}
 emit(value){if(value)this.pending.push({value});}
 open(open,close,kind){const entry={open,close,kind};this.pending.push({value:open,open:entry});this.stack.push(entry);}
 close(kind){const value=this.stack.pop();if(!value||kind&&value.kind!==kind)throw Error('Unbalanced Word preview context.');this.pending.push({value:value.close,close:true});}
 closeLists(){while(this.list.length){this.close('li');this.close('list');this.list.pop();}}
 paragraphStart(format){this.block++;if(format.inCell){if(this.cellParagraphs++)this.emit('<br><br>');if(format.heading)this.emit('#'.repeat(format.heading)+' ');else if(format.list)this.emit('    '.repeat(format.list.depth)+(format.list.ordered?format.list.count+'.  ':'-   '));return;}if(!format.list){this.closeLists();const tag=format.heading?'h'+format.heading:'p';this.open('<'+tag+'>','</'+tag+'>','paragraph');return;}const {depth,ordered,count}=format.list;while(this.list.length>depth+1){this.close('li');this.close('list');this.list.pop();}if(this.list.length===depth+1&&this.list.at(-1)!==ordered){this.close('li');this.close('list');this.list.pop();}if(this.list.length===depth+1)this.close('li');while(this.list.length<depth+1){const tag=ordered?'ol':'ul';this.open('<'+tag+(ordered&&count!==1?' start="'+count+'"':'')+'>','</'+tag+'>','list');this.list.push(ordered);if(this.list.length<depth+1)this.open('<li>','</li>','li');}this.pending.push({listCount:count});this.open('<li>','</li>','li');}
 paragraphEnd(format){if(!format.inCell&&!format.list)this.close('paragraph');}
 createInline({format}){return new PreviewInline(this,format);}
 tableStart(){this.closeLists();this.block++;this.open('<table style="table-layout:fixed;width:100%">','</table>','table');}
 tableGrid(width){this.tableWidth=width;}
 rowStart({first}){this.firstRow=first;this.currentCell=0;if(first)this.open('<thead>','</thead>','rowgroup');else if(!this.inBody){this.open('<tbody>','</tbody>','rowgroup');this.inBody=true;}this.open('<tr>','</tr>','row');}
 cellStart(){this.cellParagraphs=0;const tag=this.firstRow?'th':'td';this.open('<'+tag+'>','</'+tag+'>','cell');this.currentCell++;}
 cellEnd(){this.close('cell');}
 rowEnd({width,first}){for(let n=this.currentCell;n<width;n++)this.emit(first?'<th></th>':'<td></td>');this.close('row');if(first)this.close('rowgroup');}
 tableEnd(){if(this.inBody){this.close('rowgroup');this.inBody=false;}this.close('table');}
 async drain(){this.check();for(const item of this.pending.splice(0)){const {value}=item;if(Object.hasOwn(item,'listCount')){const parent=[...this.writtenStack].reverse().find(entry=>['list','ol','ul'].includes(entry.kind));if(parent&&parent.open.startsWith('<ol'))parent.reopen='<ol start="'+item.listCount+'">';continue;}
   if(item.open||item.close||value.startsWith('<')){await this.take(value,item);continue;}
   for(let at=0;at<value.length;){let end=Math.min(value.length,at+4096);if(end<value.length){if(value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;const amp=value.lastIndexOf('&',end-1);if(amp>=at&&value.indexOf(';',amp)>=end)end=amp;}await this.take(value.slice(at,end));at=end;}
  }this.check();}
 async take(value,item={}){this.check();const bytes=Buffer.byteLength(value);if(this.bytes+bytes>this.segmentBytes&&this.bytes)await this.flush(true);this.parts.push(value);this.bytes+=bytes;if(item.open)this.writtenStack.push({...item.open});if(item.close)this.writtenStack.pop();}
 async flush(toNext=false){if(!this.parts.length)return;toNext=toNext&&this.writtenStack.length>0;const closing=this.writtenStack.map(value=>value.close).reverse().join(''),html=this.parts.join('')+closing,record=await this.files?.create('html',Buffer.byteLength(html),'html'),entry=record?record.entry:await createPreviewFile(this.authority,'html');let complete=false;try{const bytes=Buffer.from(html);try{for(let at=0;at<bytes.length;){this.check();const answer=await entry.handle.write(bytes,at,bytes.length-at,at);if(!answer.bytesWritten)throw Error('Word preview write stopped.');at+=answer.bytesWritten;if(record)await this.files.written(record,at);}}finally{if(bytes.byteOffset===0&&bytes.length===bytes.buffer.byteLength)bytes.buffer.transfer?.(0);}complete=true;}finally{await entry.handle?.close();entry.handle=null;if(record){record.handle=null;if(complete)await this.files.done(record);else await this.files.rollback(record);}}const index=this.segments.length;this.segments.push({index,name:entry.name,inode:entry.identity,htmlBytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),continuation:{blockId:this.block,fromPrevious:!!this.fromPrevious,toNext}});this.parts=toNext?this.writtenStack.map(value=>{const open=value.reopen||value.open;return open.replace(/^(<[^ >]+)/,'$1 data-word-continuation=""');}):[];this.bytes=this.parts.reduce((sum,value)=>sum+Buffer.byteLength(value),0);this.fromPrevious=toNext;}
 async finish(){this.closeLists();if(this.stack.length)throw Error('Incomplete Word preview structure.');await this.drain();await this.flush(false);this.closed=true;return this.segments;}
}
class PreviewInline{
 constructor(sink,format){this.sink=sink;this.format=format;this.open=[];this.content=false;this.pending='';}
 begin(){if(!this.content){this.value=this.format();this.sink.paragraphStart(this.value);this.content=true;}}
 styles(run){const values=[];if(run.link){const id=this.sink.link(run.link);if(id)values.push({key:'a:'+id,open:'<a href="#" data-word-link="'+esc(id)+'">',close:'</a>'});}for(const[key,tag]of[['bold','strong'],['italic','em'],['underline','u'],['strike','s'],['highlight','mark']])if(run[key])values.push({key,open:'<'+tag+'>',close:'</'+tag+'>'});return values;}
 transition(next){let same=0;while(same<this.open.length&&same<next.length&&this.open[same].key===next[same].key)same++;for(let at=this.open.length-1;at>=same;at--)this.sink.close('inline');this.open.length=same;return same;}
 emit(value,run){this.begin();const next=this.styles(run),same=this.transition(next);if(this.pending){this.sink.emit(esc(this.pending));this.pending='';}for(let at=same;at<next.length;at++){this.sink.open(next[at].open,next[at].close,'inline');this.open.push(next[at]);}this.sink.emit(value);}
 textValue(value,run){for(const chunk of value.split(/([ \t\r\n]+)/)){if(!chunk)continue;if(/^[ \t\r\n]+$/.test(chunk)){if(this.content)this.pending=' ';}else this.emit(esc(chunk),run);}}
 async image(src,alt,run){const info=this.sink.assetInfo(src)||{},dimensions=info.width&&info.height?' width="'+info.width+'" height="'+info.height+'"':'';alt=alt||'Image';const reference=alt.length>4096?await this.sink.longAttribute(alt):null;this.emit('<img data-word-asset="'+esc(src)+'"'+dimensions+' loading="lazy" decoding="async" alt="'+esc(reference?'Image':alt)+'"'+(reference?' data-word-alt="'+esc(reference)+'"':'')+'>',run);}
 checkbox(checked,run){this.begin();this.emit(this.value.list?'<input type="checkbox" aria-label="Complete task"'+(checked?' checked':'')+' contenteditable="false"> ':checked?'[x] ':'[ ] ',run);}
 break(run){this.pending='';this.emit('<br>\n',run);}
 finish(){this.pending='';this.transition([]);return this.content;}
}
module.exports={PreviewHTML,esc};
