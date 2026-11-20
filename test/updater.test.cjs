const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createUpdater, pickUpdate, parseVersion, compareVersions, loopbackOverride, DOWNLOAD_PREFIX} = require('../src/updater.cjs');

const zip = version => `${DOWNLOAD_PREFIX}v${version}/NoteMind-${version}-mac-arm64.zip`;
const release = (version, extra = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  body: 'Notes',
  published_at: '2026-11-19T12:00:00Z',
  assets: [{name: `NoteMind-${version}-mac-arm64.zip`, browser_download_url: zip(version)}],
  ...extra,
});

test('versions parse as three numbers and compare numerically', () => {
  assert.deepEqual(parseVersion('v0.51.0'), [0, 51, 0]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  for (const bad of ['', 'v1', '1.2', '1.2.3-beta', '1.2.3.4', 'x.y.z', null, undefined]) assert.equal(parseVersion(bad), null);
  assert.ok(compareVersions('0.51.0', '0.50.0') > 0);
  assert.ok(compareVersions('0.9.0', '0.10.0') < 0);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), null);
});

test('only a newer, complete, published release of this repository is offered', () => {
  const offered = pickUpdate(release('0.51.0'), '0.50.0');
  assert.equal(offered.version, '0.51.0');
  assert.equal(offered.url, zip('0.51.0'));
  assert.equal(offered.notes, 'Notes');
  assert.equal(pickUpdate(release('0.50.0'), '0.50.0'), null);
  assert.equal(pickUpdate(release('0.49.0'), '0.50.0'), null);
  assert.equal(pickUpdate(release('0.51.0', {draft: true}), '0.50.0'), null);
  assert.equal(pickUpdate(release('0.51.0', {prerelease: true}), '0.50.0'), null);
  assert.equal(pickUpdate(release('0.51.0', {tag_name: 'nightly'}), '0.50.0'), null);
  assert.equal(pickUpdate(release('0.51.0', {assets: []}), '0.50.0'), null);
  assert.equal(pickUpdate(null, '0.50.0'), null);
  assert.equal(pickUpdate(release('0.51.0'), 'not a version'), null);
});

test('the zip must be named for the release and live under the release download address', () => {
  const named = (name, url) => release('0.51.0', {assets: [{name, browser_download_url: url}]});
  assert.equal(pickUpdate(named('NoteMind-0.52.0-mac-arm64.zip', zip('0.52.0')), '0.50.0'), null);
  assert.equal(pickUpdate(named('NoteMind-0.51.0-mac-x64.zip', zip('0.51.0')), '0.50.0'), null);
  assert.equal(pickUpdate(named('NoteMind-0.51.0-mac-arm64.dmg', zip('0.51.0')), '0.50.0'), null);
  assert.equal(pickUpdate(named('NoteMind-0.51.0-mac-arm64.zip', 'https://example.com/NoteMind-0.51.0-mac-arm64.zip'), '0.50.0'), null);
  assert.equal(pickUpdate(named('NoteMind-0.51.0-mac-arm64.zip', `${DOWNLOAD_PREFIX}../evil/NoteMind-0.51.0-mac-arm64.zip`), '0.50.0'), null);
  assert.equal(pickUpdate(named('NoteMind-0.51.0-mac-arm64.zip', undefined), '0.50.0'), null);
});

test('the test address override accepts only a server on this Mac', () => {
  assert.equal(loopbackOverride('http://127.0.0.1:8123/latest').prefix, 'http://127.0.0.1:8123/');
  assert.equal(loopbackOverride('http://localhost:9/x').prefix, 'http://localhost:9/');
  for (const bad of ['', undefined, 'https://127.0.0.1/x', 'http://example.com/x', 'http://127.0.0.1.example.com/x', 'file:///tmp/x', 'nonsense']) {
    assert.equal(loopbackOverride(bad), null);
  }
});

function harness({version = '0.50.0', releaseDoc = release('0.51.0'), packaged = true, env = {}, platform = 'darwin', arch = 'arm64', fetchError = null, answers = []} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-updater-'));
  const events = [];
  const dialogs = [];
  const timers = [];
  let fetches = 0;
  const autoUpdater = Object.assign(new EventEmitter(), {
    feed: null,
    installs: 0,
    setFeedURL(options) { this.feed = options; },
    checkForUpdates() { this.checks = (this.checks || 0) + 1; this.onCheck?.(this); },
    quitAndInstall() { this.installs++; },
  });
  const fakeApp = {getVersion: () => version, isPackaged: packaged, getPath: () => dir};
  const dialog = {
    showMessageBox: async (...args) => {
      const options = args[args.length - 1];
      dialogs.push(options);
      return {response: answers.length ? answers.shift() : 0};
    },
  };
  const updater = createUpdater({
    app: fakeApp, autoUpdater, dialog, env, platform, arch,
    fetchJson: async () => { fetches++; if (fetchError) throw fetchError; return releaseDoc; },
    setTimer: (fn, ms) => { const timer = {fn, ms, cleared: false, unref() {}}; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; },
    prefsFile: path.join(dir, 'updates.json'),
    log: message => events.push(message),
  });
  return {updater, autoUpdater, dialogs, timers, events, dir, fetches: () => fetches, fakeApp};
}

