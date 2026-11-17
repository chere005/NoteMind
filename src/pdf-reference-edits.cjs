class ReferenceEdits{
 constructor({encode,save,revisions={}}){Object.assign(this,{encode,save});this.revisions=new Map(Object.entries(revisions).map(([page,entry])=>[Number(page),entry.revision]));this.values=new Map();this.queue=Promise.resolve();this.generation=0;}
 edited(page,strokes,aspect){const value={page,strokes:[...strokes],aspect,generation:++this.generation,promise:null};this.values.set(page,value);return value;}
 persist(value){if(value.promise)return value.promise;const run=this.queue.catch(()=>{}).then(async()=>{const bytes=await this.encode(value),saved=await this.save(value,bytes,this.revisions.get(value.page)||null);this.revisions.set(value.page,saved.revision);value.strokes=null;value.saved=true;return{revision:saved.revision};});this.queue=run;value.promise=run.catch(error=>{value.promise=null;throw error;});return value.promise;}
 async flush(page){const values=page?[this.values.get(page)].filter(Boolean):[...this.values.values()];await Promise.all(values.map(value=>value.saved?null:this.persist(value)));}
 dirty(page){return !!this.values.get(page)&&!this.values.get(page).saved;}
}
module.exports={ReferenceEdits};
