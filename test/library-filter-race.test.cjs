const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const source=fs.readFileSync(path.join(__dirname,'../src/shell.js'),'utf8'),pending=[],renders=[],c={libraryFilter:null,libraryHits:[],libraryFilterRun:0,window:{notemind:{notes:{list:filter=>new Promise(resolve=>pending.push({filter,resolve}))}}}};
 c.render=()=>renders.push({filter:c.libraryFilter,hits:c.libraryHits});vm.createContext(c);vm.runInContext(source.split('\n').find(line=>line.includes('async function applyLibraryFilter(')),c);
 vm.runInContext('back='+source.match(/back\.onclick=(\(\)=>\{[^}]+\})/)[1],c);return {c,pending,renders};
}
test('sidebar library filters ignore an older response arriving last',async()=>{
 const h=fixture(),first=h.c.applyLibraryFilter({pinned:true}),latest=h.c.applyLibraryFilter({tags:['work']});h.pending[1].resolve(['work note']);await latest;h.pending[0].resolve(['pinned note']);await first;
 assert.deepEqual(h.c.libraryFilter,{tags:['work']});assert.deepEqual(h.c.libraryHits,['work note']);assert.equal(h.renders.length,1);
});
test('refreshing the same sidebar filter keeps the newest response',async()=>{
 const h=fixture(),filter={pinned:true},first=h.c.applyLibraryFilter(filter),latest=h.c.applyLibraryFilter(filter);h.pending[1].resolve(['new note']);await latest;h.pending[0].resolve(['old note']);await first;
 assert.deepEqual(h.c.libraryHits,['new note']);assert.equal(h.renders.length,1);
});
test('returning to all workspace Notepads invalidates a pending filter',async()=>{
 const h=fixture(),pending=h.c.applyLibraryFilter({pinned:true});h.c.back();h.pending[0].resolve(['pinned note']);await pending;
 assert.equal(h.c.libraryFilter,null);assert.deepEqual(h.c.libraryHits,[]);assert.equal(h.renders.length,1);
});
