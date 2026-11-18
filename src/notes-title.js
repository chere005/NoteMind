// Title previews stop after their visible prefix; exceptional prefixes resolve cooperatively.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NoteMindNoteTitle=api;})(typeof window==='object'?window:globalThis,()=>{
 const LIMIT=100,STEP=65536,punctuation=/^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/,whitespace=/\s/u,removed=/[*_`=]/;
 const abort=()=>Object.assign(Error('Title calculation cancelled.'),{name:'AbortError'});
 function create(text){return{text:String(text??''),at:0,mode:'prefix',title:'',pending:'',imageStart:-1,invalidImage:-1,invalidUntil:0,depth:0,result:null};}
 function done(state,end,found=true){return state.result={title:found?state.title:'Untitled',end,found};}
 function emit(state,value,end){if(whitespace.test(value)){if(state.title&&state.title.length+state.pending.length<LIMIT)state.pending+=value;return false;}if(state.pending){const left=LIMIT-state.title.length;state.title+=state.pending.slice(0,left);state.pending='';if(state.title.length>=LIMIT){done(state,end);return true;}}if(state.title.length+value.length>LIMIT){done(state,end);return true;}state.title+=value;if(state.title.length>=LIMIT){done(state,end);return true;}return false;}
 function nextLine(state){state.pending='';if(state.title){done(state,state.at);return;}state.at++;state.mode='prefix';state.invalidImage=-1;state.invalidUntil=0;}
 function invalidImage(state){state.invalidUntil=Math.max(state.invalidUntil,state.at+1);state.at=state.imageStart;state.invalidImage=state.imageStart;state.imageStart=-1;state.mode='normal';}
 function advance(state,budget=STEP){const{text}=state;let inspected=0;while(!state.result&&inspected<budget){if(state.at>=text.length){if(state.mode==='imageAlt'||state.mode==='imageTarget'){invalidImage(state);continue;}done(state,text.length,!!state.title);break;}const at=state.at,c=text[at];inspected++;
   if(state.mode==='imageAlt'){if(c==='\n'){invalidImage(state);continue;}if(c==='\\'&&at+1<text.length){state.at+=2;continue;}if(c===']'){if(text[at+1]==='('){state.at+=2;state.depth=1;state.mode='imageTarget';continue;}invalidImage(state);continue;}state.at++;continue;}
   if(state.mode==='imageTarget'){if(c==='\n'){invalidImage(state);continue;}if(c==='\\'&&at+1<text.length){state.at+=2;continue;}state.at++;if(c==='(')state.depth++;else if(c===')'&&!--state.depth){state.mode='normal';state.imageStart=-1;}continue;}
   if(c==='\n'){nextLine(state);continue;}
   if(state.mode==='prefix'||state.mode==='prefixSpace'||state.mode==='bulletSpace'||state.mode==='checkboxSpace'){
    if(whitespace.test(c)){state.at++;continue;}
    if(state.mode==='prefix'){let n=0;if(c==='#'){while(n<7&&text[at+n]==='#')n++;if(n<=6&&text[at+n]!=='\n'&&whitespace.test(text[at+n]||'')){state.at+=n;state.mode='prefixSpace';continue;}}if('+-*'.includes(c)&&text[at+1]!=='\n'&&whitespace.test(text[at+1]||'')){state.at++;state.mode='bulletSpace';continue;}}
    if(state.mode==='bulletSpace'&&c==='['&&/^[ xX]$/.test(text[at+1]||'')&&text[at+2]===']'){state.at+=3;state.mode='checkboxSpace';continue;}state.mode='normal';
   }
   if(c==='!'&&text[at+1]==='['&&at>=state.invalidUntil){state.imageStart=at;state.at+=2;state.mode='imageAlt';continue;}
   if(c==='\\'&&punctuation.test(text[at+1]||'')){state.at+=2;emit(state,text[at+1],state.at);continue;}
   if(removed.test(c)){state.at++;continue;}
   const point=text.codePointAt(at),value=String.fromCodePoint(point);state.at+=value.length;emit(state,value,state.at);
  }return state.result;}
 function validBudget(budget){if(!Number.isSafeInteger(budget)||budget<1||budget>STEP)throw Error('Invalid title scan budget.');return budget;}
 function automaticTitleInfo(text,{budget=STEP}={}){validBudget(budget);const state=create(text),result=advance(state,budget);return result||{title:state.title||'Untitled',end:state.at,found:false,deferred:true};}
 async function resolveAutomaticTitleInfo(text,{signal,check=()=>{},yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),budget=STEP}={}){validBudget(budget);const state=create(text),guard=()=>{if(signal?.aborted)throw abort();check();};for(;;){guard();const result=advance(state,budget);if(result){guard();return result;}await yieldTask();}}
 return{automaticTitleInfo,resolveAutomaticTitleInfo};
});
