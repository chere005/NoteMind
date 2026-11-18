const {createIndexer}=require('../../src/index-images.cjs');
function featureOutputPrefix(source){
 const state=source.match(/outputWrites=new Set\(\);let outputClosed=[^\n]+/),write=source.match(/^ function outputWrite[^\n]+/m);
 if(!state||!write)throw Error('Feature output lifecycle source moved.');
 return 'const '+state[0]+'\n'+write[0]+'\n';
}
function sheetForegroundFixture(source){
 const wrapper=source.match(/^const withSheetForeground=[^\n]+/m);if(!wrapper)throw Error('Sheet foreground lifecycle source moved.');
 const indexer=createIndexer({store:{},documentIO:{},send:()=>{}});
 return{prefix:wrapper[0]+'\n',notesIPC:{activity:()=>indexer.activity(),foreground:run=>indexer.foreground(run)},dispose:()=>indexer.dispose()};
}
module.exports={featureOutputPrefix,sheetForegroundFixture};
