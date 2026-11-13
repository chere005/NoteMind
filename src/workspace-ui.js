(() => {
 new ResizeObserver(()=>revealActiveTab()).observe(document.getElementById('documentTabs'));
 const toolbar=document.getElementById('toolbar');
 for(const button of toolbar.querySelectorAll('button'))if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.title||button.textContent.trim());
 toolbar.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||event.target.closest('input,select,textarea'))return;
  const buttons=[...toolbar.querySelectorAll('button:not(:disabled)')].filter(button=>button.getClientRects().length),at=buttons.indexOf(event.target.closest('button'));
  if(at<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[next]?.focus();
 });
})();
