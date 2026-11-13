const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function fileActions(backupRoot,trash){
 const past=[],future=[];let pending=Promise.resolve();
 const absent=async target=>{try{await fs.lstat(target);throw Error('An item already exists at '+target);}catch(e){if(e.code!=='ENOENT')throw e;}};
 const move=async(from,to)=>{await absent(to);await fs.rename(from,to);return {from,to};};
 const snapshot=async source=>{const saved=path.join(backupRoot,crypto.randomUUID());await fs.mkdir(backupRoot,{recursive:true});await fs.cp(source,saved,{recursive:true,force:false,errorOnExist:true});return saved;};
 const restore=async(saved,target)=>{await absent(target);await fs.cp(saved,target,{recursive:true,force:false,errorOnExist:true});return {restored:target};};
 const record=step=>{past.push(step);future.length=0;};
 const serial=fn=>{const next=pending.catch(()=>{}).then(fn);pending=next;return next;};
 return {
  rename:(source,target)=>serial(async()=>{await move(source,target);record({label:'Move / Rename',undo:()=>move(target,source),redo:()=>move(source,target)});return target;}),
  create:target=>serial(async()=>{await fs.mkdir(target);record({label:'New Section',undo:()=>fs.rmdir(target),redo:()=>fs.mkdir(target)});return target;}),
  duplicate:(source,target)=>serial(async()=>{await fs.copyFile(source,target,require('node:fs').constants.COPYFILE_EXCL);let saved;record({label:'Duplicate',undo:async()=>{saved=await snapshot(target);await trash(target);},redo:()=>restore(saved,target)});return target;}),
  trash:source=>serial(async()=>{let saved=await snapshot(source);await trash(source);record({label:'Move to Trash',undo:()=>restore(saved,source),redo:async()=>{saved=await snapshot(source);await trash(source);}});}),
  // A change to a project's files or folders joins the same history; undoing it hands the snapshot back to the window.
  project:(label,before,after)=>serial(async()=>{record({label,undo:async()=>({project:before}),redo:async()=>({project:after})});}),
  step:which=>serial(async()=>{const from=which==='undo'?past:future,to=which==='undo'?future:past,step=from.at(-1);if(!step)return null;const change=await step[which]();from.pop();to.push(step);return {label:step.label,change:change?.from?change:null,restored:change?.restored,project:change?.project||null};}),
  status:()=>({undo:past.at(-1)?.label||null,redo:future.at(-1)?.label||null}),
 };
};
