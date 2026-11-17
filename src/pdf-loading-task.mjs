// Worker fetch must be explicit for file:// helpers: ICC conversion requires it.
// Keep every resource relative so the same options work in the packaged app.
const base=new URL('./vendor/pdfjs/',import.meta.url);
export function openPDF(pdfjs,data,password){
 return pdfjs.getDocument({data,password,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href,useWorkerFetch:true,useSystemFonts:true,isEvalSupported:false});
}
