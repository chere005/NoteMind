// A reference owns one serial stream of bounded requests. Closing prevents any
// queued work, joins the active request, then releases its exact session token.
class WordPreviewClient{
 constructor(api,{requestId=()=>crypto.randomUUID()}={}){this.api=api;this.requestId=requestId;this.tail=Promise.resolve();this.closed=false;this.token=null;this.pending=new Set();}
 async request(operation,args){if(this.closed)throw Error('This Word preview has closed.');const requestId=this.requestId();this.pending.add(requestId);try{return await this.api[operation](...args,{requestId});}finally{this.pending.delete(requestId);}}
 open(file){if(this.opening)return this.opening;this.opening=this.request('open',[file]).then(async value=>{this.token=value.token;if(this.closed)throw Error('This Word preview has closed.');return value;});this.tail=this.opening.then(()=>{},()=>{});return this.opening;}
 call(operation,...args){return this.current(()=>true,operation,...args);}
 current(valid,operation,...args){const next=this.tail.catch(()=>{}).then(()=>{if(this.closed||!valid())throw Error('This Word preview has closed.');return this.request(operation,[this.token,...args]);});this.tail=next.then(()=>{},()=>{});return next;}
 close(){if(this.closing)return this.closing;this.closed=true;this.closing=(async()=>{await Promise.allSettled([...this.pending].map(id=>this.api.cancel(id)));await Promise.allSettled([this.opening,this.tail]);if(this.token)await this.api.release(this.token);})();return this.closing;}
}
module.exports={WordPreviewClient};