const getJson = url => new Promise((resolve, reject) => {
  http.get(url, {agent: false}, response => {
    let text = '';
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve({status: response.statusCode, text}));
  }).on('error', reject);
});

// Squirrel downloads from the address it was given, then reports it has the update.
const squirrelDownloads = (autoUpdater, seen) => {
  autoUpdater.onCheck = async updater => {
    const response = await getJson(updater.feed.url);
    seen.push({feed: updater.feed, response});
    setImmediate(() => updater.emit('update-downloaded', {}, 'Notes', '0.51.0'));
  };
};

test('a newer release is handed to Squirrel through a one-shot local feed, then offered for restart', async () => {
  const h = harness({answers: [0]});
  const seen = [];
  squirrelDownloads(h.autoUpdater, seen);
  const result = await h.updater.check();
  assert.deepEqual(result, {status: 'ready', version: '0.51.0'});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].feed.serverType, 'json');
  assert.match(seen[0].feed.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/update$/);
  assert.equal(seen[0].response.status, 200);
  assert.deepEqual(JSON.parse(seen[0].response.text), {url: zip('0.51.0'), name: '0.51.0', notes: 'Notes', pub_date: '2026-11-19T12:00:00Z'});
  assert.equal(h.dialogs.length, 1);
  assert.match(h.dialogs[0].message, /0\.51\.0 is ready/);
  assert.deepEqual(h.dialogs[0].buttons, ['Restart and Install', 'Later']);
  assert.equal(h.autoUpdater.installs, 1);
  assert.equal(h.autoUpdater.listenerCount('update-downloaded'), 0);
  assert.equal(h.autoUpdater.listenerCount('error'), 0);
  await assert.rejects(getJson(seen[0].feed.url), /ECONNREFUSED/);
});

test('the local feed answers only its own secret path', async () => {
  const h = harness({answers: [1]});
  const probes = [];
  h.autoUpdater.onCheck = async updater => {
    const base = updater.feed.url.replace(/\/[0-9a-f]{32}\/update$/, '');
    probes.push((await getJson(`${base}/update`)).status, (await getJson(`${base}/${'0'.repeat(32)}/update`)).status, (await getJson(updater.feed.url)).status);
    setImmediate(() => updater.emit('update-downloaded', {}));
  };
  await h.updater.check();
  assert.deepEqual(probes, [404, 404, 200]);
});

test('Later keeps the update for the next start and the same run does not ask again, a manual check does', async () => {
  const h = harness({answers: [1, 1]});
  squirrelDownloads(h.autoUpdater, []);
  assert.deepEqual(await h.updater.check(), {status: 'ready', version: '0.51.0'});
  assert.equal(h.autoUpdater.installs, 0);
  assert.equal(h.dialogs.length, 1);
  await h.updater.check();
  assert.equal(h.dialogs.length, 1, 'an automatic check does not ask again');
  assert.equal(h.fetches(), 1, 'a downloaded update is not fetched again');
  await h.updater.check({manual: true});
  assert.equal(h.dialogs.length, 2);
  assert.equal(h.autoUpdater.installs, 0);
});

test('an up-to-date app says so only when asked', async () => {
  const quiet = harness({releaseDoc: release('0.50.0')});
  assert.deepEqual(await quiet.updater.check(), {status: 'current'});
  assert.equal(quiet.dialogs.length, 0);
  const asked = harness({releaseDoc: release('0.50.0')});
  assert.deepEqual(await asked.updater.check({manual: true}), {status: 'current'});
  assert.equal(asked.dialogs.length, 1);
  assert.match(asked.dialogs[0].message, /up to date/);
  assert.equal(asked.autoUpdater.checks, undefined);
});

test('a repository with no release is simply up to date', async () => {
  const h = harness({releaseDoc: null});
  assert.deepEqual(await h.updater.check({manual: true}), {status: 'current'});
});

test('a failed check is silent in the background and reported when asked', async () => {
  const quiet = harness({fetchError: Error('offline')});
  assert.deepEqual(await quiet.updater.check(), {status: 'error', message: 'offline'});
  assert.equal(quiet.dialogs.length, 0);
  const asked = harness({fetchError: Error('offline')});
  await asked.updater.check({manual: true});
  assert.equal(asked.dialogs.length, 1);
  assert.match(asked.dialogs[0].message, /could not check/);
  assert.equal(asked.dialogs[0].detail, 'offline');
});

