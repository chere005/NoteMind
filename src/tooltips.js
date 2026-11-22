(() => {
  const installed = new WeakMap();
  function install(doc = document) {
    if (installed.has(doc)) return installed.get(doc);
    const view = doc.defaultView;
    if (!view) return () => {};
    let timer = null, target = null, tooltip = null, point = null, observer = null;
    const hint = (node, pointer) => (node?.nodeType === 3 ? node.parentElement : node)
      ?.closest?.(pointer === 'pen' ? '[data-tooltip], [title]' : '[data-tooltip]') || null;
    const message = node => (node?.getAttribute('data-tooltip') || node?.getAttribute('title'))?.trim();
    const hide = () => {
      if (timer !== null) view.clearTimeout(timer);
      timer = null; target = null; point = null;
      observer?.disconnect(); observer = null;
      tooltip?.remove(); tooltip = null;
    };
    const place = () => {
      if (!tooltip || !point) return;
      const gap = 8, box = tooltip.getBoundingClientRect();
      const left = Math.max(gap, Math.min(point.x + 14, view.innerWidth - box.width - gap));
      const below = point.y + 18;
      const top = Math.max(gap, Math.min(below + box.height + gap <= view.innerHeight ? below : point.y - box.height - 14, view.innerHeight - box.height - gap));
      tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
    };
    const hover = event => {
      // Ordinary titles still use native mouse tooltips.
      if (!['mouse', 'pen'].includes(event.pointerType) || event.buttons) return;
      const next = hint(event.target, event.pointerType);
      if (!message(next)) { hide(); return; }
      point = { x: event.clientX, y: event.clientY };
      if (next === target) return;
      hide(); target = next; point = { x: event.clientX, y: event.clientY };
      timer = view.setTimeout(() => {
        timer = null;
        if (!target?.isConnected || !target.getClientRects().length) { hide(); return; }
        const text = message(target);
        if (!text) { hide(); return; }
        tooltip = doc.createElement('div'); tooltip.className = 'notemind-tooltip';
        tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = text;
        doc.body.append(tooltip); place();
        if (target.hasAttribute('data-tooltip') && view.MutationObserver) {
          observer = new view.MutationObserver(() => {
            const current = message(target);
            if (!current) { hide(); return; }
            tooltip.textContent = current; place();
          });
          observer.observe(target, { attributes: true, attributeFilter: ['data-tooltip'] });
        }
      }, 450);
    };
    const leave = event => { if (hint(event.relatedTarget, event.pointerType) !== target) hide(); };
    const listeners = [
      [doc, 'pointerover', hover, true], [doc, 'pointermove', hover, true],
      [doc, 'pointerout', leave, true], [doc, 'pointerdown', hide, true],
      [doc, 'keydown', hide, true], [doc, 'scroll', hide, true],
      [view, 'blur', hide, false], [view, 'resize', hide, false], [view, 'pagehide', hide, false],
    ];
    for (const [element, type, listener, capture] of listeners) element.addEventListener(type, listener, capture);
    const cleanup = () => {
      hide();
      for (const [element, type, listener, capture] of listeners) element.removeEventListener(type, listener, capture);
      installed.delete(doc);
    };
    installed.set(doc, cleanup);
    return cleanup;
  }
  window.NoteMindTooltips = { install };
  install(document);
})();
