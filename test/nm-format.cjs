const { app, dialog } = require('electron'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve('test-results/nm-format-' + Date.now());fs.mkdirSync(root, { recursive: true });process.env.NOTEMIND_DATA = root;app.disableHardwareAcceleration();
const sourceRoot = process.env.NOTEMIND_TEST_APP || path.resolve('src'), format = require(path.join(sourceRoot, 'notepad-format.cjs')), graphics = require(path.join(sourceRoot, 'graphics-pane.js'));
const sheet = { name: 'Native drawing', aspect: .75, strokes: [{ colorHex: '#112233', width: 3, points: [{ x: .2, y: .3 }, { x: .4, y: .5 }] }] };
const name = 'assets/drawing.svg', original = { text: '# Native marker\n\n![Drawing](' + name + ')', title: 'Native marker', assets: { [name]: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>').toString('base64'), [name + '.json']: Buffer.from(graphics.encode(sheet)).toString('base64') }, meta: { graphicsPanes: { [name]: { version: 1 } } } };
const native = path.join(root, 'Native.nm'), legacy = path.join(root, 'Legacy.wm');for (const file of [native, legacy]) fs.writeFileSync(file, format.encode(original));
const pause = ms => new Promise(r => setTimeout(r, ms)), report = { root, checks: [] };let tested = false;
app.on('browser-window-created', (_, w) => { if (tested) return;tested = true;w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load', async () => {
 const js = code => w.webContents.executeJavaScript(code), check = (ok, label) => { if (!ok) throw Error(label);report.checks.push(label); };
 try {
  await pause(1000);
  for (const file of [native, legacy]) {
   const opened = await js(`window.notemind.openPath(${JSON.stringify(file)})`);
   check(opened.text === original.text && opened.meta.graphicsPanes[name].version === 1 && !!opened.assets[name + '.json'], path.extname(file) + ' opens as an archive with editable pane metadata');
  }
  check((await js(`window.notemind.listFolder(${JSON.stringify(root)})`)).some(row => row.path === native), 'folder listings include .nm documents');
  check((await js(`window.notemind.searchFolder(${JSON.stringify(root)},'Native marker')`)).some(row => row.path === native), 'folder search reads .nm archive text');
  let options;dialog.showSaveDialog = async (_window, value) => { options = value;return { canceled: false, filePath: path.join(root, path.basename(value.defaultPath)) }; };
  await js(`addTab(${JSON.stringify({ ...original, path: null })});save()`);
  const saved = await js('doc.path');check(saved.endsWith('.nm') && options.filters[0].extensions[0] === 'nm', 'new Notepads save with .nm by default');
  check(format.decode(fs.readFileSync(saved)).meta.graphicsPanes[name].version === 1, '.nm save preserves graphics pane metadata');
  const drawing = await js(`window.notemind.savePane(${JSON.stringify(sheet)},${JSON.stringify(original.assets[name])})`);
  check(drawing.endsWith('Drawing.nm'), 'drawing sheets also default to .nm');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [drawing] });
  const reopened = await js('window.notemind.openPane()');check(reopened.sheet.strokes.length === 1 && reopened.sheet.aspect === .75, 'compact .nm drawing sheets reopen with their editable strokes');
  const archive = format.decode(fs.readFileSync(drawing));check(!!archive.assets[name + '.json'] && archive.meta.graphicsPanes[name].version === 1, 'saved drawings use the same graphics pane sidecar format');
  report.ok = true;
 } catch (error) { report.ok = false;report.error = error.stack; }
 fs.writeFileSync('test-results/nm-format.json', JSON.stringify(report, null, 2));console.log(JSON.stringify(report, null, 2));app.exit(report.ok ? 0 : 1);
 });
});
require(path.join(sourceRoot, 'main.cjs'));setTimeout(() => app.exit(1), 30000).unref();
