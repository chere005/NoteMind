const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),generatedFooter='src/notes-footer-markdown.js';
function verifyReceiptFile(file,{stat=fs.statSync,buildSource,buildDriver}={}){
 try{assert.ok(stat(path.resolve(root,file)).isFile(),file);return;}catch(error){if(error.code!=='ENOENT'||file!==generatedFooter)throw error;}
 const build=buildSource??fs.readFileSync(path.join(root,'scripts/build-documents.cjs'),'utf8'),driver=buildDriver??fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8');
 const recipes=[...build.matchAll(/await esbuild\.build\((\{[^\n]+\})\);/g)].map(match=>vm.runInNewContext('('+match[1]+')')).filter(recipe=>recipe.outfile===file);
 assert.equal(recipes.length,1,'missing generated footer must have one exact build declaration');
 assert.deepEqual(JSON.parse(JSON.stringify(recipes[0])),{entryPoints:['src/footer-markdown.cjs'],bundle:true,platform:'browser',format:'iife',globalName:'NoteMindFooterMarkdown',outfile:generatedFooter,minify:true});
 assert.ok(stat(path.join(root,recipes[0].entryPoints[0])).isFile(),'the declared footer build source must exist');
 assert.match(driver,/cp\.execFileSync\(process\.execPath,\s*\['scripts\/build-documents\.cjs'\]/);
 assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/^src\/notes-footer-markdown\.js$/m);
}
test('counter-only source receipt names actual controller/fixture/Worker dependencies without an invented bootstrap',()=>{const source=fs.readFileSync(require.resolve('./footer-counter-only-native.cjs'),'utf8'),match=source.match(/report\.files=Object\.fromEntries\((\[[^\]]+\])\.map/);assert.ok(match);const files=vm.runInNewContext(match[1]);for(const file of files)verifyReceiptFile(file);for(const file of['test/footer-counter-only-native.cjs','test/footer-counter-only-native.html','src/notes-footer.js','src/notes-footer-markdown.js','src/document-text-limit.cjs'])assert.ok(files.includes(file),file);assert.doesNotMatch(source,/notes-footer-counter-only-native-bootstrap/);const html=fs.readFileSync(require.resolve('./footer-counter-only-native.html'),'utf8');assert.doesNotMatch(html,/<script\b/);assert.match(source,/new Worker\(new URL\('notes-footer\.js',document\.baseURI\)\)/);});

test('counter-only qualification keeps the original styled16 workload and permits only a separate declared17MiB one-word case',()=>{const source=fs.readFileSync(require.resolve('./footer-counter-only-native.cjs'),'utf8');assert.match(source,/process\.argv\[2\]\|\|'styled16'/);assert.match(source,/\['styled16','above-word-limit17'\]\.includes\(scenario\)/);assert.match(source,/expectedWords=scenario==='styled16'\?1935831:1/);assert.match(source,/expectedBytes=\(scenario==='styled16'\?16:17\)\*1024\*1024/);assert.match(source,/f50aa3d715f86ee06444e5a7a004e19b45f229f377c18994a6d6b7fe2853cf1f/);assert.match(source,/hash\.update\(chunk\)/);assert.match(source,/30000/);assert.match(source,/total>1024\*1024\*1024/);});

const missing=()=>{throw Object.assign(Error('fixture path absent'),{code:'ENOENT'})};
test('receipt validation accepts only the declared generated footer when its exact browser recipe and source exist',()=>{
 const stat=file=>file===path.join(root,generatedFooter)?missing():fs.statSync(file);
 assert.doesNotThrow(()=>verifyReceiptFile(generatedFooter,{stat}));
 for(const file of['src/footer-phantom.js','src/notes-footer.js'])assert.throws(()=>verifyReceiptFile(file,{stat:missing}),{code:'ENOENT'});
 const source=fs.readFileSync(path.join(root,'scripts/build-documents.cjs'),'utf8');
 assert.throws(()=>verifyReceiptFile(generatedFooter,{stat,buildSource:source.replace("outfile:'src/notes-footer-markdown.js'","outfile:'src/phantom-footer.js'")}));
 assert.throws(()=>verifyReceiptFile(generatedFooter,{stat,buildSource:source.replace("entryPoints:['src/footer-markdown.cjs']","entryPoints:['src/notes-footer.js']")}));
 assert.throws(()=>verifyReceiptFile(generatedFooter,{stat,buildDriver:''}));
 assert.throws(()=>verifyReceiptFile(generatedFooter,{stat:missing}),{code:'ENOENT'});
});
test('native receipt still requires built footer bytes and hashes them before and after qualification',()=>{const source=fs.readFileSync(require.resolve('./footer-counter-only-native.cjs'),'utf8');assert.match(source,/report\.files=Object\.fromEntries/);assert.match(source,/crypto\.createHash\('sha256'\)\.update\(fs\.readFileSync\(file\)\)/);assert.match(source,/for\(const\[file,sha\]of Object\.entries\(report\.files\)\)/);assert.doesNotMatch(source,/existsSync\(file\)/);});
