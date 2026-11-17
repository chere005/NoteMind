(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./archive-limits.cjs').ENTRY_BYTES,root);
 else root.NoteMindScanLimits=factory(50*1024*1024,root);
})(typeof globalThis==='undefined'?this:globalThis,function(ENTRY_BYTES,root){
 const MAX_PAGES=100,MAX_DATA_URL_CHARS=180*1024*1024,PREFIX='data:image/png;base64,',alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',codes=new Int16Array(128);codes.fill(-1);for(let i=0;i<alphabet.length;i++)codes[alphabet.charCodeAt(i)]=i;
 const invalid=()=>Error('Invalid scan PNG.');
 const cancelled=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'});
 const check=signal=>{if(signal?.aborted)throw cancelled();};
 let channel=null;const waiters=[];
 function yieldTask(){
  if(typeof root.NoteMindGraphics?.yieldTask==='function')return root.NoteMindGraphics.yieldTask();
  if(typeof setImmediate==='function')return new Promise(resolve=>setImmediate(resolve));
  if(typeof MessageChannel==='function'){if(!channel){channel=new MessageChannel();channel.port1.onmessage=()=>waiters.shift()?.();}return new Promise(resolve=>{waiters.push(resolve);channel.port2.postMessage(0);});}
  return new Promise(resolve=>setTimeout(resolve,0));
 }
 function sextet(data,index){const code=data.charCodeAt(index);if(code>=128||codes[code]<0||!Number.isFinite(code))throw invalid();return codes[code];}
 function byteAt(data,index){const group=PREFIX.length+Math.floor(index/3)*4,part=index%3;if(part===0)return(sextet(data,group)<<2)|(sextet(data,group+1)>>4);if(part===1)return((sextet(data,group+1)&15)<<4)|(sextet(data,group+2)>>2);return((sextet(data,group+2)&3)<<6)|sextet(data,group+3);}
 const uint32=(data,at)=>byteAt(data,at)*16777216+byteAt(data,at+1)*65536+byteAt(data,at+2)*256+byteAt(data,at+3);
 const typeAt=(data,at)=>String.fromCharCode(byteAt(data,at),byteAt(data,at+1),byteAt(data,at+2),byteAt(data,at+3));
 // Cheap admission only. Full canonical alphabet/chunk validation is async below.
 function inspectImage(data){
  if(typeof data!=='string'||!data.startsWith(PREFIX))throw invalid();const length=data.length-PREFIX.length;if(length<4||length%4)throw invalid();const padding=data.endsWith('==')?2:data.endsWith('=')?1:0,bytes=length/4*3-padding;
  if(bytes>ENTRY_BYTES)throw Error('A scan image exceeds the 50 MiB image limit.');if(bytes<33)throw invalid();
  if(padding&&(sextet(data,data.length-padding-1)&(padding===2?15:3)))throw invalid();
  const signature=[137,80,78,71,13,10,26,10];for(let i=0;i<signature.length;i++)if(byteAt(data,i)!==signature[i])throw invalid();
  if(uint32(data,8)!==13||typeAt(data,12)!=='IHDR')throw invalid();const width=uint32(data,16),height=uint32(data,20);if(!width||!height||width>2147483647||height>2147483647)throw invalid();
  return{bytes,dataURLChars:data.length,padding,width,height};
 }
 function assertPageCount(count,{allowEmpty=true}={}){if(!Number.isSafeInteger(count)||count<0||count>MAX_PAGES||!allowEmpty&&!count)throw Error('Choose 1–100 scan pages.');return count;}
 function imageDataURLChars(bytes){if(!Number.isSafeInteger(bytes)||bytes<=0)throw invalid();if(bytes>ENTRY_BYTES)throw Error('A scan image exceeds the 50 MiB image limit.');return PREFIX.length+4*Math.ceil(bytes/3);}
 function measurePages(pages,{allowEmpty=true,maxChars=MAX_DATA_URL_CHARS}={}){
  if(!Array.isArray(pages))throw Error('Choose 1–100 scan pages.');assertPageCount(pages.length,{allowEmpty});if(!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>MAX_DATA_URL_CHARS)throw Error('Invalid scan size limit.');let dataURLChars=0,bytes=0;const images=[];
  for(const page of pages){const info=inspectImage(page?.data);dataURLChars+=info.dataURLChars;bytes+=info.bytes;if(dataURLChars>maxChars)throw Error('This scan is too large. Use fewer pages.');images.push(info);}
  return{count:pages.length,dataURLChars,bytes,images};
 }
 async function validateImage(data,{signal,yieldControl=yieldTask}={}){
  check(signal);const info=inspectImage(data),end=data.length-info.padding;
  for(let start=PREFIX.length;start<end;start+=65536){const stop=Math.min(end,start+65536);for(let i=start;i<stop;i++){const code=data.charCodeAt(i);if(code>=128||codes[code]<0)throw invalid();}check(signal);await yieldControl();check(signal);}
  // Walk chunk headers by random-access base64 bytes; never decode/copy the full PNG.
  let offset=8,chunks=0,hasPixels=false,ended=false;
  while(offset+12<=info.bytes){check(signal);const length=uint32(data,offset),type=typeAt(data,offset+4),next=offset+12+length;if(next>info.bytes||!Number.isSafeInteger(next)||!(/^[A-Za-z]{4}$/).test(type))throw invalid();if(chunks===0&&(type!=='IHDR'||length!==13)||chunks>0&&type==='IHDR')throw invalid();if(type==='IDAT'&&length>0)hasPixels=true;if(type==='IEND'){if(length||!hasPixels||next!==info.bytes)throw invalid();ended=true;break;}offset=next;if(++chunks%512===0){await yieldControl();check(signal);}}
  if(!ended)throw invalid();return info;
 }
 async function validatePages(pages,options={}){check(options.signal);const result=measurePages(pages,{...options,allowEmpty:options.allowEmpty??false});for(const page of pages)await validateImage(page.data,options);check(options.signal);return result;}
 async function admitPage(pages,page,options={}){check(options.signal);measurePages([...pages,page],options);await validateImage(page?.data,options);check(options.signal);return measurePages([...pages,page],options);}
 function assertPDFSize(bytes){if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error('The scan PDF is empty or invalid.');if(bytes>ENTRY_BYTES)throw Error('The generated scan PDF exceeds the 50 MiB attachment limit.');return bytes;}
 return{MAX_PAGES,MAX_DATA_URL_CHARS,ENTRY_BYTES,assertPageCount,imageDataURLChars,inspectImage,measurePages,validateImage,validatePages,admitPage,assertPDFSize};
});
