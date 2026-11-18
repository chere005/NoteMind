const fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const root=path.resolve('src'),file=path.join(root,'word-inline.cjs'),baseline=process.argv[2],code=baseline?fs.readFileSync(baseline,'utf8'):fs.readFileSync(file,'utf8');
if(baseline){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(root);m._compile(code,file);require.cache[file]=m;}
const {countMarkdown}=require('../src/footer-markdown.cjs'),text='long **source** paragraph '.repeat(40000);countMarkdown('warm **word**');const start=performance.now(),count=countMarkdown(text);
console.log(JSON.stringify({mode:baseline?'baseline':'candidate',cacheSourceSHA:crypto.createHash('sha256').update(code).digest('hex'),sourceSHA:crypto.createHash('sha256').update(text).digest('hex'),versions:process.versions,bytes:Buffer.byteLength(text),count,wallMs:performance.now()-start,memory:process.memoryUsage()}));
