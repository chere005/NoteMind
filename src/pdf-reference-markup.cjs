// Committed stroke objects and their point arrays are immutable and shared with the tablet drawing engine.
const HASH=/^[a-f0-9]{64}$/i,EMPTY=Object.freeze([]);
class MarkupBook {
 constructor({sourceHash,pageCount,pages={}}, {maxPoints=2000000,maxRetainedPoints=4000000,historyLimit=64}={}){
  if(!HASH.test(sourceHash)||!Number.isInteger(pageCount)||pageCount<1||pageCount>10000||maxRetainedPoints<maxPoints)throw Error('Invalid PDF markup source.');
  Object.assign(this,{sourceHash,pageCount,maxPoints,maxRetainedPoints,historyLimit});this.pages=new Map();this.counts=new WeakMap();this.references=new Map();this.history=[];this.currentPoints=0;this.retainedPoints=0;this.revision=0;this.savedRevision=0;
  for(const [page,strokes]of Object.entries(pages)){if(String(Number(page))!==page)throw Error('Invalid PDF markup page.');this.commit(Number(page),strokes,false);}
  this.revision=this.savedRevision=0;
 }
 pageNumber(page){if(!Number.isInteger(page)||page<1||page>this.pageCount)throw Error('Invalid PDF markup page.');}
 strokePoints(stroke){
  if(this.counts.has(stroke))return this.counts.get(stroke);
  if(!stroke||!/^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(stroke.colorHex)||!Number.isFinite(stroke.width)||stroke.width<=0||stroke.width>1000||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>this.maxPoints||stroke.opacity!==undefined&&(!Number.isFinite(stroke.opacity)||stroke.opacity<0||stroke.opacity>1))throw Error('Invalid PDF ink stroke.');
  for(const point of stroke.points)if(!point||![point.x,point.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=16))throw Error('Invalid PDF ink point.');
  if(stroke.pressures!==undefined&&(!Array.isArray(stroke.pressures)||stroke.pressures.length!==stroke.points.length||stroke.pressures.some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('Invalid PDF ink pressure.');
  this.counts.set(stroke,stroke.points.length);return stroke.points.length;
 }
 count(strokes){if(!Array.isArray(strokes)||strokes.length>this.maxPoints)throw Error('Invalid PDF ink page.');let points=0;for(const stroke of strokes){points+=this.strokePoints(stroke);if(points>this.maxPoints)throw Error('This PDF ink page is too large.');}return points;}
 state(page){this.pageNumber(page);return this.pages.get(page)||{strokes:EMPTY,points:0,past:[],future:[]};}
 hold(strokes){for(const stroke of strokes){const count=this.references.get(stroke)||0;if(!count)this.retainedPoints+=this.strokePoints(stroke);this.references.set(stroke,count+1);}}
 drop(strokes){for(const stroke of strokes){const count=this.references.get(stroke)-1;if(count)this.references.set(stroke,count);else{this.references.delete(stroke);this.retainedPoints-=this.strokePoints(stroke);}}}
 removeHistory(page,list,strokes){const at=this.history.findIndex(value=>value.page===page&&value.list===list&&value.strokes===strokes);if(at>=0)this.history.splice(at,1);}
 clearList(page,state,list){for(const strokes of state[list]){this.removeHistory(page,list,strokes);this.drop(strokes);}state[list]=[];}
 trim(){while(this.history.length&&(this.history.length>this.historyLimit||this.retainedPoints>this.maxRetainedPoints)){const oldest=this.history.shift(),state=this.pages.get(oldest.page),at=state[oldest.list].indexOf(oldest.strokes);if(at>=0){state[oldest.list].splice(at,1);this.drop(oldest.strokes);}}}
 commit(page,strokes,recordHistory=true){
  const old=this.state(page),points=this.count(strokes);if(strokes===old.strokes)return false;if(this.currentPoints-old.points+points>this.maxPoints)throw Error('This PDF markup exceeds the ink point budget.');
  const next=Object.freeze(strokes.slice()),state={...old,strokes:next,points};this.hold(next);this.clearList(page,state,'future');
  if(recordHistory){state.past=[...old.past,old.strokes];this.history.push({page,list:'past',strokes:old.strokes});}else this.drop(old.strokes);
  this.pages.set(page,state);this.currentPoints+=points-old.points;this.revision++;this.trim();return true;
 }
 step(page,redo=false){
  const state=this.state(page),from=redo?'future':'past',to=redo?'past':'future',strokes=state[from].at(-1);if(!strokes)return false;const points=this.count(strokes);if(this.currentPoints-state.points+points>this.maxPoints)throw Error('Undo exceeds the PDF ink point budget.');
  state[from].pop();this.removeHistory(page,from,strokes);state[to].push(state.strokes);this.history.push({page,list:to,strokes:state.strokes});this.currentPoints+=points-state.points;state.strokes=strokes;state.points=points;this.revision++;this.trim();return true;
 }
 strokes(page){return this.state(page).strokes;}
 undo(page){return this.step(page);}
 redo(page){return this.step(page,true);}
 snapshot(){return {format:'notemind-pdf-ink',version:1,sourceHash:this.sourceHash,pageCount:this.pageCount,pages:Object.fromEntries([...this.pages].filter(([,state])=>state.strokes.length).map(([page,state])=>[page,state.strokes]))};}
 markSaved(revision=this.revision){if(revision===this.revision)this.savedRevision=revision;}
 get dirty(){return this.savedRevision!==this.revision;}
 stats(){return {points:this.currentPoints,retainedPoints:this.retainedPoints,history:this.history.length,revision:this.revision};}
 static restore(value,expectedHash,options){if(!value||value.format!=='notemind-pdf-ink'||value.version!==1||value.sourceHash!==expectedHash||!value.pages||typeof value.pages!=='object'||Array.isArray(value.pages))throw Error('This markup belongs to another PDF or is damaged.');return new MarkupBook(value,options);}
}
module.exports={MarkupBook};
