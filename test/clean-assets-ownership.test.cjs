const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Document=require('../src/document-renderer.cjs');
function clean(doc){let listener,changes=0;const source=fs.readFileSync('src/renderer.js','utf8'),start=source.indexOf("window.addEventListener('notemind-command',e=>{if(e.detail==='moveTabLeft')"),end=source.indexOf('\n',start),context={doc,activeTab:{},currentText:()=>doc.text,confirm:()=>true,markDirty:()=>changes++,moveTab(){},NoteMindDocument:Document,window:{addEventListener:(_name,fn)=>listener=fn,NoteMindPruneReplacedAssets:require('../src/prune-replaced-assets.js')},$:()=>({textContent:''})};assert.ok(start>=0);vm.runInNewContext(source.slice(start,end),context);listener({detail:'cleanAssets'});return{changes};}
test('Clean Up Unused Images preserves portable PDF markup owned by its attachment',()=>{
 const source='assets/reference.pdf',ink='assets/pdf-ink-123.json',doc={text:'[Reference]('+source+')',assets:{[source]:'JVBERg==',[ink]:'AQID','assets/orphan.png':'BAUG'},meta:{attachments:{[source]:{title:'Reference',reference:{version:1,sourceHash:'a'.repeat(64),pages:{1:{asset:ink,revision:'b'.repeat(64)}}}}}}};
 clean(doc);assert.equal(doc.assets[ink],'AQID');assert.equal(doc.assets['assets/orphan.png'],undefined);assert.equal(doc.meta.attachments[source].reference.pages[1].asset,ink);
});
test('Clean Up Unused Images recognizes encoded Markdown asset references',()=>{
 const name='assets/café space.png',doc={text:'![Kept](assets/caf%C3%A9%20space.png)',assets:{[name]:'AQID','assets/orphan.png':'BAUG'},meta:{}};clean(doc);assert.equal(doc.assets[name],'AQID');assert.equal(doc.assets['assets/orphan.png'],undefined);
});
test('Clean Up Unused Images preserves drawing and camera edit sidecars with embedded backdrops',()=>{
 const drawing='assets/drawing.svg',camera='assets/camera(1).png',backdrop=Buffer.from(JSON.stringify({name:'Camera',backdrop:'data:image/png;base64,AQID',strokes:[]})).toString('base64'),doc={text:'![Ink]('+drawing+')\n\n![Camera](assets/camera\\(1\\).png)',assets:{[drawing]:'SVG',[drawing+'.json']:'DRAWING','assets/drawing.json':'LEGACY',[camera]:'PNG',[camera+'.json']:backdrop,'assets/orphan.png':'ORPHAN'},meta:{graphicsPanes:{[drawing]:{version:1},[camera]:{version:1},'assets/orphan.png':{version:1}}}};
 clean(doc);assert.equal(doc.assets[drawing+'.json'],'DRAWING');assert.equal(doc.assets['assets/drawing.json'],'LEGACY');assert.equal(doc.assets[camera+'.json'],backdrop);assert.equal(doc.assets['assets/orphan.png'],undefined);assert.equal(doc.meta.graphicsPanes['assets/orphan.png'],undefined);
});
test('Clean Up Unused Images keeps attachment-only source, thumbnail and portable page pairs',()=>{
 const source='assets/source.pdf',thumb='assets/source.preview.png',ink='assets/ink.json',doc={text:'Body without an attachment card',assets:{[source]:'PDF',[thumb]:'THUMB',[ink]:'INK','assets/ink':'PAIR','assets/orphan.png':'ORPHAN'},meta:{attachments:{[source]:{thumbnail:thumb,reference:{pages:{1:{asset:ink}}}}}}};clean(doc);assert.deepEqual(Object.keys(doc.assets).sort(),[source,thumb,ink,'assets/ink'].sort());
});
test('Clean Up Unused Images leaves ambiguous attachment metadata intact',()=>{
 for(const attachments of ['damaged',[],{'assets/source.pdf':'damaged'},{'assets/source.pdf':{reference:'damaged'}},{'assets/source.pdf':{reference:{pages:[]}}},{'assets/source.pdf':{reference:{pages:{1:{revision:'missing asset identity'}}}}}]){
  const doc={text:'Body',assets:{'assets/plausibly-live.png':'KEEP'},meta:{attachments}},before=structuredClone(doc);assert.equal(clean(doc).changes,0);assert.deepEqual(doc,before);
 }
});
test('Clean Up Unused Images removes code-example lookalikes while preserving actual nested references',()=>{
 const doc={text:'`![Example](assets/example.png)`\n\n![![Nested](assets/nested.png)](assets/outer.png)',assets:{'assets/example.png':'EXAMPLE','assets/nested.png':'NESTED','assets/outer.png':'OUTER'},meta:{}};clean(doc);assert.deepEqual(Object.keys(doc.assets).sort(),['assets/nested.png','assets/outer.png']);
});
test('cleaned portable PDF ink survives the public Notepad archive roundtrip byte-exact',()=>{
 const codec=require('../src/pdf-ink-codec.cjs'),format=require('../src/notepad-format.cjs'),source='assets/source.pdf',name='assets/portable-ink.json',sourceHash='c'.repeat(64),ink=codec.encode({sourceHash,page:1,aspect:.7,strokes:[{colorHex:'#123456',width:2.25,points:[{x:.2,y:.3}],pressures:[.4]}]}),encoded=Buffer.from(ink).toString('base64'),doc={text:'[PDF]('+source+')',assets:{[source]:Buffer.from('%PDF immutable').toString('base64'),[name]:encoded,'assets/orphan.png':'AQID'},meta:{attachments:{[source]:{reference:{version:1,sourceHash,pages:{1:{asset:name,revision:'d'.repeat(64)}}}}}}};clean(doc);const reopened=format.decode(format.encode(doc));assert.equal(reopened.assets[name],encoded);assert.equal(codec.decode(Buffer.from(reopened.assets[name],'base64'),{sourceHash,page:1}).strokes[0].points[0].x,.2);assert.equal(reopened.assets['assets/orphan.png'],undefined);
});
