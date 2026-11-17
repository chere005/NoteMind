const {test}=require('node:test'),assert=require('node:assert/strict'),{CameraModels}=require('../src/camera-models.js');
test('async capture completion observes all intervening edits without waiting for React renders',async()=>{
 const a={page:{},name:'Live'},b={page:{},name:'Other'},models=new CameraModels([a,b]),owner=a.page;let finish;const wait=new Promise(resolve=>{finish=resolve;});
 const capture=(async()=>{await wait;models.update(old=>{const at=old.findIndex(item=>item.page===owner);if(at<0)return old;const next=old.slice();next.splice(at,0,{page:{},name:'Kept'});return next;});})();
 models.update(old=>old.map(item=>item.page===owner?{...item,name:'Renamed'}:item));models.update(old=>[old[1],old[0]]);finish();await capture;assert.deepEqual(models.current.map(item=>item.name),['Other','Kept','Renamed']);assert.equal(models.current[2].page,owner);
});
test('closed capture owners cannot insert into an unrelated page and subscribers see only committed snapshots',()=>{
 const owner={},other={},models=new CameraModels([{page:owner},{page:other}]),seen=[],unsubscribe=models.subscribe(()=>seen.push(models.getSnapshot()));models.update(old=>old.filter(item=>item.page!==owner));const committed=models.current;models.update(old=>old.some(item=>item.page===owner)?[...old,{page:{}}]:old);assert.equal(models.current,committed);assert.equal(seen.length,1);unsubscribe();models.update(old=>[...old,{page:{}}]);assert.equal(seen.length,1);assert.throws(()=>models.update([]));assert.equal(models.current.length,2);
});
