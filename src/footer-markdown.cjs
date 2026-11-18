// The source footer reuses the installed semantic parser, consuming one block
// and packed inline packet at a time instead of retaining a rendered document.
const {APP_TEXT_BYTES}=require('./document-text-limit.cjs');
const {streamMarkdown}=require('./word-markdown.cjs'),{md}=require('./document-renderer.cjs'),{scan,countHTML}=require('./notes-footer.js');
function utf8Length(text){let bytes=0;for(let at=0;at<text.length;at++){const value=text.charCodeAt(at);if(value<128)bytes++;else if(value<2048)bytes+=2;else if(value>=0xd800&&value<=0xdbff&&text.charCodeAt(at+1)>=0xdc00&&text.charCodeAt(at+1)<=0xdfff){bytes+=4;at++;}else bytes+=3;}return bytes;}
function countMarkdown(text,{check=()=>{},onStats}={}){
 const state={count:0,inWord:false,carry:''};
 const consume=value=>{for(let at=0;at<value.length;at+=8192){check();scan(value.slice(at,at+8192),state);}};
 streamMarkdown(text,token=>{
  check();if(token.type==='inline'){
   for(const item of token.children||[]){
    check();if(['text','text_special','code_inline'].includes(item.type))consume(item.content);
    else if(['softbreak','hardbreak'].includes(item.type))consume('\n');
    else if(item.type==='task_check')consume(' ');
    else if(item.type==='image'||item.nesting!==0)continue;
    else countHTML(md.renderer.renderInline([item],md.options,{}),state);
   }
  }else{consume('\n');if(['fence','code_block'].includes(token.type))consume(token.content);consume('\n');}
 },{check,onStats,consumeInline:true,byteLength:utf8Length,maximumTextBytes:APP_TEXT_BYTES});
 check();return state.count;
}
module.exports={countMarkdown,utf8Length};
