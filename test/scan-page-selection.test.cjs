const test=require('node:test'),assert=require('node:assert/strict'),{pageNumbers}=require('../src/scan-page-selection.js');
test('scan page selection preserves explicit order across individual pages and bounded ranges',()=>{assert.deepEqual(pageNumbers(' 3, 1, 8-10 ',4000),[3,1,8,9,10]);assert.equal(pageNumbers('3901-4000',4000).length,100);});
test('invalid, repeated and oversized page selections never iterate an unbounded range',()=>{for(const value of ['',',','0','4001','5-1','1.5','1,1','1-100,50','1-4000','1-999999999999999999999','all'])assert.throws(()=>pageNumbers(value,4000));});
