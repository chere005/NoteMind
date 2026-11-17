const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const penBundle = esbuild.buildSync({
  stdin: { contents: "export {penSettings,setButton,noticePen} from './src/tablet/renderer/penSettings.ts'; export {BUTTON_LAYOUT} from './src/tablet/renderer/penButtons.ts'", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  alias: { '@notemind/core': path.resolve('src/tablet/core.js') },
}).outputFiles[0].text;
const plain = value => JSON.parse(JSON.stringify(value));
function loadPen({ local = new Map(), get = () => Promise.resolve(null), write = () => {}, onPreference = () => {} } = {}) {
  const module = { exports: {} };
  const localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
  const window = { addEventListener() {}, notemind: { preferenceGet: get, preferenceSet: (key, value) => { write(key, value); return Promise.resolve(); }, onPreference } };
  vm.runInNewContext(penBundle, { module, exports: module.exports, require, process, window, localStorage, performance });
  return module.exports;
}

test('physical pen button choices remain identical after reopening with a fresh renderer profile', async () => {
  let shared = JSON.stringify({ slots: { lower: { hold: 'select', double: 'redo' }, upper: { hold: 'erase', double: 'undo' } } });
  const first = loadPen({ get: () => Promise.resolve(shared), write: (_, value) => { shared = value; } });
  await Promise.resolve();
  assert.deepEqual(plain(first.penSettings().buttons.lower), { hold: 'erase', double: 'undo' });
  assert.deepEqual(plain(first.penSettings().buttons.upper), { hold: 'select', double: 'redo' });
  first.setButton('lower', 'hold', 'pan');
  first.setButton('lower', 'hold', 'erase');
  assert.equal(JSON.parse(shared).buttonLayout, 'physical-v1');
  const reopened = loadPen({ get: () => Promise.resolve(shared) });
  await Promise.resolve();
  assert.deepEqual(plain(reopened.penSettings().buttons), plain(first.penSettings().buttons));
  // Deliberate changes, including a reversed factory pair, must never be guessed away on reload.
  first.setButton('lower', 'hold', 'select'); first.setButton('lower', 'double', 'redo');
  first.setButton('upper', 'hold', 'erase'); first.setButton('upper', 'double', 'undo');
  const custom = loadPen({ get: () => Promise.resolve(shared) });
  await Promise.resolve();
  assert.deepEqual(plain(custom.penSettings().buttons), plain(first.penSettings().buttons));
});

test('a pen hover cannot overwrite the shared button map before startup preferences arrive', async () => {
  let finish; const writes = [];
  const pen = loadPen({ get: () => new Promise(resolve => { finish = resolve; }), write: (...args) => writes.push(args) });
  pen.noticePen({ pointerType: 'pen', pressure: .7 });
  assert.equal(pen.penSettings().seen, 'pressure');
  assert.equal(writes.length, 0);
  finish(JSON.stringify({ buttonLayout: 'physical-v1', slots: { lower: { hold: 'pan', double: 'wider' }, upper: { hold: 'add', double: 'contextMenu' } } }));
  await Promise.resolve();
  assert.deepEqual(plain(pen.penSettings().buttons.lower), { hold: 'pan', double: 'wider' });
  assert.deepEqual(plain(pen.penSettings().buttons.upper), { hold: 'add', double: 'contextMenu' });
  assert.equal(writes.length, 0);
});

test('a delayed startup preference read cannot undo a newly chosen physical button action', async () => {
  let finish; const local = new Map();
  const pen = loadPen({ local, get: () => new Promise(resolve => { finish = resolve; }) });
  pen.setButton('lower', 'hold', 'pan');
  finish(JSON.stringify({ buttonLayout: 'physical-v1', slots: { lower: { hold: 'erase', double: 'undo' }, upper: { hold: 'select', double: 'redo' } } }));
  await Promise.resolve();
  assert.equal(pen.penSettings().buttons.lower.hold, 'pan');
  assert.equal(JSON.parse(local.get('notemind.pen')).slots.lower.hold, 'pan');
});

test('pen, orientation and paper choices persist in the application profile', async () => {
  const result = esbuild.buildSync({
    stdin: {
      contents: "export {penSettings,setPressure} from './src/tablet/renderer/penSettings.ts'; export {orientation,setOrientation} from './src/tablet/renderer/orientation.ts'; export {paper,setPaper} from './src/tablet/renderer/tabletPaper.ts';",
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    alias: { '@notemind/core': path.resolve('src/tablet/core.js') },
  });
  const stored = new Map(), shared = new Map();
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const load = () => {
    const module = { exports: {} };
    const window = {
      addEventListener() {},
      notemind: {
        preferenceGet: key => Promise.resolve(shared.get(key) ?? null),
        preferenceSet: (key, value) => { shared.set(key, value); return Promise.resolve(); },
        onPreference() {},
      },
    };
    vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require, process, window, localStorage });
    return module.exports;
  };
  const first = load();
  first.setPressure(false);
  first.setOrientation(1);
  first.setPaper({ kind: 'lines', colour: 'cream' });
  assert.deepEqual([...stored.keys()].sort(), ['notemind.orientation', 'notemind.pen', 'notemind.sheetPaper']);
  assert.equal(shared.get('orientation'), 1);
  assert.equal(JSON.parse(shared.get('pen')).pressure, false);
  const reopened = load();
  await Promise.resolve();
  assert.equal(reopened.penSettings().pressure, false);
  assert.equal(reopened.orientation(), 1);
  assert.equal(reopened.paper().kind, 'lines');
  assert.equal(reopened.paper().colour, 'cream');
});

test('native pen capture obeys the application environment switch', () => {
  const result = esbuild.buildSync({ entryPoints: ['src/tablet/main/pen/subsystem.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'koffi'], define: { 'import.meta.url': '"file:///notemind-test.cjs"' } });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require, process, Buffer, setTimeout, clearTimeout, performance });
  const input = { platform: 'darwin', userData: '/tmp/notemind-profile', exists: () => false };
  assert.equal(module.exports.penDisabledReason({ ...input, env: {} }), null);
  assert.match(module.exports.penDisabledReason({ ...input, env: { NOTEMIND_PEN: ' off ' } }), /switched off/);
});
