(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.NoteMindImagePreviews = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const cache = new Map();
  function url(name, data, type) {
    let entry = cache.get(data);
    if (!entry || entry.type !== type) {
      if (entry) URL.revokeObjectURL(entry.url);
      const bytes = typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), c => c.charCodeAt(0));
      entry = { type, url: URL.createObjectURL(new Blob([bytes], { type })) };
      cache.set(data, entry);
    }
    return entry.url;
  }
  function retain(assets) {
    const used = new Set(Object.values(assets || {}));
    for (const [data, entry] of cache) if (!used.has(data)) { URL.revokeObjectURL(entry.url); cache.delete(data); }
  }
  function clear() { for (const entry of cache.values()) URL.revokeObjectURL(entry.url); cache.clear(); }
  return { url, retain, clear };
});
