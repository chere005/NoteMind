class FileOperationRequests{
 constructor(){this.closed=false;this.pending=new Set();this.stopping=null;}
 run(operation){if(this.closed)return Promise.reject(Error('File operations are closing.'));const pending=Promise.resolve().then(operation).finally(()=>this.pending.delete(pending));this.pending.add(pending);return pending;}
 dispose(){this.closed=true;if(this.stopping)return this.stopping;return this.stopping=(async()=>{while(this.pending.size)await Promise.allSettled([...this.pending]);})();}
}
module.exports={FileOperationRequests};
