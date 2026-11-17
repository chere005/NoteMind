const {createHash}=require('node:crypto');
const {MarkupBook}=require('./pdf-reference-markup.cjs'),{check}=require('./pdf-reference-session.cjs');
const number=value=>{if(!Number.isFinite(value))throw Error('Invalid PDF ink coordinate.');return String(Number(value.toFixed(6)));};
function pageBox(page){
 const media=page.getMediaBox(),crop=page.getCropBox(),x=Math.max(media.x,crop.x),y=Math.max(media.y,crop.y),right=Math.min(media.x+media.width,crop.x+crop.width),top=Math.min(media.y+media.height,crop.y+crop.height),rotation=((page.getRotation().angle%360)+360)%360;
 if(![x,y,right,top].every(Number.isFinite)||right<=x||top<=y||![0,90,180,270].includes(rotation))throw Error('Invalid PDF page crop or rotation.');
 return{x,y,width:right-x,height:top-y,rotation};
}
function toPDF(point,box){
 const {x,y,width,height,rotation}=box;
 if(rotation===90)return{x:x+point.y*width,y:y+point.x*height};
 if(rotation===180)return{x:x+(1-point.x)*width,y:y+point.y*height};
 if(rotation===270)return{x:x+(1-point.y)*width,y:y+(1-point.x)*height};
 return{x:x+point.x*width,y:y+(1-point.y)*height};
}
function color(hex,opacity=1){let value=hex.slice(1);if(value.length===3)value=[...value].map(c=>c+c).join('');return{red:parseInt(value.slice(0,2),16)/255,green:parseInt(value.slice(2,4),16)/255,blue:parseInt(value.slice(4,6),16)/255,opacity:opacity*(value.length===8?parseInt(value.slice(6,8),16)/255:1)};}
const pressureScale=value=>.2+1.6*value;
const yieldTurn=()=>new Promise(resolve=>setImmediate(resolve));
async function annotatePDF(source,markup,{signal,onProgress=()=>{},pdfLib,chunkBytes=256*1024,maxSourceBytes=150*1024*1024,maxOutputBytes=250*1024*1024}={}){
 check(signal);if(!Number.isInteger(chunkBytes)||chunkBytes<1024||chunkBytes>1024*1024)throw Error('Invalid PDF export chunk size.');if(!(source instanceof Uint8Array)||source.byteLength>maxSourceBytes)throw Error('Choose a PDF up to 150 MB.');
 const bytes=Buffer.from(source.buffer,source.byteOffset,source.byteLength),hash=createHash('sha256').update(bytes).digest('hex'),book=MarkupBook.restore(markup,hash),library=pdfLib||require('pdf-lib');
 const document=await library.PDFDocument.load(source,{updateMetadata:false});check(signal);const pages=document.getPages();if(pages.length!==book.pageCount)throw Error('The PDF page count no longer matches its markup.');
 let strokesWritten=0;
 for(let index=0;index<pages.length;index++){
  check(signal);const strokes=book.strokes(index+1);onProgress({page:index+1,pages:pages.length,phase:'Exporting PDF'});
  if(!strokes.length){if(index%32===0)await yieldTurn();continue;}
  const page=pages[index],box=pageBox(page),unit=(box.rotation%180?box.height:box.width)/1000;page.node.normalize();
  const states=new Map();let parts=[],length=0;
  const flush=async()=>{if(!length)return;check(signal);const stream=document.context.flateStream(parts.join(''));page.node.addContentStream(document.context.register(stream));parts=[];length=0;await yieldTurn();check(signal);};
  const append=text=>{parts.push(text);length+=text.length;if(length>=chunkBytes)return flush();};
  for(const stroke of strokes){
   check(signal);const rgba=color(stroke.colorHex,stroke.opacity??1);if(!rgba.opacity)continue;
   let state=states.get(rgba.opacity);if(!state){state=page.node.newExtGState('NoteMindInk',document.context.register(document.context.obj({Type:'ExtGState',CA:rgba.opacity,ca:rgba.opacity})));states.set(rgba.opacity,state);}
   await append('q\n'+[box.x,box.y,box.width,box.height].map(number).join(' ')+' re W n\n'+state.toString()+' gs\n'+[rgba.red,rgba.green,rgba.blue].map(number).join(' ')+' RG\n1 J\n1 j\n');
   const points=stroke.points,first=toPDF(points[0],box),base=stroke.width*unit;
   if(points.length===1)await append(number(base)+' w\n'+number(first.x)+' '+number(first.y)+' m\n'+number(first.x+.00001)+' '+number(first.y)+' l S\n');
   else if(stroke.pressures){
    let previous=first;for(let i=1;i<points.length;i++){const point=toPDF(points[i],box),width=base*pressureScale((stroke.pressures[i-1]+stroke.pressures[i])/2);const pending=append(number(width)+' w\n'+number(previous.x)+' '+number(previous.y)+' m\n'+number(point.x)+' '+number(point.y)+' l S\n');if(pending)await pending;previous=point;}
   }else{
    await append(number(base)+' w\n'+number(first.x)+' '+number(first.y)+' m\n');for(let i=1;i<points.length;i++){const point=toPDF(points[i],box);const pending=append(number(point.x)+' '+number(point.y)+' l\n');if(pending)await pending;}await append('S\n');
   }
   await append('Q\n');strokesWritten++;
  }
  await flush();
 }
 check(signal);if(!strokesWritten)return {bytes:source,pageCount:pages.length,strokesWritten};const result=await document.save({addDefaultPage:false,objectsPerTick:50});check(signal);if(result.byteLength>maxOutputBytes)throw Error('The annotated PDF is too large.');return{bytes:result,pageCount:pages.length,strokesWritten};
}
module.exports={annotatePDF,pageBox,toPDF,color,pressureScale};
