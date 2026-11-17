(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: options => factory(require('./document-renderer.cjs').imageDimensions, options) };
  else root.NoteMindImagePreviews = factory(root.NoteMindDocument.imageDimensions, {lazy:true,identity:(assets,name)=>root.NoteMindDocumentSync?.assetIdentity?.(assets,name),chunks:(assets,name)=>root.NoteMindDocumentSync?.assetChunks?.(assets,name)});
})(typeof window === 'undefined' ? this : window, function (dimensions, options = {}) {
  const cache = new Map(), placeholders = new Map(), bound = new Map(), pins = new Map();
  const urls = options.urls || URL, makeBlob = options.makeBlob || ((bytes, type) => new Blob([bytes], { type }));
  const decode = options.decode || (data => typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), c => c.charCodeAt(0)));
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
  let clock = 0, serial = 0, blobBytes = 0, decodedBytes = 0, host = null, assetsFor = null, observer = null, scheduled = false, retained = null;
  const entries = () => Array.from(cache.values()).flatMap(types => Array.from(types.values()));
  function revoke(entry) { if (!entry.url) return; urls.revokeObjectURL(entry.url); blobBytes -= entry.bytes; decodedBytes -= entry.decodedBytes; entry.url = null; }
  function forget(entry) { revoke(entry); placeholders.delete(entry.placeholder); const types = cache.get(entry.key); types?.delete(entry.type); if (!types?.size) cache.delete(entry.key); }
  function trim() {
    const attached = new Set(bound.values());
    for (const entry of entries()) if (retained && !retained.has(entry.key) && !entry.active && !attached.has(entry)) forget(entry);
    const values = entries().sort((a, b) => a.used - b.used);
    for (const entry of values) if ((blobBytes > maxBytes || decodedBytes > maxDecodedBytes) && !entry.active) revoke(entry);
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
      // Reclaim inactive native image resources before a new decode can overlap them.
      for (const prior of entries().filter(value=>value!==entry&&value.url&&!value.active).sort((a,b)=>a.used-b.used)) {
        if (blobBytes+entry.bytes<=maxBytes&&decodedBytes+entry.decodedBytes<=maxDecodedBytes) break;
        revoke(prior);
      }
      entry.url = urls.createObjectURL(blob(entry)); blobBytes += entry.bytes; decodedBytes += entry.decodedBytes;
    }
    entry.used = ++clock; return entry.url;
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
  function deactivate(img, entry) { if (img.getAttribute('src') === entry.url) img.src = entry.placeholder; entry.active = Math.max(0, entry.active - 1); }
  function refresh() {
    scheduled = false; if (!host) return;
    const images = new Set(host.querySelectorAll('img[data-asset]'));
    for (const [img, entry] of bound) if (!images.has(img) || assetsFor()?.[img.dataset.asset] !== entry.data) { if (entry.visible?.has(img)) { entry.visible.delete(img); deactivate(img, entry); } bound.delete(img); pins.delete(img); }
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
    for (const [img, entry] of wanted) { if (!entry.visible.has(img)) { entry.visible.add(img); entry.active++; } const src = materialize(entry); if (img.getAttribute('src') !== src) img.src = src; }
    trim();
  }
  function schedule() { if (!host || scheduled) return; scheduled = true; (options.schedule || (fn => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : queueMicrotask(fn)))(refresh); }
  function mount(element, getAssets) {
    unmount(); host = element; assetsFor = getAssets;
    if (typeof MutationObserver === 'function') { observer = new MutationObserver(schedule); observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-asset', 'hidden'] }); }
    if (typeof window !== 'undefined') { window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); }
    schedule();
  }
  function unmount() {
    observer?.disconnect(); observer = null;
    if (typeof window !== 'undefined') { window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); }
    for (const [img, entry] of bound) if (entry.visible?.delete(img)) deactivate(img, entry);
    bound.clear(); pins.clear(); host = null; assetsFor = null; scheduled = false; trim();
  }
  function pin(img) {
    refresh(); const entry = bound.get(img); if (!entry) throw Error('The original picture is no longer open.');
    pins.set(img, (pins.get(img) || 0) + 1); refresh(); let released = false;
    return () => { if (released) return; released = true; const count = (pins.get(img) || 0) - 1; if (count > 0) pins.set(img, count); else pins.delete(img); schedule(); };
  }
  async function ensure(img) {
    const release = pin(img), entry = bound.get(img), name = img.dataset.asset;
    try { await img.decode(); if (!host?.contains(img) || assetsFor()?.[name] !== entry.data || bound.get(img) !== entry || img.getAttribute('src') !== entry.url) throw Error('The original picture is no longer open.'); return img; }
    finally { release(); }
  }
  async function withImage(img, run) { const release = pin(img); try { await ensure(img); return await run(img); } finally { release(); } }
  function lease(name,data,type){const entry=get(name,data,type);entry.active++;let url;try{url=materialize(entry);trim();}catch(error){entry.active--;trim();throw error;}let released=false;return {url,release(){if(released)return;released=true;entry.active=Math.max(0,entry.active-1);trim();}};}
  function retainMany(assetSets) {
    const used=new Set();for(const assets of assetSets||[])for(const[name,data]of Object.entries(assets||{}))if(typeof data==='string')used.add(data.length>=1024*1024&&options.identity?options.identity(assets,name)||data:data);
    retained = used;
    trim();
  }
  function retain(assets) { retainMany([assets]); }
  function clear() { unmount(); for (const entry of entries()) forget(entry); }
  function stats() { return { entries: entries().length, blobBytes, estimatedDecodedBytes:decodedBytes, active: entries().filter(entry => entry.active).length }; }
  return { url, size, apply, retain, retainMany, clear, mount, refresh, pin, ensure, withImage, lease, stats };
});
