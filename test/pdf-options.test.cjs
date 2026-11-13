const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,geometry,printOptions}=require('../src/pdf-options.cjs');
test('PDF options fall back to A4 portrait with normal margins and nothing extra',()=>{
 assert.deepEqual(normalize(),{pageSize:'A4',landscape:false,margin:'normal',pageNumbers:false,clean:false,open:false});
 assert.deepEqual(normalize({pageSize:'Tabloid',margin:'huge',landscape:1,pageNumbers:'yes'}),{pageSize:'A4',landscape:true,margin:'normal',pageNumbers:true,clean:false,open:false});
});
test('the page and its margins come from one value',()=>{
 assert.deepEqual(geometry({pageSize:'Letter'}),{width:8.5,height:11,margins:{top:0.75,bottom:0.75,left:0.75,right:0.75}});
 assert.equal(geometry({pageSize:'Letter',landscape:true}).width,11);
 assert.deepEqual(geometry({margin:'narrow'}).margins,{top:0.5,bottom:0.5,left:0.5,right:0.5});
 assert.deepEqual(geometry({margin:'none'}).margins,{top:0,bottom:0,left:0,right:0});
 assert.equal(geometry({margin:'none',pageNumbers:true}).margins.bottom,0.5,'a page number keeps a clear foot with no margin');
});
test('printToPDF is given the margins, paper and a centred n / N footer only when asked',()=>{
 const plain=printOptions({pageSize:'Letter'});
 assert.equal(plain.displayHeaderFooter,false);assert.equal(plain.preferCSSPageSize,false);assert.equal(plain.pageSize,'Letter');
 const numbered=printOptions({pageNumbers:true,landscape:true});
 assert.equal(numbered.displayHeaderFooter,true);assert.equal(numbered.landscape,true);assert.match(numbered.footerTemplate,/pageNumber[\s\S]*totalPages/);
});
