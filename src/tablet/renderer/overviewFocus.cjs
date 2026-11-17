function restoreOverviewFocus(doc){
 const button=doc?.querySelector('[data-page-overview-toggle]'),view=doc?.defaultView;if(!button||!view||view.closed)return;
 view.requestAnimationFrame(()=>{if(view.closed||!button.isConnected||button.closest('[hidden],[inert]')||!button.getClientRects().length)return;const active=doc.activeElement;if(active&&active!==doc.body&&active!==doc.documentElement&&active!==button&&active.isConnected)return;button.focus({preventScroll:true});});
}
module.exports={restoreOverviewFocus};
