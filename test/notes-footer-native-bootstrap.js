const rich=document.getElementById('rich'),source=document.getElementById('source'),$=id=>document.getElementById(id);
let visual=true,activeTab={id:'native-A'};
window.notemind={};window.footerWorkerStats={created:0,terminated:0,active:0};
const NativeFooterWorker=window.Worker;
window.Worker=class extends NativeFooterWorker{
 constructor(...args){super(...args);this.ended=false;footerWorkerStats.created++;footerWorkerStats.active++;}
 terminate(){if(!this.ended){this.ended=true;footerWorkerStats.terminated++;footerWorkerStats.active--;}super.terminate();}
};
window.footerFixture={
 visual(html,id='native-A'){visual=true;activeTab={id};rich.innerHTML=html;window.NoteMindFooter.update();},
 markdown(text,id='native-A'){visual=false;activeTab={id};source.value=text;window.NoteMindFooter.update();},
 count:()=>$('wordCount').textContent,
 async wait(expected,timeout=10000){const start=performance.now();while(this.count()!==expected){if(performance.now()-start>timeout)throw Error('Footer did not publish '+expected+'; got '+this.count());await new Promise(resolve=>setTimeout(resolve,10));}return{count:this.count(),wallMs:performance.now()-start,workers:{...footerWorkerStats}};}
};
