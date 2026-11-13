// The options of File > Export as PDF…: paper, orientation, margins, page numbers. One value gives the page the same
// size in the preview and in the file.
const SIZES={Letter:{width:8.5,height:11},A4:{width:8.27,height:11.69}};
const MARGINS={normal:0.75,narrow:0.5,none:0};
const FOOT_CLEAR=0.5;
function normalize(options={}){
 return {
  pageSize:options.pageSize==='Letter'?'Letter':'A4',
  landscape:!!options.landscape,
  margin:Object.hasOwn(MARGINS,options.margin)?options.margin:'normal',
  pageNumbers:!!options.pageNumbers,
  clean:!!options.clean,
  open:!!options.open
 };
}
// The page in inches, and the margins around its text. A page number needs a foot clear of the text even with no margin.
function geometry(options){
 const o=normalize(options),size=SIZES[o.pageSize],margin=MARGINS[o.margin],foot=o.pageNumbers?Math.max(margin,FOOT_CLEAR):margin;
 return {width:o.landscape?size.height:size.width,height:o.landscape?size.width:size.height,margins:{top:margin,bottom:foot,left:margin,right:margin}};
}
// What `webContents.printToPDF` is given.
function printOptions(options){
 const o=normalize(options),{margins}=geometry(o);
 return {
  pageSize:o.pageSize,landscape:o.landscape,printBackground:true,preferCSSPageSize:false,margins,
  displayHeaderFooter:o.pageNumbers,
  headerTemplate:'<span></span>',
  footerTemplate:o.pageNumbers?'<div style="width:100%;font-size:8px;text-align:center;color:#666;font-family:Arial,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>':'<span></span>'
 };
}
module.exports={SIZES,MARGINS,normalize,geometry,printOptions};
