(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: () => factory(require('./document-renderer.cjs').imageDimensions) };
  else root.NoteMindImagePreviews = factory(root.NoteMindDocument.imageDimensions);
})(typeof window === 'undefined' ? this : window, function (dimensions) {
  const cache = new Map();
  function url(name, data, type) {
    let entry = cache.get(data);
    if (!entry || entry.type !== type) {
      if (entry) URL.revokeObjectURL(entry.url);
      const bytes = typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), c => c.charCodeAt(0));
      entry = { type, size: dimensions(bytes), url: URL.createObjectURL(new Blob([bytes], { type })) };
      cache.set(data, entry);
    }
    return entry.url;
  }
  function size(name,data,type){url(name,data,type);return cache.get(data).size;}
  function apply(img,name,data,type){img.dataset.asset=name;img.src=url(name,data,type);img.loading='lazy';img.decoding='async';const dimensions=size(name,data,type);if(dimensions){img.width=dimensions.width;img.height=dimensions.height;}else{img.removeAttribute('width');img.removeAttribute('height');}}
  function retain(assets) {
    const used = new Set(Object.values(assets || {}));
    for (const [data, entry] of cache) if (!used.has(data)) { URL.revokeObjectURL(entry.url); cache.delete(data); }
  }
  function clear() { for (const entry of cache.values()) URL.revokeObjectURL(entry.url); cache.clear(); }
  return { url, size, apply, retain, clear };
});
