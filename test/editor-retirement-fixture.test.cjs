const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('native editor controller hashes every actual renderer, layout and bootstrap authority before and after execution',()=>{
 const source=fs.readFileSync(require.resolve('./editor-retirement-native.cjs'),'utf8'),match=source.match(/report\.files=Object\.fromEntries\((\[[^\]]+\])\.map/);assert.ok(match);const files=vm.runInNewContext(match[1]);for(const file of files)assert.ok(fs.statSync(path.join(root,file)).isFile(),file);
 for(const file of['src/renderer.js','src/document-renderer.js','src/index.html','src/notes-core.js','src/notes-history.js','src/notes-attachments.js','test/editor-retirement-native.cjs','test/editor-retirement-native.html','test/editor-retirement-native-bootstrap.js'])assert.ok(files.includes(file),file);
 const html=fs.readFileSync(require.resolve('./editor-retirement-native.html'),'utf8');for(const match of html.matchAll(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"/g)){const file=path.posix.normalize('src/'+match[2]);assert.ok(files.includes(file),file);}
 assert.doesNotMatch(source,/notes-find-native|notes-editor-retirement-native-bootstrap/);assert.match(source,/report\.filesUnchanged=true/);assert.match(source,/Object\.entries\(report\.files\)/);
 const renderer=fs.readFileSync(path.join(root,'src/renderer.js'),'utf8'),names=vm.runInNewContext(source.match(/names=(\[[^\]]+\])/)[1]);for(const name of names)assert.ok(renderer.split('\n').some(line=>line.startsWith('function '+name+'(')),name);assert.ok(renderer.match(/^function refreshEditor[\s\S]*?^}/m));
});
