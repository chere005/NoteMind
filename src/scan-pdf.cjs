const {setImmediate:yieldTask}=require('node:timers/promises'),{check}=require('./pdf-reference-session.cjs');
// Decode a single bounded PNG. PDF streams own compressed pixels after each
// embed, so prior pages never retain all their RGBA canvases/decoder objects.
async function createAssembler({decodePng,pdfLib}={}){
 const lib=pdfLib||require('pdf-lib'),pdf=await lib.PDFDocument.create();decodePng ||= require('./png-rgba.cjs').decodePng;let count=0,total=0,closed=false;
 return {async add(page,{signal}={}){
  if(closed||count>=100||typeof page?.data!=='string'||!/^data:image\/(png|jpeg);base64,[\w+/=]+$/.test(page.data))throw Error('Invalid scan image.');
  if(total+page.data.length>180*1024*1024)throw Error('This scan is too large. Use fewer pages.');
  check(signal);const comma=page.data.indexOf(','),bytes=Buffer.from(page.data.slice(comma+1),'base64');let image;
  if(page.data.startsWith('data:image/jpeg')){const dimensions=require('image-size').imageSize(bytes);if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>16000000)throw Error('Scan pages may contain at most 16 million pixels.');image=await pdf.embedJpg(bytes);await image.embed();}
  else{
   const rgba=decodePng(bytes),count=rgba.width*rgba.height,rgb=new Uint8Array(count*3);let alpha=null,started=performance.now();
   for(let n=0;n<count;n++){const at=n*4,to=n*3;rgb[to]=rgba.data[at];rgb[to+1]=rgba.data[at+1];rgb[to+2]=rgba.data[at+2];if(rgba.data[at+3]!==255&&!alpha){alpha=new Uint8Array(count);alpha.fill(255);}if(alpha)alpha[n]=rgba.data[at+3];if(n%8192===0&&performance.now()-started>3){await yieldTask();check(signal);started=performance.now();}}
   const mask=alpha?pdf.context.register(pdf.context.flateStream(alpha,{Type:'XObject',Subtype:'Image',Width:rgba.width,Height:rgba.height,ColorSpace:'DeviceGray',BitsPerComponent:8})):undefined,ref=pdf.context.register(pdf.context.flateStream(rgb,{Type:'XObject',Subtype:'Image',Width:rgba.width,Height:rgba.height,ColorSpace:'DeviceRGB',BitsPerComponent:8,...(mask?{SMask:mask}:{})}));image={ref,width:rgba.width,height:rgba.height};
  }
  const added=pdf.addPage([595.28,841.89]),scale=Math.min((595.28-16)/image.width,(841.89-16)/image.height);const name=added.node.newXObject('NoteMindScan',image.ref),stream=pdf.context.flateStream('q\n'+[image.width*scale,0,0,image.height*scale,(595.28-image.width*scale)/2,(841.89-image.height*scale)/2].join(' ')+' cm\n'+name.toString()+' Do\nQ\n');added.node.addContentStream(pdf.context.register(stream));await yieldTask();check(signal);
  total+=page.data.length;count++;
 },async finish({signal}={}){
  if(closed||!count)throw Error('Choose 1–100 scan pages.');closed=true;check(signal);const bytes=await pdf.save({objectsPerTick:25});check(signal);if(bytes.length>199*1024*1024)throw Error('This scan is too large. Use fewer pages.');return bytes;
 },get pages(){return count;}};
}
async function assemble(pages,options={}){if(!Array.isArray(pages)||!pages.length||pages.length>100)throw Error('Choose 1–100 scan pages.');const assembler=await createAssembler(options);for(const page of pages){options.onProgress?.({page:assembler.pages+1,pages:pages.length,phase:'Assembling scan'});await assembler.add(page,options);}return assembler.finish(options);}
module.exports={assemble,createAssembler};
