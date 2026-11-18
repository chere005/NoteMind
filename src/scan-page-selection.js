(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NoteMindScanPageSelection=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
 function pageNumbers(text,count,{maximum=100,kind='scan'}={}){
  if(!['scan','PDF'].includes(kind)||typeof text!=='string'||!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(maximum)||maximum<1||text.length>4096)throw Error('Choose valid '+(kind==='PDF'?'PDF':'scan')+' pages.');const selected=[],seen=new Set();
  for(const part of text.split(',')){
   const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);if(!match)throw Error('Enter page numbers or ranges, separated by commas.');const first=Number(match[1]),last=Number(match[2]??match[1]);
   if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>count)throw Error('Choose pages from 1 to '+count+'.');if(selected.length+last-first+1>maximum)throw Error('Choose up to '+maximum+' '+kind+' pages.');
   for(let page=first;page<=last;page++){if(seen.has(page))throw Error('Choose each '+kind+' page once.');seen.add(page);selected.push(page);}
  }
  if(!selected.length)throw Error('Choose at least one scan page.');return selected;
 }
 return {pageNumbers};
});
