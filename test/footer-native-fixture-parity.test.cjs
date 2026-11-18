const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
for(const file of ['notes-footer-native.html','editor-retirement-native.html'])test(file+' uses the exact installed rich/source control attributes and application stylesheet',()=>{
 const app=read('src/index.html'),fixture=read('test/'+file);for(const tag of['article','textarea']){const pattern=new RegExp('<'+tag+'[^>]*id="'+(tag==='article'?'rich':'source')+'"[^>]*>');assert.equal(fixture.match(pattern)?.[0],app.match(pattern)?.[0]);}assert.deepEqual(fixture.match(/<link[^>]*rel="stylesheet"[^>]*>/g),app.match(/<link[^>]*rel="stylesheet"[^>]*>/g));assert.equal(fixture.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0],app.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0]);assert.match(fixture,/class="editor-wrap"/);assert.match(fixture,/class="workspace"/);
});
