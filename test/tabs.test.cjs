const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('open tabs keep independent dirty buffers and guard closing', async () => {
  class Element {
    constructor() { this.children = []; this.style = {}; this.hidden = false; this.value = ''; this.contentEditable = 'true'; this.classList = { toggle() {} }; }
    setAttribute() {} addEventListener() {} append(...nodes) { this.children.push(...nodes); } replaceChildren() { this.children = []; }
    querySelectorAll() { return []; } focus() {} setRangeText(text) { this.value += text; }
    set innerHTML(value) { this.html = value; this.childNodes = []; } get innerHTML() { return this.html || ''; }
  }
  const ids = ['rich','source','title','documentTabs','toolbar','visual','markdown','modeLabel','status','new','open','save','saveAs','heading','insertImage','run','output','outputText','closeOutput','stopPython','paneToggle','pane'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()])); const handlers = {};
  const context = {NoteMindImagePreviews:require('../src/image-previews.js').create(),crypto:require('node:crypto'),NoteMindDocument:require('../src/document-renderer.cjs'), document: { getElementById: id => elements[id], createElement: () => new Element(), querySelectorAll: () => [], addEventListener() {} }, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, confirm: () => false, alert() {}, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, window: { notemind: { onPythonOutput:()=>{}, dirty() {}, async openPath(path) { return { path, text: path, assets: {} }; } }, addEventListener(type, fn) { handlers[type] = fn; }, dispatchEvent() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8'), context);
  elements.markdown.onclick(); elements.source.value = 'first draft'; elements.source.oninput();
  handlers['notemind-open-path']({ detail: 'C:\\example\\other.md' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.source.value, 'C:\\example\\other.md');
  elements.documentTabs.children[0].children[0].onclick(); assert.equal(elements.source.value, 'first draft');
  elements.documentTabs.children[0].children[1].onclick(); assert.equal(elements.documentTabs.children.length, 2);
  elements.documentTabs.children[1].children[0].onclick(); assert.equal(elements.source.value, 'C:\\example\\other.md');
});

