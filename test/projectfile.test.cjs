const {test}=require('node:test'),assert=require('node:assert/strict');
const project=require('../src/projectfile.cjs');
test('a project file uses the documented JSON representation',()=>{
 const text=project.stringify({version:2,folders:['Notes'],excluded:['/Users/example/Archive'],files:['Plan.md','Notes/Today.wm'],extra:{}});
 assert.equal(text,'{\n  "excluded" : [\n    "/Users/example/Archive"\n  ],\n  "files" : [\n    "Plan.md",\n    "Notes/Today.wm"\n  ],\n  "folders" : [\n    "Notes"\n  ],\n  "version" : 2\n}');
 assert.equal(project.stringify({version:2,folders:[],excluded:[],files:[],extra:{}}),'{\n  "excluded" : [\n\n  ],\n  "files" : [\n\n  ],\n  "folders" : [\n\n  ],\n  "version" : 2\n}');
});
test('reading keeps unknown keys and ignores entries that are not strings',()=>{
 const data=project.parse('\ufeff{"version":2,"files":["a.md",3,null],"folders":"nope","later":{"x":1}}');
 assert.deepEqual(data.files,['a.md']);assert.deepEqual(data.folders,[]);assert.deepEqual(data.extra,{later:{x:1}});
 assert.match(project.stringify(data),/"later" : \{\n    "x" : 1\n  \}/);
 assert.equal(project.parse('[1]'),null);assert.equal(project.parse('nope'),null);
 assert.equal(project.parse('{}').version,1);
});
test('paths are relative beneath the project file and absolute elsewhere',()=>{
 const file='/Users/example/Projects/Book.wmpr';
 assert.equal(project.writtenPath('/Users/example/Projects/Notes/Day.wm',file,'darwin'),'Notes/Day.wm');
 assert.equal(project.writtenPath('/Users/example/Projects',file,'darwin'),'.');
 assert.equal(project.writtenPath('/Users/example/Other/x.md',file,'darwin'),'/Users/example/Other/x.md');
 assert.equal(project.writtenPath('/Users/example/Projects/Notes',null,'darwin'),'/Users/example/Projects/Notes');
 assert.deepEqual(project.resolvePaths(['Notes/Day.wm','/Users/example/Projects/Notes/Day.wm','../Elsewhere'],file,'darwin'),['/Users/example/Projects/Notes/Day.wm','/Users/example/Elsewhere']);
});
test('a path from the other kind of machine is kept exactly as written',()=>{
 const file='C:\\Work\\Book.wmpr';
 assert.deepEqual(project.resolvePaths(['/Users/example/Notes','Notes'],file,'win32'),['/Users/example/Notes','C:\\Work\\Notes']);
 assert.equal(project.writtenPath('/Users/example/Notes',file,'win32'),'/Users/example/Notes');
 assert.deepEqual(project.resolvePaths(['C:\\Notes'],'/Users/example/Book.wmpr','darwin'),['C:\\Notes']);
 assert.equal(project.writtenPath('C:\\Work\\Notes\\A.wm',file,'win32'),'Notes/A.wm');
});
test('a project value round trips and a newer version is read only',()=>{
 const file='/Users/example/Projects/Book.wmpr',made=project.read(project.write({file,folders:['/Users/example/Projects/Notes'],files:['/Users/example/Elsewhere/a.md'],excluded:[],extra:{keep:true}},'darwin'),file,'abc','darwin');
 assert.equal(made.name,'Book');assert.deepEqual(made.folders,['/Users/example/Projects/Notes']);assert.deepEqual(made.files,['/Users/example/Elsewhere/a.md']);assert.deepEqual(made.extra,{keep:true});assert.equal(made.readOnly,false);
 assert.equal(project.read('{"version":3}',file,'x','darwin').readOnly,true);
 assert.throws(()=>project.read('[]',file,'x'));
});
