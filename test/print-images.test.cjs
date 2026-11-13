const {test}=require('node:test'),assert=require('node:assert/strict');
const {preparePrint}=require('../src/print-images.cjs');
test('clean preview uses temporary pictures without changing the source document',async()=>{
 const source={text:'![A](assets/a.png) ![B](assets/print-clean-1.png)',assets:{'assets/a.png':'first','assets/print-clean-1.png':'second','assets/other.pdf':'attachment'}};
 const copy=await preparePrint(source,true,async(data,type,clean)=>{assert.equal(type,'image/png');assert.equal(clean,true);return {data:'clean-'+data};});
 assert.equal(source.assets['assets/a.png'],'first');assert.equal(source.assets['assets/print-clean-1.png'],'second');assert.match(source.text,/assets\/a.png/);
 assert.doesNotMatch(copy.text,/\(assets\/a.png\)/);assert.doesNotMatch(copy.text,/\(assets\/print-clean-1.png\)/);
 assert.equal(Object.values(copy.assets).filter(x=>x.startsWith('clean-')).length,2);assert.equal(copy.assets['assets/other.pdf'],'attachment');
 assert.equal(await preparePrint(source,false,()=>{throw Error('not called')}),source);
});
