(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: options => factory(require('./document-renderer.cjs').imageDimensions, options) };
  else root.NoteMindImagePreviews = factory(root.NoteMindDocument.imageDimensions, {lazy:true,identity:(assets,name)=>root.NoteMindDocumentSync?.assetIdentity?.(assets,name),chunks:(assets,name)=>root.NoteMindDocumentSync?.assetChunks?.(assets,name)});
})(typeof window === 'undefined' ? this : window, function (dimensions, options = {}) {
  const cache = new Map(), placeholders = new Map(), bound = new Map(), pins = new Map();
  const urls = options.urls || URL, makeBlob = options.makeBlob || ((bytes, type) => new Blob([bytes], { type }));
  const decode = options.decode || (data => typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), c => c.charCodeAt(0)));
  const urlOwners=options.urlOwners||(options.lazy&&typeof window!=='undefined'&&window.NoteMindPreviewURLs?window.NoteMindPreviewURLs.create():null);
  let workerFallbacks=0;
  const discard = bytes => { if (ArrayBuffer.isView(bytes) && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && typeof bytes.buffer.transfer === 'function') try { bytes.buffer.transfer(0); } catch {} };
  function measure(data) { const bytes = decode(data); try { return dimensions(bytes); } finally { if (!options.decode) discard(bytes); } }
  function blob(entry) {
    if (entry.chunks && !options.decode && !options.makeBlob) {
      const parts = [];
      for (const chunk of entry.chunks) { const bytes = decode(chunk); try { parts.push(new Blob([bytes])); } finally { discard(bytes); } }
      return new Blob(parts, { type: entry.type });
    }
    const bytes = decode(entry.data);
    try { return makeBlob(bytes, entry.type); } finally { if (!options.decode && !options.makeBlob) discard(bytes); }
  }
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024, maxDecodedBytes = options.maxDecodedBytes ?? 32 * 1024 * 1024, maxEntries = options.maxEntries ?? 2048;
  let clock = 0, serial = 0, blobBytes = 0, decodedBytes = 0, host = null, assetsFor = null, observer = null, scheduled = false, retained = null, viewController = null;
  const entries = () => Array.from(cache.values()).flatMap(types => Array.from(types.values()));
  function cancelLoading(entry){const loading=entry.loading;if(loading){entry.loading=null;loading.controller.abort();}}
  function revoke(entry) { cancelLoading(entry);if(!entry.url)return;const owner=entry.urlOwner;entry.urlOwner=null;if(owner)void owner.release().catch(()=>{});else urls.revokeObjectURL(entry.url);blobBytes-=entry.bytes;decodedBytes-=entry.decodedBytes;entry.url=null; }
  function forget(entry) {entry.retired=true;cancelLoading(entry);if(!entry.active)revoke(entry);placeholders.delete(entry.placeholder);const types=cache.get(entry.key);types?.delete(entry.type);if(!types?.size)cache.delete(entry.key);}
  const historicalBytes=()=>urlOwners?.stats().historicalBytes||0;
  function exceeds(extraBytes=0,extraDecoded=0){return blobBytes+extraBytes>maxBytes||decodedBytes+extraDecoded>maxDecodedBytes||historicalBytes()+extraBytes>maxBytes;}
  function beforeMaterialize(entry){for(const prior of entries().filter(value=>value!==entry&&value.url&&!value.active).sort((a,b)=>a.used-b.used)){if(!exceeds(entry.bytes,entry.decodedBytes))break;revoke(prior);}if(historicalBytes()+entry.bytes>maxBytes)urlOwners?.trim();}

  function trim() {
    const attached = new Set(bound.values());
    for (const entry of entries()) if (retained && !retained.has(entry.key) && !entry.active && !attached.has(entry)) forget(entry);
    const values = entries().sort((a, b) => a.used - b.used);
    for (const entry of values) if (exceeds() && !entry.active) revoke(entry);
    if(historicalBytes()>maxBytes)urlOwners?.trim();
    let count = values.length;
    for (const entry of values) if (count > maxEntries && !entry.active && !attached.has(entry)) { forget(entry); count--; }
  }
  function get(name, data, type) {
    const owned=assetsFor?.(),key=data.length>=1024*1024&&owned?.[name]===data&&options.identity?options.identity(owned,name)||data:data;let types=cache.get(key),entry=types?.get(type);
    if (!entry) {
      const chunks=owned?.[name]===data?options.chunks?.(owned,name):null,prefix=(chunks?.[0]||data).slice(0,Math.ceil(65536/3)*4);
      let size = measure(prefix);
      // Unusual JPEG metadata or SVG prologs can put the dimensions after the first header block.
      if (!size && prefix.length !== data.length) size = measure(data);
      const placeholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + (size?.width || 1) + '" height="' + (size?.height || 1) + '"/>') + '#notemind-preview-' + (++serial);
      const pixels=size?.width*size?.height*4, decodedEstimate=Number.isFinite(pixels)&&pixels>0?pixels:Math.max(1,maxDecodedBytes);
      entry = {key,data,chunks,type,size,placeholder,decodedBytes:decodedEstimate,bytes:Math.floor(data.length*3/4)-((chunks?.at(-1)||data).endsWith('==')?2:(chunks?.at(-1)||data).endsWith('=')?1:0), url: null, active: 0, used: ++clock };
      if (!types) cache.set(key, types = new Map()); types.set(type, entry); placeholders.set(placeholder, entry);
    }
    entry.used = ++clock; return entry;
  }
  function materialize(entry) {
    if (!entry.url) {
      cancelLoading(entry);beforeMaterialize(entry);
      entry.url = urls.createObjectURL(blob(entry)); blobBytes += entry.bytes; decodedBytes += entry.decodedBytes;
    }
    entry.used = ++clock; return entry.url;
  }
  const abortError=()=>Object.assign(Error('Picture source loading cancelled.'),{name:'AbortError'});
  function waitForSignal(promise,signal){if(!signal)return promise;if(signal.aborted)return Promise.reject(abortError());return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(abortError());};signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}
  function canOwn(entry){return !!urlOwners&&!options.decode&&!options.makeBlob&&!entry.workerFallback;}
  function* privateChunks(entry){for(const part of entry.chunks||[entry.data])for(let at=0;at<part.length;at+=262144)yield decode(part.slice(at,at+262144));}
  function materializeAsync(entry){
    if(entry.url&&(!entry.urlOwner||entry.urlOwner.alive)){entry.used=++clock;return Promise.resolve(entry.url);}
    if(entry.url)revoke(entry);if(!canOwn(entry))return Promise.resolve(materialize(entry));if(entry.loading)return entry.loading.promise;
    beforeMaterialize(entry);const controller=new AbortController(),loading={controller,promise:null};entry.loading=loading;
    loading.promise=(async()=>{let owner;try{
      owner=await urlOwners.create(privateChunks(entry),{bytes:entry.bytes,type:entry.type,signal:controller.signal,ownedChunks:true,onLost:()=>{if(entry.urlOwner===owner){revoke(entry);schedule();}}});
      if(controller.signal.aborted||entry.retired||entry.loading!==loading){await owner.release();throw Object.assign(Error('Picture source loading cancelled.'),{name:'AbortError'});}
      entry.urlOwner=owner;entry.url=owner.url;blobBytes+=entry.bytes;decodedBytes+=entry.decodedBytes;entry.used=++clock;return entry.url;
    }finally{if(entry.loading===loading)entry.loading=null;}})();return loading.promise;
  }
  function sourceForVisible(img,entry){
    if(!canOwn(entry)){const src=materialize(entry);img.loading='eager';if(img.getAttribute('src')!==src)img.src=src;return;}
    void materializeAsync(entry).then(src=>{if(bound.get(img)===entry&&entry.visible?.has(img)&&host?.contains(img)&&assetsFor?.()?.[img.dataset.asset]===entry.data){img.loading='eager';if(img.getAttribute('src')!==src)img.src=src;}}).catch(error=>{
      if(error.name==='AbortError')return;if(entry.retired||bound.get(img)!==entry||!entry.visible?.has(img))return;if(!entry.workerFallback){entry.workerFallback=true;workerFallbacks++;}const src=materialize(entry);img.loading='eager';img.src=src;
    });
  }
  function url(name, data, type) { const entry = get(name, data, type); return options.lazy ? entry.placeholder : materialize(entry); }
  function size(name, data, type) { return get(name, data, type).size; }
  function setSize(img, entry) { if (entry.size) { img.width = entry.size.width; img.height = entry.size.height; } else { img.removeAttribute('width'); img.removeAttribute('height'); } }
  function apply(img, name, data, type) { img.dataset.asset = name; const entry = get(name, data, type); setSize(img, entry); img.loading = 'lazy'; img.decoding = 'async'; img.src = options.lazy ? entry.placeholder : materialize(entry); schedule(); }
  function currentEntry(img) {
    const old = bound.get(img), data = assetsFor?.()?.[img.dataset.asset];
    if (!host?.contains(img) || !data) return null;
    if (old?.data === data) return old;
    const entry = placeholders.get(img.getAttribute('src'));
    return entry?.data === data ? entry : null;
  }
  function releaseImage(img,entry){if(!pins.get(img)&&img.getAttribute('src')===entry.url){img.loading='eager';img.src=entry.placeholder;}}
  function deactivate(img,entry){releaseImage(img,entry);entry.active=Math.max(0,entry.active-1);if(!entry.active)cancelLoading(entry);}
  function refresh() {
    scheduled = false; if (!host) return;
    const images = new Set(host.querySelectorAll('img[data-asset]'));
    for (const [img, entry] of bound) if (!images.has(img) || assetsFor()?.[img.dataset.asset] !== entry.data) { if (entry.visible?.has(img)) { entry.visible.delete(img); deactivate(img, entry); } bound.delete(img); }
    for (const img of images) if (!bound.has(img)) { const entry = currentEntry(img); if (entry) { bound.set(img, entry); setSize(img, entry); } }
    const viewport = options.viewport?.() || host.parentElement?.getBoundingClientRect() || { top: 0, bottom: typeof innerHeight === 'number' ? innerHeight : 800 };
    const margin = options.margin ?? Math.min(800, Math.max(200, (viewport.bottom - viewport.top) / 2));
    const wanted = [];
    for (const [img, entry] of bound) {
      const rect = img.getBoundingClientRect(), visible = !!pins.get(img) || !host.hidden && rect.width > 0 && rect.bottom >= viewport.top - margin && rect.top <= viewport.bottom + margin;
      entry.visible ||= new Set();
      if (visible) wanted.push([img, entry]);
      else if (entry.visible.delete(img)) deactivate(img, entry);
    }
    for(const[img,entry]of wanted){if(!entry.visible.has(img)){entry.visible.add(img);entry.active++;}sourceForVisible(img,entry);}
    trim();
  }
  function schedule() { if (!host || scheduled) return; scheduled = true; (options.schedule || (fn => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : queueMicrotask(fn)))(refresh); }
  function mount(element, getAssets) {
    unmount();host=element;assetsFor=getAssets;viewController=new AbortController();
    if (typeof MutationObserver === 'function') { observer = new MutationObserver(schedule); observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-asset', 'hidden'] }); }
    if (typeof window !== 'undefined') { window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); }
    schedule();
  }
  function unmount() {
    viewController?.abort();viewController=null;
    observer?.disconnect(); observer = null;
    if (typeof window !== 'undefined') { window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); }
    for (const [img, entry] of bound) if (entry.visible?.delete(img)) deactivate(img, entry);
    bound.clear(); host = null; assetsFor = null; scheduled = false; trim();
  }
  function pin(img) {
    refresh(); const entry = bound.get(img); if (!entry) throw Error('The original picture is no longer open.');
    pins.set(img,(pins.get(img)||0)+1);entry.active++;refresh();let released=false;
    return()=>{if(released)return;released=true;const count=(pins.get(img)||0)-1;if(count>0)pins.set(img,count);else pins.delete(img);entry.active=Math.max(0,entry.active-1);if(!entry.active)cancelLoading(entry);if(!entry.visible?.has(img))releaseImage(img,entry);if(entry.retired&&!entry.active)revoke(entry);trim();schedule();};
  }
  async function ensure(img) {
    const release=pin(img),entry=bound.get(img),name=img.dataset.asset,signal=viewController?.signal;let decoding;
    try{const src=canOwn(entry)?await waitForSignal(materializeAsync(entry),signal):materialize(entry);if(!host?.contains(img)||assetsFor()?.[name]!==entry.data||bound.get(img)!==entry)throw Error('The original picture is no longer open.');img.loading='eager';if(img.getAttribute('src')!==src)img.src=src;decoding=img.decode();await waitForSignal(decoding,signal);if(!host?.contains(img)||assetsFor()?.[name]!==entry.data||bound.get(img)!==entry||img.getAttribute('src')!==entry.url)throw Error('The original picture is no longer open.');return img;}
    finally{if(signal?.aborted&&decoding)void Promise.resolve(decoding).catch(()=>{}).then(release);else release();}
  }
  async function withImage(img, run) { const release = pin(img); try { await ensure(img); return await run(img); } finally { release(); } }
  function lease(name,data,type){const entry=get(name,data,type);entry.active++;let url;try{url=materialize(entry);trim();}catch(error){entry.active--;trim();throw error;}let released=false;return {url,release(){if(released)return;released=true;entry.active=Math.max(0,entry.active-1);if(entry.retired&&!entry.active)revoke(entry);trim();}};}
  async function leaseAsync(name,data,type,{signal}={}){
    const entry=get(name,data,type);entry.active++;
    try{if(signal?.aborted)throw abortError();let url;try{url=await waitForSignal(materializeAsync(entry),signal);}catch(error){if(error.name==='AbortError'||entry.retired)throw error;if(!entry.workerFallback){entry.workerFallback=true;workerFallbacks++;}url=materialize(entry);}if(signal?.aborted)throw abortError();let released=false;trim();return{url,release(){if(released)return;released=true;entry.active=Math.max(0,entry.active-1);if(entry.retired&&!entry.active)revoke(entry);trim();}};}
    catch(error){entry.active=Math.max(0,entry.active-1);if(!entry.active)cancelLoading(entry);if(entry.retired&&!entry.active)revoke(entry);trim();throw error;}
  }
  function consumerPool(){
    const records=new Set();let retired=false,releaseErrors=0;
    const release=record=>{if(record.released)return;record.released=true;records.delete(record);try{record.lease.release();}catch{releaseErrors++;}};
    function hold(lease,run){
      if(retired){lease.release();return Promise.reject(abortError());}
      const record={lease,settled:false,released:false,done:null};records.add(record);let work;try{work=run();}catch(error){work=Promise.reject(error);}
      record.done=Promise.resolve(work).then(value=>{record.settled=true;if(retired)release(record);return value;},error=>{record.settled=true;if(retired)release(record);throw error;});record.done.catch(()=>{});return record.done;
    }
    function retire(){retired=true;for(const record of [...records])if(record.settled)release(record);return Promise.allSettled([...records].map(record=>record.done));}
    return{hold,retire,stats:()=>({leases:records.size,pending:[...records].filter(record=>!record.settled).length,releaseErrors})};
  }
  function retainMany(assetSets) {
    const used=new Set();for(const assets of assetSets||[])for(const[name,data]of Object.entries(assets||{}))if(typeof data==='string')used.add(data.length>=1024*1024&&options.identity?options.identity(assets,name)||data:data);
    retained = used;
    trim();
  }
  function retain(assets) { retainMany([assets]); }
  function clear() {unmount();for(const entry of entries())forget(entry);urlOwners?.trim();}
  function stats() { return { entries: entries().length, blobBytes, estimatedDecodedBytes:decodedBytes, active: entries().filter(entry => entry.active).length,...(urlOwners?{urlOwners:urlOwners.stats(),workerFallbacks}: {}) }; }
  return { url, size, apply, retain, retainMany, clear, mount, refresh, pin, ensure, withImage, lease, leaseAsync, consumerPool, stats };
});
