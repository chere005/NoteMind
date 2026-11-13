const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

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
