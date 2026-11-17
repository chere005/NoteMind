(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./archive-limits.cjs').ENTRY_BYTES,root);
 else root.NoteMindScanLimits=factory(50*1024*1024,root);
})(typeof globalThis==='undefined'?this:globalThis,function(ENTRY_BYTES,root){
 const MAX_PAGES=100,MAX_DATA_URL_CHARS=180*1024*1024,MAX_PIXELS=16*1024*1024,MAX_EDGE=32768;
 const PNG='data:image/png;base64,',JPEG='data:image/jpeg;base64,',alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',codes=new Int16Array(128);codes.fill(-1);for(let i=0;i<alphabet.length;i++)codes[alphabet.charCodeAt(i)]=i;
 const invalid=()=>Error('Invalid scan image.'),cancelled=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'}),check=signal=>{if(signal?.aborted)throw cancelled();};
 let channel=null;const waiters=[];
 function yieldTask(){if(typeof root.NoteMindGraphics?.yieldTask==='function')return root.NoteMindGraphics.yieldTask();if(typeof setImmediate==='function')return new Promise(resolve=>setImmediate(resolve));if(typeof MessageChannel==='function'){if(!channel){channel=new MessageChannel();channel.port1.onmessage=()=>waiters.shift()?.();}return new Promise(resolve=>{waiters.push(resolve);channel.port2.postMessage(0);});}return new Promise(resolve=>setTimeout(resolve,0));}
 function sextet(data,index){const code=data.charCodeAt(index);if(code>=128||codes[code]<0||!Number.isFinite(code))throw invalid();return codes[code];}
 function textSource(data){
  const prefix=typeof data==='string'&&(data.startsWith(PNG)?PNG:data.startsWith(JPEG)?JPEG:null);if(!prefix)throw invalid();const length=data.length-prefix.length;if(length<4||length%4)throw invalid();const padding=data.endsWith('==')?2:data.endsWith('=')?1:0,bytes=length/4*3-padding;
  if(padding&&(sextet(data,data.length-padding-1)&(padding===2?15:3)))throw invalid();
  const read=index=>{const group=prefix.length+Math.floor(index/3)*4,part=index%3;if(index<0||index>=bytes)throw invalid();if(part===0)return(sextet(data,group)<<2)|(sextet(data,group+1)>>4);if(part===1)return((sextet(data,group+1)&15)<<4)|(sextet(data,group+2)>>2);return((sextet(data,group+2)&3)<<6)|sextet(data,group+3);};
  return{data,prefixLength:prefix.length,padding,bytes,mime:prefix===PNG?'image/png':'image/jpeg',read};
 }
 function binarySource(value){let bytes;if(ArrayBuffer.isView(value))bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);else if(value instanceof ArrayBuffer)bytes=new Uint8Array(value);else throw invalid();const mime=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':null;if(!mime)throw invalid();return{bytes:bytes.length,mime,read:index=>{if(index<0||index>=bytes.length)throw invalid();return bytes[index];}};}
 const uint16=(source,at)=>source.read(at)*256+source.read(at+1),uint32=(source,at)=>source.read(at)*16777216+source.read(at+1)*65536+source.read(at+2)*256+source.read(at+3),typeAt=(source,at)=>String.fromCharCode(source.read(at),source.read(at+1),source.read(at+2),source.read(at+3));
 function dimensions(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw invalid();if(width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)throw Error('Scan image dimensions exceed the 16 Mi pixel limit.');return{width,height};}
 function jpegStep(source,state){
  if(state.offset>=source.bytes-1)throw invalid();const value=source.read(state.offset++);
  if(!state.marker){if(value!==255)throw invalid();state.marker=true;return;}
  if(value===255)return;state.marker=false;if(!value||value===216||value===217)throw invalid();if(value===1||value>=208&&value<=215)return;
  const start=state.offset,length=uint16(source,start),next=start+length;if(length<2||next>source.bytes)throw invalid();
  if(value>=192&&value<=207&&value!==196&&value!==200&&value!==204){if(length<8)throw invalid();const size=dimensions(uint16(source,start+5),uint16(source,start+3)),components=source.read(start+7);if(!components||length<8+3*components)throw invalid();state.width=size.width;state.height=size.height;}
  state.offset=next;
  if(value===218){if(!state.width||!state.height||length<6||next>=source.bytes-2||source.read(source.bytes-2)!==255||source.read(source.bytes-1)!==217)throw invalid();state.done=true;}
 }
 function inspectSource(source){
  if(!Number.isSafeInteger(source.bytes)||source.bytes<=0)throw invalid();if(source.bytes>ENTRY_BYTES)throw Error('A scan image exceeds the 50 MiB image limit.');
  const info={bytes:source.bytes,mime:source.mime,...(source.data?{dataURLChars:source.data.length,padding:source.padding}:{}),width:null,height:null};
  if(source.mime==='image/png'){
   if(source.bytes<33)throw invalid();const signature=[137,80,78,71,13,10,26,10];for(let i=0;i<signature.length;i++)if(source.read(i)!==signature[i])throw invalid();if(uint32(source,8)!==13||typeAt(source,12)!=='IHDR')throw invalid();Object.assign(info,dimensions(uint32(source,16),uint32(source,20)));
  }else{
   if(source.bytes<4||source.read(0)!==255||source.read(1)!==216)throw invalid();const state={offset:2,marker:false,width:null,height:null,done:false};for(let i=0;i<1024&&!state.done;i++)jpegStep(source,state);info.width=state.width;info.height=state.height;
  }
  return info;
 }
 // Cheap bounded header/size admission. Full textual/structural validation is async.
 const inspectImage=data=>inspectSource(textSource(data)),inspectBytes=bytes=>inspectSource(binarySource(bytes));
 function assertPageCount(count,{allowEmpty=true}={}){if(!Number.isSafeInteger(count)||count<0||count>MAX_PAGES||!allowEmpty&&!count)throw Error('Choose 1–100 scan pages.');return count;}
 function imageDataURLChars(bytes,mime='image/png'){if(!Number.isSafeInteger(bytes)||bytes<=0)throw invalid();if(bytes>ENTRY_BYTES)throw Error('A scan image exceeds the 50 MiB image limit.');if(!['image/png','image/jpeg'].includes(mime))throw invalid();return(mime==='image/png'?PNG:JPEG).length+4*Math.ceil(bytes/3);}
 function measurePages(pages,{allowEmpty=true,maxChars=MAX_DATA_URL_CHARS}={}){if(!Array.isArray(pages))throw Error('Choose 1–100 scan pages.');assertPageCount(pages.length,{allowEmpty});if(!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>MAX_DATA_URL_CHARS)throw Error('Invalid scan size limit.');let dataURLChars=0,bytes=0;const images=[];for(const page of pages){const info=inspectImage(page?.data);dataURLChars+=info.dataURLChars;bytes+=info.bytes;if(dataURLChars>maxChars)throw Error('This scan is too large. Use fewer pages.');images.push(info);}return{count:pages.length,dataURLChars,bytes,images};}
 async function validateStructure(source,info,{signal,yieldControl}){
  if(source.mime==='image/jpeg'){const state={offset:2,marker:false,width:null,height:null,done:false};let steps=0;while(!state.done){check(signal);jpegStep(source,state);if(++steps%512===0){await yieldControl();check(signal);}}return{...info,width:state.width,height:state.height};}
  let offset=8,chunks=0,hasPixels=false,ended=false;
  while(offset+12<=info.bytes){check(signal);const length=uint32(source,offset),type=typeAt(source,offset+4),next=offset+12+length;if(next>info.bytes||!Number.isSafeInteger(next)||!(/^[A-Za-z]{4}$/).test(type))throw invalid();if(chunks===0&&(type!=='IHDR'||length!==13)||chunks>0&&type==='IHDR')throw invalid();if(type==='IDAT'&&length>0)hasPixels=true;if(type==='IEND'){if(length||!hasPixels||next!==info.bytes)throw invalid();ended=true;break;}offset=next;if(++chunks%512===0){await yieldControl();check(signal);}}if(!ended)throw invalid();return info;
 }
 async function validateImage(data,{signal,yieldControl=yieldTask}={}){check(signal);const source=textSource(data),info=inspectSource(source),end=data.length-source.padding;for(let start=source.prefixLength;start<end;start+=65536){const stop=Math.min(end,start+65536);for(let i=start;i<stop;i++){const code=data.charCodeAt(i);if(code>=128||codes[code]<0)throw invalid();}check(signal);await yieldControl();check(signal);}return validateStructure(source,info,{signal,yieldControl});}
 async function validateBytes(bytes,{signal,yieldControl=yieldTask}={}){check(signal);const source=binarySource(bytes),info=inspectSource(source);return validateStructure(source,info,{signal,yieldControl});}
 async function validatePages(pages,options={}){check(options.signal);const result=measurePages(pages,{...options,allowEmpty:options.allowEmpty??false});for(let i=0;i<pages.length;i++)result.images[i]=await validateImage(pages[i].data,options);check(options.signal);return result;}
 async function admitPage(pages,page,options={}){check(options.signal);measurePages([...pages,page],options);const info=await validateImage(page?.data,options);check(options.signal);const result=measurePages([...pages,page],options);result.images[result.images.length-1]=info;return result;}
 function assertPDFSize(bytes){if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error('The scan PDF is empty or invalid.');if(bytes>ENTRY_BYTES)throw Error('The generated scan PDF exceeds the 50 MiB attachment limit.');return bytes;}
 return{MAX_PAGES,MAX_DATA_URL_CHARS,MAX_PIXELS,MAX_EDGE,ENTRY_BYTES,assertPageCount,imageDataURLChars,inspectImage,inspectBytes,measurePages,validateImage,validateBytes,validatePages,admitPage,assertPDFSize};
});
