(function(root,factory){const rewrite=factory();if(typeof module==='object'&&module.exports)module.exports=rewrite;else root.NoteMindReferenceRewrite=rewrite;})(typeof globalThis==='object'?globalThis:this,function(){
// Capture only destinations accepted by the same parser that renders the note. Textual
// replacements also change code examples and miss escaped or multiline link syntax.
function rewrite(md,text,mapping,remove=false){
 const targets=new Map(Object.entries(mapping).filter(([from,to])=>from!==to).map(([from,to])=>[md.normalizeLink(from),to]));if(!targets.size)return text;
 const offsets=[],normalized=text.replace(/\r\n?|\0/g,(value,index)=>{offsets.push([index,value.length]);return value==='\0'?'\ufffd':'\n';});
 const originalOffset=position=>{let extra=0;for(const [at,length]of offsets){if(at-extra>=position)break;extra+=length-1;}return position+extra;};
 const parser=Object.create(md),block=[],contexts=new Map();let active=null;
 parser.helpers={...md.helpers,parseLinkDestination(source,start,max){const parsed=md.helpers.parseLinkDestination(source,start,max),key=parsed.ok&&md.normalizeLink(parsed.str);if(parsed.ok&&targets.has(key)){const angle=source[start]==='<';(active?.ranges||block).push({source,start:start+(angle?1:0),end:parsed.pos-(angle?1:0),target:targets.get(key),destination:true});}return parsed;}};
 function rules(original,inline){const copy=Object.create(original),chains=new Map();copy.ruler={getRules:chain=>{if(!chains.has(chain))chains.set(chain,original.ruler.getRules(chain).map(rule=>(...args)=>{
  const state=args[0],ranges=active?.ranges||block,before=ranges.length,start=state.pos,tokenCount=state.tokens?.length,ok=rule(...args),silent=args[inline?1:3];
  if(!ok||silent)ranges.length=before;
  else if(remove&&inline){const token=state.tokens.slice(tokenCount).find(token=>token.type==='image'||token.type==='link_open');for(let i=ranges.length-1;i>=before;i--)if(ranges[i].destination)ranges.splice(i,1);if((state.src[start]==='['||state.src.slice(start,start+2)==='![')&&token&&targets.has(md.normalizeLink(token.attrGet(token.type==='image'?'src':'href'))))ranges.push({source:state.src,start,end:state.pos,target:''});}
  else if(remove&&ranges.slice(before).some(range=>range.destination)){ranges.splice(before,ranges.length-before,{source:state.src,start:state.bMarks[args[1]]+state.tShift[args[1]],end:state.line<state.lineMax?state.bMarks[state.line]:state.src.length,target:''});}
  else if(inline){const end=state.pos;for(let i=ranges.length-1;i>=before;i--)if(ranges[i].end>end)ranges.splice(i,1);}return ok;
 }));return chains.get(chain);}};return copy;}
 parser.block=rules(md.block,false);parser.inline=rules(md.inline,true);
 parser.inline.parse=function(source,instance,env,tokens){const previous=active,context={ranges:[]};active=context;try{md.inline.parse.call(this,source,instance,env,tokens);contexts.set(tokens,context.ranges);}finally{active=previous;}};
 const tokens=parser.parse(text,{}),changes=block.filter(range=>range.source===normalized),lines=normalized.split('\n'),starts=[];let total=0;for(const line of lines){starts.push(total);total+=line.length+1;}
 // Inline token content omits list/quote prefixes; table cells also unescape pipes.
 // Map each content line back to its original line before applying parser offsets.
 let bounds=[0,lines.length];const columns=new Map();
 for(const token of tokens){
  if(token.map)bounds=token.map;if(token.type!=='inline')continue;const ranges=contexts.get(token.children)||[];
  const anchors=[];let line=bounds[0],contentOffset=0;
  for(const content of token.content.split('\n')){
   let found=false;
   for(;line<bounds[1];line++){
    const raw=lines[line],column=columns.get(line)||0;let visible=raw,indices=Array.from({length:raw.length},(_,i)=>i),at=visible.indexOf(content,column),leading=0;
    if(at<0){visible='';indices=[];for(let i=0;i<raw.length;i++){if(raw[i]==='\\'&&raw[i+1]==='|')i++;visible+=raw[i];indices.push(i);}at=visible.indexOf(content,indices.findIndex(i=>i>=column));}
    // getLines can replace the consumed part of an indentation tab with spaces.
    // Link spans begin after indentation, so map the unchanged content beyond it.
    if(at<0&&raw.includes('\t')){const body=content.replace(/^[ \t]+/,'');if(body){leading=content.length-body.length;at=visible.indexOf(body,Math.max(0,indices.findIndex(i=>i>=column)));}}
    if(at<0)continue;const length=content.length-leading;anchors.push({start:contentOffset+leading,end:contentOffset+content.length,line,indices:indices.slice(at,at+length)});columns.set(line,(indices[at+length-1]??column-1)+1);found=true;line++;break;
   }
   if(!found)break;contentOffset+=content.length+1;
  }
  for(const range of ranges){const first=anchors.find(a=>range.start>=a.start&&range.start<a.end),last=anchors.find(a=>range.end>a.start&&range.end<=a.end);if(!first||!last)continue;const start=starts[first.line]+first.indices[range.start-first.start],end=starts[last.line]+last.indices[range.end-last.start-1]+1;if(Number.isFinite(start)&&Number.isFinite(end))changes.push({...range,start,end});}
 }
 const unique=new Map(changes.map(range=>[range.start+':'+range.end,range]));let spans=[...unique.values()];if(remove){const merged=[];for(const range of spans.sort((a,b)=>a.start-b.start)){const previous=merged.at(-1);if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);else merged.push({...range});}spans=merged;}for(const {start,end,target}of spans.sort((a,b)=>b.start-a.start))text=text.slice(0,originalOffset(start))+target+text.slice(originalOffset(end));return text;
}
rewrite.remove=(md,text,name)=>rewrite(md,text,{[name]:''},true);
return rewrite;
});
