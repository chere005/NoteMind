const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWindow } = require('@mixmark-io/domino');
const renderer = require('../src/document-renderer.cjs');
const gaps = require('../src/notes-image-gaps.js');

const image = (top, bottom) => ({ top, bottom, image: true });
const text = (top, bottom) => ({ top, bottom, image: false });

test('a press within 10 px of the boundary between two adjacent pictures chooses the gap between them', () => {
  const blocks = [text(0, 26), image(40, 400), image(412, 800), text(812, 838)];
  for (const y of [390, 400, 406, 412, 422]) {
    assert.deepEqual(gaps.findGap(blocks, y), { index: 2, kind: 'between' }, 'y=' + y);
  }
  for (const y of [389, 423, 200, 600]) assert.equal(gaps.findGap(blocks, y), null, 'y=' + y);
  assert.equal(gaps.REACH, 10);
});

test('pictures that touch with no space between still offer the gap', () => {
  const blocks = [image(0, 300), image(300, 600), image(600, 900)];
  assert.deepEqual(gaps.findGap(blocks, 300, { atStart: false, atEnd: false }), { index: 1, kind: 'between' });
  assert.deepEqual(gaps.findGap(blocks, 608, { atStart: false, atEnd: false }), { index: 2, kind: 'between' });
  assert.equal(gaps.findGap(blocks, 450, { atStart: false, atEnd: false }), null);
});

test('no gap is offered where text, or any other block, already separates the pictures', () => {
  const blocks = [image(0, 300), text(312, 338), image(350, 650)];
  for (const y of [295, 300, 306, 312, 325, 338, 344, 350, 355]) {
    assert.equal(gaps.findGap(blocks, y, { atStart: false, atEnd: false }), null, 'y=' + y);
  }
  const hidden = [image(0, 300), { top: 0, bottom: 0, image: false }, image(312, 600)];
  assert.equal(gaps.findGap(hidden, 306, { atStart: false, atEnd: false }), null);
});

test('a leading picture offers a gap at its top edge only when nothing precedes it', () => {
  const blocks = [image(12, 400), text(412, 438)];
  for (const y of [2, 12, 22]) assert.deepEqual(gaps.findGap(blocks, y), { index: 0, kind: 'leading' }, 'y=' + y);
  assert.equal(gaps.findGap(blocks, 23), null);
  assert.equal(gaps.findGap(blocks, 1), null);
  assert.equal(gaps.findGap(blocks, 12, { atStart: false }), null);
  assert.equal(gaps.findGap([text(0, 26), image(38, 400)], 38), null);
});

test('a trailing picture offers a gap at its bottom edge only when nothing follows it', () => {
  const blocks = [text(0, 26), image(38, 400)];
  for (const y of [390, 400, 410]) assert.deepEqual(gaps.findGap(blocks, y), { index: 2, kind: 'trailing' }, 'y=' + y);
  assert.equal(gaps.findGap(blocks, 389), null);
  assert.equal(gaps.findGap(blocks, 411), null);
  assert.equal(gaps.findGap(blocks, 400, { atEnd: false }), null);
  assert.equal(gaps.findGap([image(38, 400), text(412, 438)], 400, { atStart: false }), null);
});

test('a lone picture offers both edges and an empty document offers nothing', () => {
  assert.deepEqual(gaps.findGap([image(0, 300)], 4), { index: 0, kind: 'leading' });
  assert.deepEqual(gaps.findGap([image(0, 300)], 296), { index: 1, kind: 'trailing' });
  assert.equal(gaps.findGap([image(0, 300)], 150), null);
  assert.equal(gaps.findGap([], 0), null);
});

test('overlapping zones around a short picture resolve to the nearer boundary', () => {
  const blocks = [image(0, 300), image(312, 324), image(336, 600)];
  const inner = { atStart: false, atEnd: false };
  assert.deepEqual(gaps.findGap(blocks, 316, inner), { index: 1, kind: 'between' });
  assert.deepEqual(gaps.findGap(blocks, 321, inner), { index: 2, kind: 'between' });
  assert.deepEqual(gaps.findGap(blocks, 306, { ...inner, reach: 2 }), { index: 1, kind: 'between' });
  assert.equal(gaps.findGap(blocks, 296, { ...inner, reach: 2 }), null);
});