test('a Squirrel error ends the download cleanly and leaves nothing listening', async () => {
  const h = harness();
  let feed;
  h.autoUpdater.onCheck = updater => { feed = updater.feed.url; setImmediate(() => updater.emit('error', Error('signature mismatch'))); };
  const result = await h.updater.check();
  assert.deepEqual(result, {status: 'error', message: 'signature mismatch'});
  assert.equal(h.autoUpdater.listenerCount('error'), 0);
  assert.equal(h.autoUpdater.installs, 0);
  await assert.rejects(getJson(feed), /ECONNREFUSED/);
});

test('simultaneous checks share one answer', async () => {
  const h = harness({answers: [1]});
  squirrelDownloads(h.autoUpdater, []);
  const [a, b] = await Promise.all([h.updater.check(), h.updater.check()]);
  assert.equal(a, b);
  assert.equal(h.fetches(), 1);
  assert.equal(h.autoUpdater.checks, 1);
});

test('a copy that is not the installed arm64 Mac app never checks', async () => {
  for (const options of [{packaged: false}, {platform: 'win32'}, {platform: 'linux'}, {arch: 'x64'}]) {
    const h = harness(options);
    assert.deepEqual(await h.updater.check(), {status: 'unsupported'});
    assert.equal(h.fetches(), 0);
    assert.equal(h.dialogs.length, 0);
    await h.updater.check({manual: true});
    assert.equal(h.dialogs.length, 1);
    h.updater.start();
    assert.equal(h.timers.length, 0);
  }
});

test('the automatic check starts after launch, repeats, and the setting is remembered', () => {
  const h = harness();
  assert.equal(h.updater.isAutomatic(), true);
  h.updater.start();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 30 * 1000);
  h.updater.setAutomatic(false);
  assert.equal(h.timers[0].cleared, true);
  assert.equal(h.timers.length, 1, 'turned off: nothing is scheduled');
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir, 'updates.json'), 'utf8')).automatic, false);
  const again = harness();
  fs.writeFileSync(path.join(again.dir, 'updates.json'), '{"automatic":false}');
  const reopened = createUpdater({app: again.fakeApp, autoUpdater: again.autoUpdater, dialog: {}, prefsFile: path.join(again.dir, 'updates.json')});
  assert.equal(reopened.isAutomatic(), false);
  h.updater.setAutomatic(true);
  assert.equal(h.timers.length, 2);
  assert.equal(h.timers[1].ms, 30 * 1000);
});

test('after a background check the next one is six hours away', async () => {
  const h = harness({releaseDoc: release('0.50.0')});
  h.updater.start();
  h.timers[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers.length, 2);
  assert.equal(h.timers[1].ms, 6 * 60 * 60 * 1000);
});

test('the test-only restart switch needs the local override', async () => {
  const withoutOverride = harness({env: {NOTEMIND_UPDATE_RESTART_WHEN_READY: '1'}, answers: [1]});
  squirrelDownloads(withoutOverride.autoUpdater, []);
  await withoutOverride.updater.check();
  assert.equal(withoutOverride.dialogs.length, 1, 'still asks');
  assert.equal(withoutOverride.autoUpdater.installs, 0);

  const api = 'http://127.0.0.1:1/releases/latest';
  const local = harness({env: {NOTEMIND_UPDATE_API: api, NOTEMIND_UPDATE_RESTART_WHEN_READY: '1'}, packaged: false, releaseDoc: release('0.51.0', {assets: [{name: 'NoteMind-0.51.0-mac-arm64.zip', browser_download_url: 'http://127.0.0.1:1/NoteMind-0.51.0-mac-arm64.zip'}]})});
  squirrelDownloads(local.autoUpdater, []);
  await local.updater.check();
  assert.equal(local.dialogs.length, 0);
  assert.equal(local.autoUpdater.installs, 1);
});

test('a failing install is reported, not thrown', async () => {
  const h = harness({answers: [0]});
  squirrelDownloads(h.autoUpdater, []);
  h.autoUpdater.quitAndInstall = () => { throw Error('ShipIt is missing'); };
  await h.updater.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dialogs.length, 2);
  assert.match(h.dialogs[1].message, /could not install/);
  assert.equal(h.dialogs[1].detail, 'ShipIt is missing');
});

test('the release zip is named the way the updater looks for it', () => {
  const {assetName, ASSET_NAME} = require('../src/updater.cjs');
  assert.equal(assetName('0.51.0'), 'NoteMind-0.51.0-mac-arm64.zip');
  assert.equal(ASSET_NAME.exec(assetName('12.34.56'))[1], '12.34.56');
});
