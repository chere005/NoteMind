const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const scenarios = ['open-window', 'closed-window', 'unsaved-stroke', 'open-pdf'];
const scenario = process.env.NOTEMIND_QUIT_SCENARIO;
const simulatedPad = process.env.NOTEMIND_QUIT_TEST_PAD === '1';
const requestMarker = 'Quit test requested shutdown';
const sessionPath = profile => path.join(profile, 'note-recovery', 'session.json');

function simulatePenDisplay() {
  const Module = require('node:module');
  const { BrowserWindow } = require('electron');
  const load = Module._load;
  delete process.env.NOTEMIND_TEST_NO_PAD;
  BrowserWindow.prototype.showInactive = () => {};
  Module._load = function (request, parent, isMain) {
    const result = load.call(this, request, parent, isMain);
    if (request !== 'electron') return result;
    const screen = new Proxy({}, {
      get(_, key) {
        const real = result.screen;
        if (key === 'getAllDisplays') return () => {
          const primary = real.getPrimaryDisplay();
          const { x, y, width } = primary.bounds;
          const bounds = { x: x + width, y, width: 1080, height: 1920 };
          return [primary, {
            ...primary, id: primary.id + 100, label: 'Wacom test', internal: false, bounds, workArea: bounds,
          }];
        };
        const value = real[key];
        return typeof value === 'function' ? value.bind(real) : value;
      },
    });
    return {
      ...result, screen,
      BrowserWindow: class extends result.BrowserWindow {
        isFocused() { return true; }
      },
    };
  };
}

function startWorkspace() {
  assert.ok(scenarios.includes(scenario));
  const profile = process.env.NOTEMIND_DATA;
  assert.ok(profile && fs.existsSync(profile));
  app.setPath('documents', profile);
  app.disableHardwareAcceleration();
  if (simulatedPad) simulatePenDisplay();
  app.on('before-quit', () => console.log('before-quit'));
  app.on('will-quit', () => console.log('will-quit'));
  app.on('quit', (_, code) => {
    if (!code && fs.existsSync(sessionPath(profile))) console.log('Recovery session exists at quit');
  });
  app.once('browser-window-created', (_, window) => {
    const contents = window.webContents;
    contents.setBackgroundThrottling(false);
    contents.once('did-finish-load', async () => {
      const js = code => contents.executeJavaScript(code);
      await js(`(async () => {
        if (document.getElementById('pane').hidden) document.getElementById('paneToggle').click();
        const target = ${simulatedPad} ? '.pad-placeholder' : '[data-tablet=surface]';
        while (!window.NoteMindNotes?.ready || !document.querySelector(target)) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      })()`);
      const drawingContents = simulatedPad
        ? require('electron').BrowserWindow.getAllWindows().find(child => child !== window).webContents
        : contents;
      drawingContents.setBackgroundThrottling(false);
      await drawingContents.executeJavaScript(`(async () => {
        while (!document.querySelector('[data-tablet=surface]')) await new Promise(resolve => setTimeout(resolve, 25));
      })()`);
      if (scenario === 'unsaved-stroke') {
        await drawingContents.executeJavaScript(`(() => {
          const surface = document.querySelector('[data-tablet=surface]');
          const rect = surface.getBoundingClientRect();
          for (const [type, fraction] of [['pointerdown', .3], ['pointermove', .5]]) {
            surface.dispatchEvent(new PointerEvent(type, {
              bubbles: true, pointerId: 4242, pointerType: 'mouse', button: 0, buttons: 1, pressure: .7,
              clientX: rect.left + rect.width * fraction, clientY: rect.top + rect.height * fraction,
            }));
          }
        })()`);
      }
      if (scenario === 'open-pdf') {
        const workers = [];
        app.on('browser-window-created', (_, child) => workers.push(child));
        const { PDFDocument } = require('pdf-lib');
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const file = path.join(profile, 'quit-reference.pdf');
        fs.writeFileSync(file, await pdf.save());
        await js(`window.dispatchEvent(new CustomEvent('notemind-preview', {
          detail: { path: ${JSON.stringify(file)}, name: 'Quit reference.pdf' },
        }))`);
        const renderer = simulatedPad ? drawingContents : contents;
        await renderer.executeJavaScript(`(async () => {
          while (!document.querySelector('.document-workspace:not([hidden]) canvas')) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        })()`);
        const worker = workers.find(child => !child.isDestroyed() &&
          child.webContents.getURL().endsWith('/pdf-reference-worker.html'));
        assert.ok(worker, 'The real PDF worker is open at Quit');
        let pdfClosing = false;
        worker.on('close', () => { pdfClosing = true; });
        window.prependOnceListener('close', () => {
          if (!pdfClosing && !worker.isDestroyed()) console.log('PDF worker remains open during workspace flush');
        });
      }
      window.once('closed', () => {
        console.log('Workspace window closed');
      });
      fs.writeSync(1, requestMarker + '\n');
      if (scenario === 'closed-window') window.close();
      else app.quit();
    });
  });
  require('../src/main.cjs');
}