test('ArrowUp and ArrowDown stop at a boundary that has pictures on both sides', () => {
  const kinds = flags => flags.map(value => ({ image: value }));
  const row = kinds([false, true, true, true, false]);
  assert.equal(gaps.findArrowGap(row, 0, 1), 2, 'down from text passes the first picture');
  assert.equal(gaps.findArrowGap(row, 4, -1), 3, 'up from text passes the last picture');
  assert.equal(gaps.findArrowGap(row, 1, 1), 2, 'down from beside a picture');
  assert.equal(gaps.findArrowGap(row, 2, -1), 2, 'up from beside a picture');
  assert.equal(gaps.findArrowGap(row, 3, 1), -1, 'text follows: left to the browser');
  assert.equal(gaps.findArrowGap(row, 1, -1), -1, 'text precedes: left to the browser');
  const opened = kinds([true, false, true, true]);
  assert.equal(gaps.findArrowGap(opened, 1, 1), 3, 'down from an opened gap reaches the next one');
  assert.equal(gaps.findArrowGap(opened, 1, -1), 0, 'up from the gap under a leading picture');
  assert.equal(gaps.findArrowGap(opened, 1, -1, { atStart: false }), -1);
  assert.equal(gaps.findArrowGap(kinds([false, true]), 0, 1), 2, 'down past a trailing picture');
  assert.equal(gaps.findArrowGap(kinds([false, true]), 0, 1, { atEnd: false }), -1);
  assert.equal(gaps.findArrowGap(kinds([false, false, true, true]), 0, 1), -1, 'the next block is text');
  assert.equal(gaps.findArrowGap(kinds([false]), 0, 1), -1);
});

test('the caret counts as on an edge line only on the first or last line of its block', () => {
  const block = { top: 100, bottom: 179.2 };
  const firstLine = { top: 104, bottom: 122.4 };
  const middleLine = { top: 130.4, bottom: 148.8 };
  const lastLine = { top: 156.8, bottom: 175.2 };
  assert.equal(gaps.caretOnEdgeLine(block, firstLine, -1), true);
  assert.equal(gaps.caretOnEdgeLine(block, firstLine, 1), false);
  assert.equal(gaps.caretOnEdgeLine(block, lastLine, 1), true);
  assert.equal(gaps.caretOnEdgeLine(block, lastLine, -1), false);
  assert.equal(gaps.caretOnEdgeLine(block, middleLine, -1), false);
  assert.equal(gaps.caretOnEdgeLine(block, middleLine, 1), false);
  assert.equal(gaps.caretOnEdgeLine(block, { top: 126.4, bottom: 152.8 }, 1), false, 'a full line box above the last');
  assert.equal(gaps.caretOnEdgeLine(block, { top: 0, bottom: 0 }, 1), false, 'an unknown caret is never on an edge');
  assert.equal(gaps.caretOnEdgeLine(block, null, 1), false);
});

const assets = { 'assets/a.png': 'AAAA', 'assets/b.png': 'BBBB', 'assets/c.pdf': 'CCCC' };
const meta = { graphicsPanes: { 'assets/b.png': { version: 1 } } };
const pictures = '![Image](assets/a.png)\n\n![Image](assets/b.png)';
function editor(markdown) {
  const html = renderer.render(markdown, assets, meta, name => 'blob:fixture/' + name);
  const document = createWindow('<article id="rich">' + html + '</article>').document;
  const rich = document.getElementById('rich');
  return { document, rich, blocks: () => Array.from(rich.children) };
}

