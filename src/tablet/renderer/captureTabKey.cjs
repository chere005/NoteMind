// Roving capture tabs stay in their initiating document and preserve nested controls.
function captureTabKey(event,activate){
 const tab=event.currentTarget;
 if(!tab||event.target!==tab||event.defaultPrevented||event.isComposing||event.nativeEvent?.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey)return false;
 const key=event.key;
 if(key==='Enter'||key===' '){event.preventDefault();event.stopPropagation?.();activate();return true;}
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return false;
 const list=tab.closest('[role="tablist"]');if(!list)return false;
 const tabs=[...list.querySelectorAll('[role="tab"]')].filter(node=>node.closest('[role="tablist"]')===list&&!node.closest('[hidden],[inert]')&&node.getAttribute('aria-disabled')!=='true'&&node.getClientRects().length),index=tabs.indexOf(tab);if(index<0)return false;
 const next=tabs[key==='Home'?0:key==='End'?tabs.length-1:(index+(key==='ArrowLeft'?tabs.length-1:1))%tabs.length];event.preventDefault();event.stopPropagation?.();if(next!==tab){next.focus({preventScroll:true});next.scrollIntoView?.({block:'nearest',inline:'nearest'});next.click();}return true;
}
module.exports={captureTabKey};
