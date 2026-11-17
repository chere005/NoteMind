const initial=()=>({opened:null,shown:null,page:1,error:'',status:'',loading:false,password:'',attempt:0,version:0,box:null,size:{width:600,height:600},zoom:1,reading:false,selection:null,busy:false,progress:null,thumbs:new Map(),find:false,query:'',matches:[],match:0,searching:false,pageInput:'1',fieldDocument:null});
class PDFReferenceView{
 constructor(doc){this.key=doc.key||doc.path;this.snapshot=initial();this.listeners=new Set();this.setters=new Map();this.actions=null;this.generation=0;this.closed=false;this.closeRun=null;
  this.refs={active:{current:false},binding:{current:doc.bindingId},state:{current:null},models:{current:new Map()},current:{current:null},request:{current:0},saveTimer:{current:null},importer:{current:null},closing:{current:false},warning:{current:''},pendingActions:{current:new Set()},opening:{current:null}};
  this.subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};this.getSnapshot=()=>this.snapshot;
 }
 set(key,next){if(this.closed)return;const value=typeof next==='function'?next(this.snapshot[key]):next;if(Object.is(value,this.snapshot[key]))return;this.snapshot={...this.snapshot,[key]:value};for(const listener of this.listeners)try{listener();}catch{}}
 setter(key){if(!this.setters.has(key))this.setters.set(key,next=>this.set(key,next));return this.setters.get(key);}
 attach(actions){if(this.closed)throw Error('PDF reference is closed.');this.actions=actions;return ++this.generation;}
 detach(generation){if(generation!==this.generation)return;this.refs.request.current++;clearTimeout(this.refs.saveTimer.current);this.refs.saveTimer.current=null;this.set('fieldDocument',null);void this.flush().catch(error=>this.set('status',error.message));}
 flush(){return this.actions?.flush?.()||Promise.resolve();}
 suspend(){return this.actions?.suspend?.()||Promise.resolve();}
 close(){if(this.closed)return Promise.resolve();if(this.closeRun)return this.closeRun;const run=Promise.resolve().then(()=>this.actions?.close?.()).then(()=>{this.closed=true;this.listeners.clear();this.actions=null;});this.closeRun=run;return run.finally(()=>{if(this.closeRun===run)this.closeRun=null;});}
}
class PDFReferenceViews{
 constructor(){this.values=new Map();this.closing=false;this.shutdownRun=null;}
 get(doc){if(this.closing)throw Error('PDF references are closing.');const key=doc.key||doc.path;let value=this.values.get(key);if(!value){value=new PDFReferenceView(doc);this.values.set(key,value);}return value;}
 async close(key){const value=this.values.get(key);if(!value)return;await value.close();if(this.values.get(key)===value)this.values.delete(key);}
 async flush(){await Promise.all([...this.values.values()].map(value=>value.flush()));}
 shutdown(){if(this.shutdownRun)return this.shutdownRun;this.closing=true;const run=Promise.all([...this.values.keys()].map(key=>this.close(key)));this.shutdownRun=run;return run.finally(()=>{if(this.shutdownRun===run)this.shutdownRun=null;});}
}
module.exports={PDFReferenceView,PDFReferenceViews};
