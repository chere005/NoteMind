const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createUpdater} = require('../src/updater.cjs');
const {createWindowsUpdater} = require('../src/updater-win.cjs');

function harness({version = '1.1.0', packaged = true, arch = 'x64', hasFeedFile = true, check = async () => ({updateInfo: {version: '1.2.0'}}), download = async () => {}, answers = [], clock = {time: 1000}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-win-updater-'));
  const dialogs = [], timers = [], events = [];
  const engine = Object.assign(new EventEmitter(), {
    installs: [], downloads: 0, checks: 0,
    checkForUpdates() { this.checks++; return check(this.checks); },
    downloadUpdate() { this.downloads++; return download(); },
    quitAndInstall(...args) { this.installs.push(args); },
  });
  let loaded = 0;
  const options = {
    app: {getVersion: () => version, isPackaged: packaged, getPath: () => dir}, arch, resourcesPath: 'C:\\NoteMind\\resources',
    exists: file => hasFeedFile && file.endsWith('app-update.yml'),
    loadAutoUpdater: () => { loaded++; return engine; },
    dialog: {showMessageBox: async (...args) => { dialogs.push(args.at(-1)); return {response: answers.length ? answers.shift() : 0}; }},
    now: () => clock.time, setTimer: (fn, ms) => { const timer = {fn, ms, cleared: false, unref() {}}; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; }, prefsFile: path.join(dir, 'updates.json'), log: message => events.push(message),
  };
  return {updater: createWindowsUpdater(options), options, engine, dialogs, timers, events, clock, loaded: () => loaded};
}

test('createUpdater picks the Windows updater on win32 and never loads electron-updater elsewhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-win-pick-'));
  const base = {app: {getVersion: () => '1.1.0', isPackaged: true, getPath: () => dir}, autoUpdater: new EventEmitter(), dialog: {}, prefsFile: path.join(dir, 'u.json')};
  const win = createUpdater({...base, platform: 'win32', arch: 'x64', resourcesPath: undefined});
  assert.equal(win.isSupported(), false, 'no resources path, no app-update.yml: not the installed app');
  const mac = createUpdater({...base, platform: 'darwin', arch: 'arm64'});
  assert.equal(mac.isSupported(), true);
});

test('only the installed x64 app, which has app-update.yml in its resources, checks for updates', async () => {
  for (const options of [{packaged: false}, {arch: 'arm64'}, {arch: 'ia32'}, {hasFeedFile: false}]) {
    const h = harness(options);
    assert.deepEqual(await h.updater.check(), {status: 'unsupported'});
    assert.equal(h.engine.checks, 0);
    assert.equal(h.loaded(), 0, 'electron-updater is not even loaded');
    await h.updater.check({manual: true});
    assert.equal(h.dialogs.length, 1);
    h.updater.start();
    assert.equal(h.timers.length, 0);
  }
});

test('a newer installer is downloaded, then offered; Restart installs silently and relaunches', async () => {
  const h = harness({answers: [0]});
  assert.deepEqual(await h.updater.check(), {status: 'ready', version: '1.2.0'});
  assert.equal(h.engine.downloads, 1);
  assert.equal(h.engine.autoDownload, false);
  assert.equal(h.engine.allowDowngrade, false);
  assert.equal(h.engine.allowPrerelease, false);
  assert.match(h.dialogs[0].message, /1\.2\.0 is ready/);
  assert.deepEqual(h.engine.installs, [[true, true]]);
});

test('Later leaves it to install at quit, and only a manual check asks again', async () => {
  const h = harness({answers: [1, 1]});
  assert.deepEqual(await h.updater.check(), {status: 'ready', version: '1.2.0'});
  assert.equal(h.engine.installs.length, 0);
  assert.equal(h.engine.autoInstallOnAppQuit, true);
  await h.updater.check();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.engine.checks, 1, 'a downloaded update is not fetched again');
  await h.updater.check({manual: true});
  assert.equal(h.dialogs.length, 2);
});

test('an equal, older, pre-release or unparseable version is never installed', async () => {
  for (const offered of ['1.1.0', '1.0.9', '0.99.0', '1.2.0-beta.1', 'latest', undefined]) {
    const h = harness({check: async () => ({updateInfo: {version: offered}})});
    assert.deepEqual(await h.updater.check(), {status: 'current'}, String(offered));
    assert.equal(h.engine.downloads, 0);
  }
  const none = harness({check: async () => null});
  assert.deepEqual(await none.updater.check(), {status: 'current'});
});

test('a release without Windows files is not an update and not an error', async () => {
  for (const error of [Object.assign(Error('Cannot find latest.yml'), {code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'}), Object.assign(Error('404'), {statusCode: 404})]) {
    const h = harness({check: async () => { throw error; }});
    assert.deepEqual(await h.updater.check({manual: true}), {status: 'current'});
    assert.match(h.dialogs[0].message, /up to date/);
  }
});

test('a checksum mismatch or any other failure is reported only when asked, and nothing installs', async () => {
  const mismatch = Object.assign(Error('sha512 checksum mismatch'), {code: 'ERR_UPDATER_CHECKSUM_MISMATCH'});
  const quiet = harness({download: async () => { throw mismatch; }});
  assert.deepEqual(await quiet.updater.check(), {status: 'error', message: 'sha512 checksum mismatch'});
  assert.equal(quiet.dialogs.length, 0);
  assert.equal(quiet.engine.installs.length, 0);
  const asked = harness({download: async () => { throw mismatch; }});
  await asked.updater.check({manual: true});
  assert.match(asked.dialogs.at(-1).message, /could not download/);
  const offline = harness({check: async () => { throw Error('ENOTFOUND'); }});
  assert.deepEqual(await offline.updater.check(), {status: 'error', message: 'ENOTFOUND'});
});

test('a 403 or 429 backs off for an hour', async () => {
  for (const statusCode of [403, 429]) {
    const h = harness({check: async () => { throw Object.assign(Error('limited'), {statusCode}); }});
    assert.deepEqual(await h.updater.check(), {status: 'rate-limited', retryAt: 1000 + 3600 * 1000});
    await h.updater.check();
    assert.equal(h.engine.checks, 1);
    h.clock.time += 3601 * 1000;
    await h.updater.check();
    assert.equal(h.engine.checks, 2);
  }
  const download = harness({download: async () => { throw Object.assign(Error('limited'), {statusCode: 429}); }});
  assert.equal((await download.updater.check()).status, 'rate-limited');
});

test('the automatic check starts after launch, repeats every six hours, and the setting is remembered', async () => {
  const h = harness({check: async () => null});
  assert.equal(h.updater.isAutomatic(), true);
  h.updater.start();
  assert.equal(h.timers[0].ms, 30 * 1000);
  h.timers[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers[1].ms, 6 * 3600 * 1000);
  h.updater.setAutomatic(false);
  assert.equal(h.timers[1].cleared, true);
  assert.equal(JSON.parse(fs.readFileSync(h.options.prefsFile, 'utf8')).automatic, false);
  const again = createWindowsUpdater(h.options);
  assert.equal(again.isAutomatic(), false);
});

test('simultaneous checks share one answer', async () => {
  const h = harness({answers: [1]});
  const [a, b] = await Promise.all([h.updater.check(), h.updater.check()]);
  assert.equal(a, b);
  assert.equal(h.engine.checks, 1);
});
