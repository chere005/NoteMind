const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

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
      assert.equal(state.overlay, false, 'The drawing sheet has no floating precision controls');
      assert.equal(state.oldOptions, false, 'The pen toolbar has no drawing options button');
      assert.ok(state.aligned, 'The drawing and Notepad menus align in the top row');
      assert.ok(state.addBesideTabs && state.addGap >= 0 && state.addGap <= 6, JSON.stringify(state));

      await js(`document.querySelector('.sheet-tabs [data-bar=pane-menu]').click()`);
      await tick();
      const rows = await js(`[...document.querySelectorAll('.float-menu [data-bar]')]
        .map(button => button.dataset.bar)`);
      for (const action of ['pane-save', 'pane-paper', 'pane-orientation', 'clear']) {
        assert.ok(rows.includes(action), `Missing drawing option ${action}`);
      }
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await js(`document.querySelector('.sheet-add').click()`);
      await tick();
      state = await layout();
      assert.equal(state.addTabCount, 2);
      assert.match(state.activeTab, /^Sheet 2/);

      window.setContentSize(1080, 850);
      await tick();
      state = await layout();
      assert.ok(state.aligned && state.addBesideTabs && state.available, JSON.stringify(state));
      finish();
    } catch (error) {
      finish(error);
    }
  });
});

require(path.resolve(process.env.NOTEMIND_TEST_APP || 'src', 'main.cjs'));