test('consecutive pictures render as one paragraph each and only picture-only paragraphs count as pictures', () => {
  const others = ['text ![Image](assets/a.png)', '# Heading', '[Scan](assets/c.pdf)', '![Gone](x.png)'];
  const view = editor([pictures, ...others].join('\n\n'));
  const [plain, pane, , , attachment, missing] = view.blocks();
  assert.deepEqual(view.blocks().map(node => node.tagName), ['P', 'P', 'P', 'H1', 'P', 'P']);
  assert.equal(plain.firstChild.tagName, 'IMG');
  assert.equal(pane.firstChild.getAttribute('contenteditable'), 'false');
  assert.ok(pane.querySelector('.graphics-pane > [data-edit-graphics][data-editor-control]'));
  assert.deepEqual(view.blocks().map(gaps.isImageBlock), [true, true, false, false, false, false]);
  assert.ok(attachment.querySelector('.attachment-card'));
  assert.ok(missing.querySelector('.missing-image'));
  const tail = view.document.createElement('p');
  tail.setAttribute('data-editor-tail', '');
  tail.appendChild(view.document.createElement('br'));
  assert.equal(gaps.isImageBlock(tail), false);
  assert.equal(gaps.isImageBlock(null), false);
});

test('an unused gap paragraph never reaches the saved Markdown, wherever it is opened', () => {
  for (const at of [0, 1, 2]) {
    const view = editor(pictures);
    const paragraph = gaps.createGapParagraph(view.document);
    view.rich.insertBefore(paragraph, view.blocks()[at] || null);
    assert.equal(gaps.isUnusedGap(paragraph), true);
    assert.equal(view.rich.children.length, 3);
    assert.equal(renderer.toMarkdown(view.rich.innerHTML), pictures, 'position ' + at);
    paragraph.parentNode.removeChild(paragraph);
    assert.equal(renderer.toMarkdown(view.rich.innerHTML), pictures);
  }
});

test('text typed into the gap saves as a paragraph between the picture lines and survives a reload', () => {
  for (const keepsBreak of [false, true]) {
    const view = editor(pictures);
    const paragraph = gaps.createGapParagraph(view.document);
    view.rich.insertBefore(paragraph, view.blocks()[1]);
    if (!keepsBreak) paragraph.removeChild(paragraph.firstChild);
    paragraph.insertBefore(view.document.createTextNode('Between the pages'), paragraph.firstChild);
    assert.equal(gaps.isUnusedGap(paragraph), false);
    const saved = renderer.toMarkdown(view.rich.innerHTML);
    assert.equal(saved, '![Image](assets/a.png)\n\nBetween the pages\n\n![Image](assets/b.png)');
    const reopened = editor(saved);
    assert.deepEqual(reopened.blocks().map(gaps.isImageBlock), [true, false, true]);
    assert.equal(reopened.blocks()[1].outerHTML, '<p>Between the pages</p>');
    assert.equal(renderer.toMarkdown(reopened.rich.innerHTML), saved);
  }
});

test('a gap paragraph stops being unused as soon as it holds anything but its line break', () => {
  const document = createWindow('').document;
  const paragraph = gaps.createGapParagraph(document);
  assert.equal(paragraph.outerHTML, '<p><br data-editor-control="image-gap"></p>');
  paragraph.appendChild(document.createTextNode(''));
  assert.equal(gaps.isUnusedGap(paragraph), true);
  paragraph.appendChild(document.createElement('br'));
  assert.equal(gaps.isUnusedGap(paragraph), false);
  const typed = gaps.createGapParagraph(document);
  typed.appendChild(document.createTextNode(' '));
  assert.equal(gaps.isUnusedGap(typed), false);
  const emptied = document.createElement('p');
  assert.equal(gaps.isUnusedGap(emptied), true);
});

test('the rich view loads the gap logic after the picture selection and the build checks it', () => {
  const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
  const at = html.indexOf('<script src="notes-image-gaps.js"></script>');
  assert.ok(at > html.indexOf('<script src="notes-picture.js"></script>'));
  assert.ok(html.indexOf('<script src="renderer.js"></script>') < at);
  assert.match(fs.readFileSync(require.resolve('../scripts/build.cjs'), 'utf8'), /'notes-image-gaps\.js'/);
});
