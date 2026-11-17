const fs=require('node:fs'),path=require('node:path'),moduleApi=require('node:module');
let text='Third-party software included in NoteMind\n\nElectron and Chromium license files are included beside the application.\n';const seen=new Set();
function add(name,from=process.cwd()){
 if(name.startsWith('@types/')||moduleApi.isBuiltin(name))return;
 const {root,pkg}=require('./package-root.cjs')(name,from);if(seen.has(pkg.name))return;seen.add(pkg.name);
 const licenses=fs.readdirSync(root).filter(f=>/^(licen[sc]e|copying|notice)(\.|$|-)/i.test(f)&&fs.statSync(path.join(root,f)).isFile());
 text+='\n'+pkg.name+' '+pkg.version+' ('+(pkg.license||'see package')+')\n';
 for(const file of licenses)text+='\n'+fs.readFileSync(path.join(root,file),'utf8')+'\n';
 if(!licenses.length)text+='Package license: '+pkg.license+'\n';
 for(const dep of Object.keys(pkg.dependencies||{}))add(dep,root);
}
for(const name of ['react','react-dom','scheduler','koffi','pdf-lib','docx','mammoth','markdown-it','image-size','highlight.js','turndown','turndown-plugin-gfm','onnxruntime-web','pdfjs-dist','utif','stream-json'])add(name);
text+='\nPaddleOCR PP-OCRv5 text models, converted by RapidOCR, release 3.9.2\nhttps://github.com/PaddlePaddle/PaddleOCR\nhttps://github.com/RapidAI/RapidOCR\n'+fs.readFileSync('src/helpers/text-ocr/LICENSE','utf8');
fs.writeFileSync('THIRD-PARTY-NOTICES.txt',text.replace(/\r\n?/g,'\n'));
