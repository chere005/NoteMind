// Caret positions between adjacent pictures in the rich view.
//
// Every inserted or imported picture is its own top-level paragraph, so pictures in a row leave no text position
// between them. A press on the boundary, or ArrowUp/ArrowDown towards it, opens an empty paragraph there. The
// paragraph is removed again when the caret leaves it unused. Its line break carries data-editor-control, which
// the Markdown serializer drops, so an unused paragraph never reaches the saved text.
(function (root) {
  const REACH = 10;
  const FILLER = 'image-gap';
  const PICTURE = 'img[data-asset]';
  const CONTROLS = 'button,a,input,select,textarea,[data-editor-control]';

  const isImage = block => !!block && block.image === true;

  // blocks: top-level blocks in document order, each {top, bottom, image}. Returns where an empty paragraph
  // belongs for a press at y, as {index, kind} with the paragraph going before blocks[index], or null.
  // atStart/atEnd say whether the list reaches the first/last block of the document.
  function findGap(blocks, y, options = {}) {
    const reach = options.reach === undefined ? REACH : options.reach;
    let best = null;
    for (let index = 0; index <= blocks.length; index += 1) {
      const above = blocks[index - 1];
      const below = blocks[index];
      if ((!above && !below) || (above && !isImage(above)) || (below && !isImage(below))) continue;
      if ((!above && options.atStart === false) || (!below && options.atEnd === false)) continue;
      const upper = above ? above.bottom : below.top;
      const lower = below ? below.top : above.bottom;
      const from = Math.min(upper, lower);
      const to = Math.max(upper, lower);
      if (y < from - reach || y > to + reach) continue;
      const distance = Math.max(from - y, y - to, 0);
      if (best && best.distance <= distance) continue;
      best = { index, kind: !above ? 'leading' : !below ? 'trailing' : 'between', distance };
    }
    return best && { index: best.index, kind: best.kind };
  }

  // The caret is in blocks[at] and moves one line up (direction < 0) or down. Returns the index an empty
  // paragraph goes before when the next stop is a boundary with pictures on both sides (or a picture and the
  // document edge), otherwise -1.
  function findArrowGap(blocks, at, direction, options = {}) {
    const step = direction < 0 ? -1 : 1;
    let near = at;
    if (!isImage(blocks[at])) {
      near = at + step;
      if (!isImage(blocks[near])) return -1;
    }
    const far = near + step;
    if (far < 0) return options.atStart === false ? -1 : 0;
    if (far >= blocks.length) return options.atEnd === false ? -1 : blocks.length;
    if (!isImage(blocks[far])) return -1;
    return step < 0 ? near : far;
  }

  // Whether a caret rectangle sits on the first (direction < 0) or last line of its block.
  function caretOnEdgeLine(block, caret, direction) {
    if (!block || !caret) return false;
    const height = caret.bottom - caret.top;
    if (!(height > 0)) return false;
    const distance = direction < 0 ? caret.top - block.top : block.bottom - caret.bottom;
    return distance < height * 0.75;
  }

  function hasOwnText(node) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 && /\S/.test(child.data)) return true;
      if (child.nodeType === 1 && !child.hasAttribute('data-editor-control') && hasOwnText(child)) return true;
    }
    return false;
  }

  // A top-level block that shows pictures and nothing else: a paragraph around an image or a drawing pane.
  function isImageBlock(node) {
    if (!node || node.nodeType !== 1 || !/^(P|DIV|SPAN|IMG)$/.test(node.tagName)) return false;
    if (!node.matches(PICTURE) && !node.querySelector(PICTURE)) return false;
    return !node.querySelector('.attachment-card') && !hasOwnText(node);
  }

  function isBlank(node) {
    return !!node && node.nodeType === 1 && !/\S/.test(node.textContent) && !node.querySelector('img,table,hr,input');
  }

  function createGapParagraph(owner) {
    const paragraph = owner.createElement('p');
    const filler = owner.createElement('br');
    filler.setAttribute('data-editor-control', FILLER);
    paragraph.appendChild(filler);
    return paragraph;
  }

  // True while the paragraph still holds nothing but its line break.
  function isUnusedGap(paragraph) {
    let breaks = 0;
    for (let child = paragraph.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 && child.data === '') continue;
      if (child.nodeType !== 1 || child.tagName !== 'BR') return false;
      breaks += 1;
    }
    return breaks <= 1;
  }

  function install(editor) {
    const wrap = editor.parentElement;
    let gap = null;
    let caretHome = null;
    let pointerDown = false;
    let swallowClick = false;

    const editable = () => !editor.hidden && editor.isContentEditable;
    const isBlockNode = node => node.nodeType === 1 || (node.nodeType === 3 && /\S/.test(node.data));

    function topLevel(node) {
      while (node && node.parentNode !== editor) node = node.parentNode;
      return node || null;
    }

		function markPicture(node) {
			const block = topLevel(node);
			if (block?.tagName === 'P') block.classList.toggle('image-paragraph', isImageBlock(block));
		}
		for (const node of editor.children) markPicture(node);
		new MutationObserver(records => {
			for (const record of records) {
				markPicture(record.target);
				if (record.target === editor) for (const node of record.addedNodes) markPicture(node);
			}
		}).observe(editor, {childList:true, subtree:true, characterData:true});

    function neighbour(node, step) {
      let next = step < 0 ? node.previousSibling : node.nextSibling;
      while (next && !isBlockNode(next)) next = step < 0 ? next.previousSibling : next.nextSibling;
      return next;
    }

    function measure(node) {
      let rect;
      if (node.nodeType === 1) {
        rect = node.getBoundingClientRect();
      } else {
        const range = document.createRange();
        range.selectNode(node);
        rect = range.getBoundingClientRect();
      }
      return { top: rect.top, bottom: rect.bottom, image: rect.bottom > rect.top && isImageBlock(node) };
    }

    // The blocks from `spread` before `first` to `spread` after `last`. The empty paragraph the editor keeps
    // after a final picture is reported as `tail` instead of a block, unless it is `keep`.
    function span(first, last, spread, keep) {
      let start = first;
      let end = last;
      for (let count = 0; count < spread; count += 1) {
        start = neighbour(start, -1) || start;
        end = neighbour(end, 1) || end;
      }
      const nodes = [];
      for (let node = start; node && nodes.length < 12; node = neighbour(node, 1)) {
        nodes.push(node);
        if (node === end) break;
      }
      const final = nodes[nodes.length - 1];
      const spare = final !== keep && final.nodeType === 1 && final.hasAttribute('data-editor-tail');
      const tail = spare && isBlank(final) && !neighbour(final, 1) ? nodes.pop() : null;
      const atStart = !nodes.length || !neighbour(nodes[0], -1);
      const atEnd = !!tail || !nodes.length || !neighbour(nodes[nodes.length - 1], 1);
      return { nodes, tail, atStart, atEnd };
    }

    // Where a press at (x, y) belongs: {before} for a new paragraph, {reuse} for the tail or the paragraph
    // that is already open there, or null when the press is not on a boundary.
    function placeAtPoint(target, x, y) {
      if (!editable() || !target || !target.closest) return null;
      if (target !== wrap && !editor.contains(target)) return null;
      if (target.closest(CONTROLS)) return null;
      const bounds = editor.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right) return null;
      const under = topLevel(target);
      if (under) {
        const block = measure(under);
        if (!block.image || (y > block.top + REACH && y < block.bottom - REACH)) return null;
      }
      let first = null;
      let last = null;
      for (const offset of [-REACH, 0, REACH]) {
        const node = topLevel(document.elementFromPoint(x, y + offset));
        if (!node) continue;
        if (!first || first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) first = node;
        if (!last || last.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) last = node;
      }
      if (!first) return null;
      const waiting = !!gap && gap.isConnected && isUnusedGap(gap);
      const { nodes, tail, atStart, atEnd } = span(first, last, waiting ? 2 : 1, null);
      // The paragraph that is already open does not separate its pictures: their edges lead back into it.
      const opened = waiting ? nodes.indexOf(gap) : -1;
      if (opened >= 0) nodes.splice(opened, 1);
      const found = findGap(nodes.map(measure), y, { reach: REACH, atStart, atEnd });
      if (!found) return null;
      if (found.index === opened) return { reuse: gap };
      return found.index === nodes.length && tail ? { reuse: tail } : { before: nodes[found.index] || null };
    }

    function caretInside(node) {
      const selection = getSelection();
      if (!selection || !selection.rangeCount) return false;
      return node.contains(selection.anchorNode) || node.contains(selection.focusNode);
    }

    function dropUnusedGap() {
      const paragraph = gap;
      gap = null;
      if (paragraph && paragraph.isConnected && isUnusedGap(paragraph)) paragraph.remove();
    }

    // Removes the paragraph once the caret has left it empty; a paragraph with content belongs to the note.
    function settleGap() {
      if (!gap) return;
      if (!gap.isConnected || !isUnusedGap(gap)) {
        gap = null;
        return;
      }
      if (pointerDown || caretInside(gap)) return;
      dropUnusedGap();
    }

    function open(place, reveal) {
      if (place.reuse !== gap) dropUnusedGap();
      caretHome = place.reuse;
      if (!caretHome) {
        gap = createGapParagraph(document);
        editor.insertBefore(gap, place.before);
        caretHome = gap;
      }
      editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(caretHome, 0);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (reveal) caretHome.scrollIntoView({ block: 'nearest' });
    }

    function showZone(active) {
      const cursor = active ? 'text' : '';
      if (wrap.style.cursor !== cursor) wrap.style.cursor = cursor;
    }

    wrap.addEventListener('mousemove', event => {
      if (event.buttons) return;
      showZone(!!placeAtPoint(event.target, event.clientX, event.clientY));
    });
    wrap.addEventListener('mouseleave', () => showZone(false));

    wrap.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const place = placeAtPoint(event.target, event.clientX, event.clientY);
      if (!place) return;
      event.preventDefault();
      swallowClick = true;
      open(place, false);
    }, true);

    // The click that ends such a press would otherwise select the picture under it; the paragraph gets it.
    wrap.addEventListener('click', event => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
      if (caretHome && caretHome.isConnected) {
        caretHome.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    }, true);

    document.addEventListener('pointerdown', () => {
      pointerDown = true;
      swallowClick = false;
    }, true);
    // Removal waits for the end of a press, so the page does not shift under the pointer in the middle of a click.
    const release = () => {
      pointerDown = false;
      settleGap();
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', event => {
      if (event.target === window) release();
    });
    document.addEventListener('selectionchange', settleGap);

    // Typing or Return in the paragraph makes it the note's own.
    document.addEventListener('input', event => {
      if (!gap || !editor.contains(event.target)) return;
      if (!gap.isConnected || !isUnusedGap(gap) || /^insert/.test(event.inputType || '')) gap = null;
    }, true);

    // Deleting in the unused paragraph would only merge it into a picture's paragraph and mark the note changed.
    document.addEventListener('beforeinput', event => {
      if (!gap || !gap.isConnected || !/^delete/.test(event.inputType || '')) return;
      const selection = getSelection();
      if (selection.isCollapsed && caretInside(gap) && isUnusedGap(gap)) event.preventDefault();
    }, true);

    function caretRect(selection) {
      const range = selection.getRangeAt(0);
      return range.getClientRects()[0] || range.getBoundingClientRect();
    }

    editor.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !editable()) return;
      const selection = getSelection();
      if (!selection.rangeCount || !selection.isCollapsed) return;
      const current = topLevel(selection.anchorNode);
      if (!current) return;
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const { nodes, tail, atStart, atEnd } = span(current, current, 2, current);
      const blocks = nodes.map(measure);
      const at = nodes.indexOf(current);
      if (at < 0) return;
      const single = blocks[at].image || isBlank(current);
      if (!single && !caretOnEdgeLine(blocks[at], caretRect(selection), direction)) return;
      const index = findArrowGap(blocks, at, direction, { atStart, atEnd });
      if (index < 0) return;
      event.preventDefault();
      open(index === nodes.length && tail ? { reuse: tail } : { before: nodes[index] || null }, true);
    });
  }

  const api = { REACH, findGap, findArrowGap, caretOnEdgeLine, isImageBlock, createGapParagraph, isUnusedGap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteMindImageGaps = api;
  if (typeof document !== 'undefined' && typeof rich !== 'undefined') install(rich);
})(typeof window === 'undefined' ? globalThis : window);
