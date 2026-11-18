const{test}=require('node:test'),assert=require('node:assert/strict'),{observeImageBridge}=require('./helpers/image-index-bridge-probe.cjs');
test('bridge probe records bounded scalar boundaries while returning exact reply identities',async()=>{
 const output={data:{documentByteOutput:'1',bytes:6}},part={offset:0,bytes:6,data:'AQIDBAUG'},replies=[];
 const host={executeJavaScript:async code=>{const value=code.includes('["begin"]')?'id':code.includes('["write"]')?3:code.includes('["imagePixels"]')?output:code.includes('["read"]')?part:undefined;replies.push(value);return value;}};
 const original=host.executeJavaScript,samples=[],probe=observeImageBridge(host,{sample:async row=>{samples.push(row.boundary);await host.executeJavaScript('stats()');}});
 await host.executeJavaScript('(function installImageIndexRasterHost(){})()');
 assert.equal(await host.executeJavaScript('window.x.bytes["begin"](3)'),'id');
 assert.equal(await host.executeJavaScript('window.x.bytes["write"]("id",0,"AQID")'),3);
 assert.equal(await host.executeJavaScript('window.x.tools("nonce")["imagePixels"]({})'),output);
 assert.equal(await host.executeJavaScript('window.x.bytes["read"]("id","1",0)'),part);
 await host.executeJavaScript('window.x.bytes["release"]("id")');await host.executeJavaScript('window.x.drain("nonce")');
 assert.deepEqual(samples,['after-install','before-begin','after-last-upload','after-worker-output','after-last-read','after-release','after-drain']);
 assert.equal(probe.snapshot().readChars,8);assert.equal(probe.snapshot().outputBytes,6);assert.equal(probe.snapshot().active,false);
 for(const row of probe.rows){assert.equal(Object.values(row).includes(output),false);assert.equal(Object.values(row).includes(part),false);assert.equal(Object.hasOwn(row,'data'),false);assert.equal(Object.hasOwn(row,'code'),false);}
 probe.detach();assert.equal(host.executeJavaScript,original);
});
test('probe bounds rows and isolates sampler errors from original RPC errors and returns',async()=>{
 const failure=Error('real RPC failure'),host={executeJavaScript:async code=>{if(code==='bad')throw failure;return'owner';}},probe=observeImageBridge(host,{limit:2,sample:async()=>{throw Error('probe unavailable')}});
 for(let at=0;at<100;at++)await host.executeJavaScript('x.bytes["begin"](0)');
 assert.equal(probe.rows.length,2);assert.equal(probe.snapshot().dropped,98);assert.equal(probe.rows[0].probeError,'probe unavailable');await assert.rejects(host.executeJavaScript('bad'),error=>error===failure);probe.detach();
});
