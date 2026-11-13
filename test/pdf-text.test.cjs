const {test}=require('node:test'),assert=require('node:assert/strict');
test('PDF glyph runs preserve words, lines, and phrase search',async()=>{
 const {textOfBlocks,findTextBlocks}=await import('../src/pdf-text.mjs');
 const blocks=[{text:'Veri',x:.1,y:.1,width:.08,height:.02},{text:'fi',x:.18,y:.1,width:.02,height:.02},{text:'cation',x:.2,y:.1,width:.12,height:.02},{text:'passed',x:.35,y:.1,width:.12,height:.02},{text:'Next line',x:.1,y:.16,width:.2,height:.02}];
 assert.equal(textOfBlocks(blocks),'Verification passed\nNext line');
 const matches=findTextBlocks(blocks,'Verification passed');assert.equal(matches.length,1);assert.equal(matches[0].x,.1);assert.ok(Math.abs(matches[0].width-.37)<.0001);
 assert.equal(findTextBlocks(blocks,'missing').length,0);
});