async function runScenario(root, name) {
  const profile = fs.mkdtempSync(path.join(root, name + '-'));
  const child = spawn(process.execPath, [require.resolve('./hidden-runner.cjs'), 'quit-exits'], {
    env: {
      ...process.env,
      NOTEMIND_QUIT_SCENARIO: name,
      NOTEMIND_DATA: profile,
      NOTEMIND_HOME: profile,
      NOTEMIND_WORKSPACES: path.join(profile, 'workspaces'),
      NOTEMIND_PAD_OWNER: path.join(profile, 'pad-owner.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = '';
  let quitDeadline;
  const deadline = (reason, ms) => setTimeout(() => {
    timedOut = reason;
    child.kill('SIGKILL');
  }, ms);
  const startupDeadline = deadline('The workspace did not start', 15000);
  child.stdout.setEncoding('utf8').on('data', text => {
    stdout += text;
    if (!quitDeadline && stdout.includes(requestMarker)) {
      clearTimeout(startupDeadline);
      quitDeadline = deadline('The process did not exit within five seconds', 5000);
    }
  });
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  try {
    const [code, signal] = await new Promise((resolve, reject) => {
      child.once('close', (...result) => resolve(result));
      child.once('error', reject);
    });
    const output = `${name}: ${stdout}${stderr}`;
    assert.equal(timedOut, '', `${timedOut}\n${output}`);
    assert.equal(signal, null, output);
    assert.equal(code, 0, output);
    assert.ok(stdout.includes(requestMarker) && stdout.includes('Workspace window closed'), output);
    assert.ok(stdout.includes('Recovery session exists at quit'), output);
    if (name === 'open-pdf') assert.ok(stdout.includes('PDF worker remains open during workspace flush'), output);
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(sessionPath(profile))).tabs));
    if (name === 'unsaved-stroke') {
      assert.ok(fs.existsSync(path.join(profile, 'sheets-v2.json')), 'The unsaved sheet reached disk');
      const { SheetPersistence } = require('../src/sheet-persistence.cjs');
      const sheets = new SheetPersistence(path.join(profile, 'sheets.json'));
      try {
        const [page] = await sheets.load();
        assert.equal(page.strokes.length, 1, 'The unfinished stroke was saved exactly once');
        assert.equal(page.strokes[0].points.length, 2);
      } finally {
        await sheets.dispose();
      }
    }
    console.log(`${name} passed`);
  } finally {
    clearTimeout(startupDeadline);
    clearTimeout(quitDeadline);
  }
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-quit-'));
  app.setPath('userData', root);
  let failed = false;
  for (const name of scenarios) {
    try {
      await runScenario(root, name);
    } catch (error) {
      console.error(error.message);
      failed = true;
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}

if (scenario) startWorkspace();
else void run();
