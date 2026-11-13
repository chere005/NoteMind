const hljs=require('highlight.js/lib/core');
const definitions=[
 ['c','C',require('highlight.js/lib/languages/c')],
 ['cpp','C++',require('highlight.js/lib/languages/cpp')],
 ['rust','Rust',require('highlight.js/lib/languages/rust')],
 ['cmake','CMake',require('highlight.js/lib/languages/cmake')],
 ['python','Python',require('highlight.js/lib/languages/python')],
 ['verilog','Verilog',require('highlight.js/lib/languages/verilog')],
 ['html','HTML',require('highlight.js/lib/languages/xml')],
 ['css','CSS',require('highlight.js/lib/languages/css')],
 ['typescript','TypeScript',require('highlight.js/lib/languages/typescript')],
 ['javascript','JavaScript',require('highlight.js/lib/languages/javascript')],
 ['bash','Bash / Zsh',require('highlight.js/lib/languages/bash')],
 ['json','JSON',require('highlight.js/lib/languages/json')],
 ['yaml','YAML',require('highlight.js/lib/languages/yaml')],
 ['ini','TOML / INI',require('highlight.js/lib/languages/ini')],
 ['sql','SQL',require('highlight.js/lib/languages/sql')],
 ['markdown','Markdown',require('highlight.js/lib/languages/markdown')],
 ['makefile','Makefile',require('highlight.js/lib/languages/makefile')],
 ['dockerfile','Dockerfile',require('highlight.js/lib/languages/dockerfile')],
 ['diff','Diff / Patch',require('highlight.js/lib/languages/diff')],
 ['go','Go',require('highlight.js/lib/languages/go')],
 ['java','Java',require('highlight.js/lib/languages/java')],
 ['csharp','C#',require('highlight.js/lib/languages/csharp')],
 ['swift','Swift',require('highlight.js/lib/languages/swift')],
 ['php','PHP',require('highlight.js/lib/languages/php')],
];
for(const [id,,grammar]of definitions)hljs.registerLanguage(id==='html'?'xml':id,grammar);
// XML is the embedded grammar name used by JavaScript, TypeScript, and PHP.
hljs.registerAliases('html',{languageName:'xml'});
const languages=definitions.map(([id,label])=>Object.freeze({id,label}));
const plain=new Set(['','text','txt','plain','plaintext','none','nohighlight']),aliases=new Map();
for(const [id,,grammar]of definitions){aliases.set(id,id);for(const name of hljs.getLanguage(id).aliases||[])aliases.set(name.toLowerCase(),id);}
aliases.set('xml','html');aliases.set('c#','csharp');aliases.set('c++','cpp');aliases.set('shell','bash');
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
const resolve=language=>aliases.get(String(language||'').trim().toLowerCase())||null;
const label=language=>languages.find(entry=>entry.id===resolve(language))?.label||(plain.has(String(language||'').toLowerCase())?'Plain Text':String(language));
// Never run detection across grammars. Bound both individual work and retained HTML.
const maxCode=65536,maxCache=2*1024*1024,cache=new Map();let cacheBytes=0;
function highlight(text,language){
 const id=resolve(language);if(!id||text.length>maxCode)return escape(text);
 const key=id+'\0'+text,known=cache.get(key);if(known){cache.delete(key);cache.set(key,known);return known.html;}
 let html;try{html=hljs.highlight(text,{language:id,ignoreIllegals:true}).value;}catch{return escape(text);}
 const bytes=(key.length+html.length)*2;
 if(bytes<=maxCache){while(cacheBytes+bytes>maxCache||cache.size>=256){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);}cache.set(key,{html,bytes});cacheBytes+=bytes;}
 return html;
}
module.exports={languages:Object.freeze(languages),resolve,label,highlight,maxCode};
