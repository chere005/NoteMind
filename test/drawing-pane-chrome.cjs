const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, Menu } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-drawing-chrome-'));
process.env.NOTEMIND_DATA = profile;
delete process.env.NOTEMIND_HOME;
delete process.env.NOTEMIND_WORKSPACES;
delete process.env.NOTEMIND_PAD_OWNER;
app.setPath('documents', profile);
app.disableHardwareAcceleration();

const deadline = setTimeout(() => finish(new Error('Drawing pane timed out')), 20000);

function finish(error) {
  clearTimeout(deadline);
  fs.rmSync(profile, { recursive: true, force: true });
  if (error) console.error(error);
  else console.log('Drawing controls, menu actions and sheet tabs passed at wide and narrow widths.');
  app.exit(error ? 1 : 0);
}

app.once('browser-window-created', (_, window) => {
  const contents = window.webContents;
  contents.setBackgroundThrottling(false);
  window.setContentSize(1440, 900);
  const js = code => contents.executeJavaScript(code);
  const tick = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

  contents.once('did-finish-load', async () => {
    try {
      await js(`(async () => {
        const pane = document.getElementById('pane');
        if (pane.hidden) document.getElementById('paneToggle').click();
        while (!pane.querySelector('[data-tablet=surface]')) await new Promise(resolve => setTimeout(resolve, 25));
      })()`);
      const layout = () => js(`(() => {
        const pane = document.getElementById('pane');
        const row = pane.querySelector('.sheet-tabs');
        const options = row.querySelector('[data-bar=pane-menu]');
        const note = document.querySelector('[data-bar=notepad-menu]');
        const tabs = row.querySelectorAll('.sheet-scroll > .sheet-tab');
        const tab = tabs[tabs.length - 1];
        const add = row.querySelector('.sheet-add');
        const centerY = element => {
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        };
        return {
          overlay: !!pane.querySelector('.precision-controls'),
          oldOptions: !!pane.querySelector('#pen-control [data-bar=pane-menu]'),
          aligned: !!options && Math.abs(centerY(options) - centerY(note)) <= 1,
          addGap: add.getBoundingClientRect().left - tab.getBoundingClientRect().right,
          addBesideTabs: add.previousElementSibling === row.querySelector('.sheet-scroll'),
          addTabCount: tabs.length,
          activeTab: row.querySelector('.sheet-scroll > .sheet-tab.on').textContent.trim(),
          available: add.getBoundingClientRect().right < row.getBoundingClientRect().right,
        };
      })()`);

      let state = await layout();
      const nativeItem = (...labels) => labels.reduce((menu, label) => menu.submenu.items.find(item => item.label === label),
        { submenu: Menu.getApplicationMenu() });
      const nativeLabels = (...labels) => nativeItem(...labels).submenu.items.filter(item => item.type !== 'separator').map(item => item.label);
      assert.deepEqual(nativeLabels('Drawing'), ['Undo Drawing', 'Redo Drawing', 'Tools', 'Sheets', 'Insert', 'Tablet Settings…']);
      assert.deepEqual(nativeLabels('Drawing', 'Tools'), ['Erase Tool', 'Select Tool', 'Pen Always Draws', 'Next Colour', 'Previous Colour',
        'Wider Line', 'Thinner Line', 'Delete Selection', 'Clear Selection']);
      assert.deepEqual(nativeLabels('Drawing', 'Sheets'), ['Next Sheet', 'Previous Sheet', 'Clear Page']);
      assert.deepEqual(nativeLabels('Drawing', 'Insert'), ['Writing', 'Picture']);
      assert.deepEqual(nativeLabels('Capture'), ['Drawing', 'Camera', 'Turn Input Off', 'Refresh Cameras', 'Camera Aspect Ratio']);
      assert.equal(nativeItem('Capture', 'Refresh Cameras').accelerator, 'CmdOrCtrl+Alt+R');
      assert.deepEqual(nativeLabels('Capture', 'Camera Aspect Ratio'), ['Free', '4:3', '16:9', 'Square']);
      assert.deepEqual(nativeLabels('Notepad', 'Library'), ['All Notepads…', 'Smart Folders…', 'Recently Deleted…']);
      assert.ok(!nativeLabels('Notepad').includes('Formatting Options…'));
      assert.ok(!nativeLabels('Projects').includes('Project Menu…'));
      assert.ok(await js(`!!document.querySelector('#projectMenu') && !!document.querySelector('#writingTools')`));
      assert.ok(nativeLabels('File').includes('Close Window') && !nativeLabels('Window').includes('Close Window'));
      assert.ok(nativeLabels('Window').includes('Zoom Window'));
      assert.ok(nativeLabels('Help').includes('Welcome Screen') && !nativeLabels('File').includes('Welcome'));

      // Follow clicks through the live menu, IPC and preload without opening unrelated panes.
      await js(`{
        window.checkedNativeCommands = [];
        const record = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.checkedNativeCommands.push(event.detail);
          if (window.checkedNativeCommands.length === 5) window.removeEventListener('notemind-command', record, true);
        };
        window.addEventListener('notemind-command', record, true);
      }`);
      for (const route of [['Drawing', 'Tools', 'Erase Tool'], ['Drawing', 'Insert', 'Picture'], ['Drawing', 'Tablet Settings…'],
        ['Capture', 'Camera Aspect Ratio', '4:3'], ['Notepad', 'Library', 'Smart Folders…']]) {
        const item = nativeItem(...route);
        item.click(item, window, {});
      }
      await tick();
      assert.deepEqual(await js('window.checkedNativeCommands'), ['pen:toggleErase', 'pen:sendPage', 'penSettings', 'cameraAspect:1.3333333333333333', 'smartFolders']);

      assert.equal(state.overlay, false, 'The drawing sheet has no floating precision controls');
      assert.equal(state.oldOptions, false, 'The pen toolbar has no drawing options button');
      assert.ok(state.aligned, 'The drawing and Notepad menus align in the top row');
      assert.ok(state.addBesideTabs && state.addGap >= 0 && state.addGap <= 6, JSON.stringify(state));

      await js(`document.querySelector('.sheet-tabs [data-bar=pane-menu]').click()`);
      await tick();
      const rows = await js(`[...document.querySelectorAll('.float-menu [data-bar]')]
        .map(button => button.dataset.bar)`);
      for (const action of ['pane-save', 'pane-paper', 'pane-orientation', 'pane-wacom', 'clear']) {
        assert.ok(rows.includes(action), `Missing drawing option ${action}`);
      }
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await js(`document.querySelector('.sheet-add').click()`);
      await tick();
      state = await layout();
      assert.equal(state.addTabCount, 2);
      assert.match(state.activeTab, /^Sheet 2/);

      const setScale = value => js(`(() => {
        const field = document.querySelector('.tablet-footer [data-drawing-zoom]');
        field.value = ${JSON.stringify(value)};
        field.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      const scale = () => js(`(() => {
        const field = document.querySelector('.tablet-footer [data-drawing-zoom]');
        const sheet = document.querySelector('[data-tablet=surface]');
        const width = sheet.getBoundingClientRect().width;
        return { value: field.value, width, pixels: width / JSON.parse(sheet.dataset.sheetViewport).width };
      })()`);
      const fitted = await scale();
      assert.equal(fitted.value, 'fit');
      assert.equal(await js(`document.querySelector('[data-drawing-zoom] option[value=fit]').textContent`), 'Fit');
      await setScale('100');
      await tick();
      assert.ok(Math.abs((await scale()).pixels - 640) < 1);
      await setScale('150');
      await tick();
      const enlarged = await scale();
      assert.equal(enlarged.value, '150');
      assert.ok(Math.abs(enlarged.pixels - 960) < 1);

      window.setContentSize(1080, 850);
      await tick();
      state = await layout();
      assert.ok(state.aligned && state.addBesideTabs && state.available, JSON.stringify(state));
      const narrower = await scale();
      assert.notEqual(narrower.width, enlarged.width);
      assert.equal(narrower.value, '150');
      assert.ok(Math.abs(narrower.pixels - enlarged.pixels) < 1, 'Resizing must preserve the chosen drawing scale');
      await setScale('50');
      await tick();
      const reduced = await scale();
      assert.equal(reduced.value, '50');
      assert.ok(Math.abs(reduced.pixels - 320) < 1);
      await setScale('fit');
      await tick();
      assert.notEqual((await scale()).pixels, fitted.pixels, 'Fit responds to the pane width');
      await js(`{
        const sheet = document.querySelector('[data-tablet=surface]');
        sheet.focus();
        sheet.dispatchEvent(new KeyboardEvent('keydown', {key:'0', metaKey:true, bubbles:true, cancelable:true}));
      }`);
      await tick();
      assert.ok(Math.abs((await scale()).pixels - 640) < 1);

      await js(`{
        const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="180"><rect width="900" height="180" fill="#2288aa"/></svg>');
        addTab({text:'Note sizing\\n\\n![Image](assets/image.svg)\\n\\n![Drawing](assets/drawing.svg)', assets:{'assets/image.svg':svg, 'assets/drawing.svg':svg},
          meta:{graphicsPanes:{'assets/drawing.svg':{version:1}}}});
        NoteMindFooter.setZoom(100, false);
      }`);
      await tick();
      const noteSize = () => js(`(() => {
        const text = document.createRange(), paragraph = rich.querySelector('p');
        text.setStart(paragraph.firstChild, 0); text.setEnd(paragraph.firstChild, 4);
        return {text:text.getBoundingClientRect().width,
          images:[...rich.querySelectorAll('img[data-asset]')].map(img=>img.getBoundingClientRect().width),
          available:rich.parentElement.clientWidth};
      })()`);
      const narrowNote = await noteSize();
      assert.deepEqual(narrowNote.images, [640, 640]);
      window.setContentSize(1440, 850);
      await tick();
      const wideNote = await noteSize();
      assert.notEqual(wideNote.available, narrowNote.available);
      assert.deepEqual(wideNote.images, narrowNote.images);
      assert.equal(wideNote.text, narrowNote.text);
      await js('void NoteMindFooter.setZoom(150, false)');
      await tick();
      const enlargedNote = await noteSize();
      assert.deepEqual(enlargedNote.images, [960, 960]);
      assert.ok(Math.abs(enlargedNote.text / wideNote.text - 1.5) < .01);
      finish();
    } catch (error) {
      finish(error);
    }
  });
});

require(path.resolve(process.env.NOTEMIND_TEST_APP || 'src', 'main.cjs'));
