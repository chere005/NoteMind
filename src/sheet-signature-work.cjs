const {hashWriter}=require('./stroke-signature.js'),{yieldTask}=require('./graphics-pane.js');
const aborted=()=>Object.assign(Error('Drawing signature preparation cancelled.'),{name:'AbortError'});
function scheduler({signal,valid=()=>true,yieldControl=yieldTask}={}){let work=0,ticks=0,start=performance.now();const check=()=>{if(signal?.aborted||!valid())throw aborted();};return{check,step(units=1){work+=units;if(++ticks<256&&work<65536)return null;ticks=0;if(work<65536&&performance.now()-start<3)return null;check();return Promise.resolve(yieldControl()).then(()=>{check();work=0;start=performance.now();});}};}
function prepared(value,key){if(value!==null&&(typeof value==='object'||typeof value==='bigint')&&typeof value.toJSON==='function')value=value.toJSON(key);if(value instanceof Number)value=Number(value);else if(value instanceof String)value=String(value);else if(value instanceof Boolean)value=Boolean.prototype.valueOf.call(value);else if(value instanceof BigInt)value=BigInt.prototype.valueOf.call(value);return value;}
const absent=value=>value===undefined||typeof value==='function'||typeof value==='symbol';
function* jsonString(value){yield '"';for(let at=0;at<value.length;){let end=Math.min(value.length,at+8192);if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end++;yield JSON.stringify(value.slice(at,end)).slice(1,-1);at=end;}yield '"';}
function* jsonTokens(input){
 const parents=new Set(),stack=[{kind:'value',input,key:'',already:false}];
 while(stack.length){const frame=stack[stack.length-1];
  if(frame.kind==='text'){stack.pop();yield frame.text;continue;}
  if(frame.kind==='string'){stack.pop();yield*jsonString(frame.text);continue;}
  if(frame.kind==='value'){stack.pop();const value=frame.already?frame.input:prepared(frame.input,frame.key);
   if(typeof value==='string'){yield*jsonString(value);continue;}if(value===null||typeof value!=='object'){const text=JSON.stringify(value);if(text!==undefined)yield text;continue;}
   if(parents.has(value))throw TypeError('Converting circular structure to JSON');parents.add(value);
   if(Array.isArray(value)){stack.push({kind:'array',value,index:0,length:value.length});yield '[';}else{stack.push({kind:'object',value,index:0,names:Object.keys(value),count:0});yield '{';}continue;
  }
  if(frame.kind==='array'){if(frame.index===frame.length){stack.pop();parents.delete(frame.value);yield ']';continue;}const index=frame.index++,child=prepared(frame.value[index],String(index));if(index)yield ',';if(absent(child))yield 'null';else stack.push({kind:'value',input:child,key:String(index),already:true});continue;}
  if(frame.index===frame.names.length){stack.pop();parents.delete(frame.value);yield '}';continue;}
  const name=frame.names[frame.index++],child=prepared(frame.value[name],name);if(absent(child))continue;if(frame.count++)yield ',';
  stack.push({kind:'value',input:child,key:name,already:true},{kind:'text',text:':'},{kind:'string',text:name});
 }
}
async function hashJsonAsync(value,options={}){const hash=hashWriter(),pace=scheduler(options);pace.check();for(const text of jsonTokens(value)){hash.write(text);{const pending=pace.step(text.length);if(pending)await pending;}}pace.check();return hash.digest();}
async function hashTextAsync(value,options={}){const hash=hashWriter(),pace=scheduler(options);pace.check();for(let at=0;at<value.length;at+=65536){const text=value.slice(at,at+65536);hash.write(text);{const pending=pace.step(text.length);if(pending)await pending;}}pace.check();return hash.digest();}
async function equalsJsonAsync(value,expected,options={}){const pace=scheduler(options);pace.check();let offset=0;for(const text of jsonTokens(value)){if(expected.slice(offset,offset+text.length)!==text)return false;offset+=text.length;const pending=pace.step(text.length);if(pending)await pending;}pace.check();return offset===expected.length;}
module.exports={scheduler,hashJsonAsync,hashTextAsync,equalsJsonAsync};
