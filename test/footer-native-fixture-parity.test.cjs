const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
test('native footer fixture uses the exact installed rich/source control attributes and application stylesheet',()=>{
 const app=read('src/index.html'),fixture=read('test/notes-footer-native.html');for(const tag of['article','textarea']){const pattern=new RegExp('<'+tag+'[^>]*id="'+(tag==='article'?'rich':'source')+'"[^>]*>');assert.equal(fixture.match(pattern)?.[0],app.match(pattern)?.[0]);}assert.match(fixture,/<link rel="stylesheet" href="style\.css">/);assert.match(fixture,/class="editor-wrap"/);assert.match(fixture,/class="workspace"/);
});
