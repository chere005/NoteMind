const rich=document.getElementById('rich'),source=document.getElementById('source'),$=id=>document.getElementById(id);
let visual=true,activeTab={id:'native-A'};
window.notemind={};window.footerWorkerStats={created:0,terminated:0,active:0};
const NativeFooterWorker=window.Worker,phase=(name,details={})=>console.info('NOTEMIND_FOOTER_PHASE '+JSON.stringify({name,at:performance.now(),...details}));
window.Worker=class extends NativeFooterWorker{
 constructor(...args){super(...args);this.ended=false;footerWorkerStats.created++;footerWorkerStats.active++;phase('worker-create',{workers:{...footerWorkerStats}});this.addEventListener('message',event=>phase('worker-reply',{count:event.data?.count,error:event.data?.error}));}
 postMessage(value,...rest){phase('worker-post',{chars:value?.text?.length,id:value?.id});return super.postMessage(value,...rest);}
 terminate(){if(!this.ended){this.ended=true;footerWorkerStats.terminated++;footerWorkerStats.active--;phase('worker-terminate',{workers:{...footerWorkerStats}});}super.terminate();}
};
window.footerFixture={
 visual(html,id='native-A'){visual=true;activeTab={id};rich.hidden=false;source.hidden=true;rich.innerHTML=html;window.NoteMindFooter.update();},
 markdown(text,id='native-A'){visual=false;activeTab={id};rich.hidden=true;source.hidden=false;phase('before-source-value',{chars:text.length});source.value=text;phase('source-value-installed',{chars:source.value.length});window.NoteMindFooter.update();},
 count:()=>$('wordCount').textContent,
 async wait(expected,timeout=10000){const start=performance.now();while(this.count()!==expected){if(performance.now()-start>timeout)throw Error('Footer did not publish '+expected+'; got '+this.count());await new Promise(resolve=>setTimeout(resolve,10));}return{count:this.count(),wallMs:performance.now()-start,workers:{...footerWorkerStats}};}
};
