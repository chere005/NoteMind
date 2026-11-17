(() => {
  const installed = new WeakMap();
  function install(doc = document) {
    if (installed.has(doc)) return installed.get(doc);
    const view = doc.defaultView;
    if (!view) return () => {};
    let timer = null, target = null, tooltip = null, point = null;
    const titled = node => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('[title]') || null;
    const hide = () => {
      if (timer !== null) view.clearTimeout(timer);
      timer = null; target = null; point = null;
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
      // Native mouse hover keeps the browser's own title tooltip.
      if (event.pointerType !== 'pen' || event.buttons) return;
      const next = titled(event.target);
      if (!next || !next.getAttribute('title')?.trim()) { hide(); return; }
      point = { x: event.clientX, y: event.clientY };
      if (next === target) return;
      hide(); target = next; point = { x: event.clientX, y: event.clientY };
      timer = view.setTimeout(() => {
        timer = null;
        if (!target?.isConnected || !target.getClientRects().length) { hide(); return; }
        const text = target.getAttribute('title')?.trim();
        if (!text) { hide(); return; }
        tooltip = doc.createElement('div'); tooltip.className = 'notemind-tooltip';
        tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = text;
        doc.body.append(tooltip); place();
      }, 450);
    };
    const leave = event => { if (event.pointerType === 'pen' && titled(event.relatedTarget) !== target) hide(); };
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
