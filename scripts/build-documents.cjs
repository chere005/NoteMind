const esbuild=require('esbuild');
const fs=require('node:fs');
(async()=>{
 await esbuild.build({entryPoints:['src/pdf-reference-worker-entry.js'],bundle:true,platform:'browser',format:'iife',outfile:'src/pdf-reference-worker.js',minify:true});
 await esbuild.build({entryPoints:['src/pdf-ink-codec.cjs'],bundle:true,platform:'browser',format:'iife',globalName:'NoteMindPDFInkCodec',outfile:'src/pdf-ink-browser.js',minify:true});
 await esbuild.build({entryPoints:['src/ocr/png.ts'],bundle:true,platform:'node',format:'cjs',outfile:'src/png-rgba.cjs',minify:true});
 const path=require('node:path'),crypto=require('node:crypto');
 const models=JSON.parse(fs.readFileSync('src/helpers/text-ocr/models.json','utf8'));
 for(const model of models.models){const bytes=fs.readFileSync(path.join('src/helpers/text-ocr/models',model.file));if(bytes.length!==model.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==model.sha256)throw Error('Text model failed verification: '+model.file);}
 await esbuild.build({entryPoints:['src/ocr/worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'src/helpers/text-ocr/worker.mjs',banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'},minify:true});
 await esbuild.build({entryPoints:['src/tablet/renderer/paperWorker.ts'],bundle:true,platform:'browser',format:'iife',outfile:'src/paper-worker.js',minify:true});
 await esbuild.build({entryPoints:['src/start-entry.tsx'],bundle:true,platform:'browser',format:'iife',jsx:'automatic',outfile:'src/welcome.js',minify:true});
 if(fs.existsSync('src/document-renderer.cjs'))await esbuild.build({entryPoints:['src/document-renderer.cjs'],bundle:true,platform:'browser',format:'iife',globalName:'NoteMindDocument',supported:{'template-literal':false},outfile:'src/document-renderer.js',minify:true});
})().catch(e=>{console.error(e);process.exit(1)});
