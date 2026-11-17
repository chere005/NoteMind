const {test}=require('node:test'),assert=require('node:assert/strict');
const {releaseOwnedInkPacket}=require('../src/owned-ink-packet.js');
test('private transferred identity packets detach after preparation while live binary owners remain exact',()=>{
 const raw=new Uint8Array(64),ids=new Float64Array(10),insert=new Float64Array(2),packet={additions:raw,order:ids,addIds:ids,patches:[{insert}]};raw[0]=19;
 releaseOwnedInkPacket(packet,[{bytes:raw}]);assert.equal(ids.byteLength,0);assert.equal(insert.byteLength,0);assert.equal(raw.byteLength,64);assert.equal(raw[0],19);assert.equal(packet.order,null);assert.equal(packet.patches,null);releaseOwnedInkPacket(packet,[{bytes:raw}]);assert.equal(raw[0],19);
});
test('private unused additions detach on failure without touching another batch or generic request',()=>{
 const rejected=new Uint8Array(32),current=new Uint8Array(48),packet={additions:rejected,order:new Float64Array(1)},untouched={order:new Float64Array(4)};
 releaseOwnedInkPacket(packet,[{bytes:current}]);assert.equal(rejected.byteLength,0);assert.equal(current.byteLength,48);assert.equal(untouched.order.byteLength,32);
});
