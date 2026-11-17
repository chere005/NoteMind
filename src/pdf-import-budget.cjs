// Count persisted UTF8 without allocating an encoded copy of the document.
const cancelled=()=>Object.assign(Error('PDF import cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw cancelled();};
const yieldDefault=()=>new Promise(resolve=>setTimeout(resolve,0));
async function utf8Bytes(text,{signal,yieldTask=yieldDefault,chunkUnits=65536,start=0,end=text?.length}={}){
 if(typeof text!=='string'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length||!Number.isSafeInteger(chunkUnits)||chunkUnits<1||chunkUnits>65536)throw Error('Invalid PDF text accounting.');let bytes=0;
 for(let at=start;at<end;){check(signal);const until=Math.min(end,at+chunkUnits);for(;at<until;at++){const code=text.charCodeAt(at);if(code<0x80)bytes++;else if(code<0x800)bytes+=2;else if(code>=0xd800&&code<=0xdbff&&at+1<end&&text.charCodeAt(at+1)>=0xdc00&&text.charCodeAt(at+1)<=0xdfff){bytes+=4;at++;}else bytes+=3;}if(at<end){await yieldTask();check(signal);}}
 check(signal);return bytes;
}
async function spliceBytes(text,start,end,insert,options={}){
 if(typeof insert!=='string'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length)throw Error('Invalid PDF insertion accounting.');let from=Math.max(0,start-1),to=Math.min(text.length,end+1);
 if(from>0&&text.charCodeAt(from)>=0xdc00&&text.charCodeAt(from)<=0xdfff&&text.charCodeAt(from-1)>=0xd800&&text.charCodeAt(from-1)<=0xdbff)from--;
 if(to<text.length&&text.charCodeAt(to-1)>=0xd800&&text.charCodeAt(to-1)<=0xdbff&&text.charCodeAt(to)>=0xdc00&&text.charCodeAt(to)<=0xdfff)to++;
 const before=await utf8Bytes(text,{...options,start:from,end:to}),after=await utf8Bytes(text.slice(from,start)+insert+text.slice(end,to),{...options,start:0,end:undefined});return after-before;
}
module.exports={utf8Bytes,spliceBytes};
