// Preserve spacing between words without inserting spaces inside split glyph runs.
export function textOfBlocks(blocks){
 let text='',previous=null;
 for(const block of blocks){
  if(!block.text)continue;
  if(previous){
   const height=Math.max(previous.height,block.height);
   const nextLine=Math.abs(block.y-previous.y)>height*.5||block.x<previous.x-height;
   const gap=block.x-(previous.x+previous.width);
   if(nextLine)text+='\n';
   else if(gap>height*.12&&!/\s$/.test(text)&&!/^\s/.test(block.text))text+=' ';
  }
  text+=block.text;previous=block;
 }
 return text.trim();
}

export function findTextBlocks(blocks,query){
 const phrase=query.trim().toLowerCase();if(!phrase)return [];
 let text='',previous=null;const ranges=[];
 for(const b of blocks){
  if(previous){const h=Math.max(previous.height,b.height);if(Math.abs(b.y-previous.y)>h*.5||b.x<previous.x-h||b.x-previous.x-previous.width>h*.12)text+=' ';}
  const start=text.length;text+=b.text;ranges.push({start,end:text.length,block:b});previous=b;
 }
 const found=[];text=text.toLowerCase();let from=0;
 while(from<text.length){const at=text.indexOf(phrase,from);if(at<0)break;const parts=ranges.filter(r=>r.end>at&&r.start<at+phrase.length).map(r=>r.block);if(parts.length){const x=Math.min(...parts.map(b=>b.x)),y=Math.min(...parts.map(b=>b.y));found.push({x,y,width:Math.max(...parts.map(b=>b.x+b.width))-x,height:Math.max(...parts.map(b=>b.y+b.height))-y})}from=at+phrase.length;}
 return found;
}
