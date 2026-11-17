const path=require('node:path'),{createHash}=require('node:crypto');
const {readLimited}=require('./read-limited.cjs');
// Runs in the archive worker. A receipt applies only to these exact committed bytes.
async function readCommitted(file,revision){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw Error('Invalid recovery commit receipt.');
 const ext=path.extname(file).toLowerCase();if(!['.nm','.wm','.md','.txt','.py'].includes(ext))throw Error('Invalid recovery commit file.');
 const bytes=await readLimited(file,200*1024*1024,'Open Notepads up to 200 MB.');
 if(createHash('sha256').update(bytes).digest('hex')!==revision)return null;
 if(['.nm','.wm'].includes(ext)){const {files,kind,...doc}=require('./notepad-format.cjs').decode(bytes);return doc;}
 if(ext==='.md')return require('./markdown-files.cjs').read(file,bytes.toString('utf8'));
 return {text:bytes.toString('utf8'),assets:{}};
}
module.exports={readCommitted};
