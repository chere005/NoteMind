const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createUpdater, pickUpdate, compareVersions, DOWNLOAD_PREFIX} = require('../src/updater.cjs');
const {prepareUpdate, inspectZip, machOArch, listedHash, defaultFetchFile, allowedAddress, rateLimited, requirementFor} = require('../src/update-bundle.cjs');
const TEAM = 'TEAMID0000';
const REQUIREMENT = requirementFor(TEAM);

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const NAME = '0.51.0';
const asset = (name, url = `${DOWNLOAD_PREFIX}v${NAME}/${name}`) => ({name, browser_download_url: url});
const release = (assets, extra = {}) => ({tag_name: `v${NAME}`, draft: false, prerelease: false, body: 'Notes', published_at: '2026-11-23T12:00:00Z', assets, ...extra});
const zipName = `NoteMind-${NAME}-mac-arm64.zip`, sumsName = `NoteMind-${NAME}-mac-SHA256SUMS.txt`;

test('a release that publishes checksums hands their address to the update', () => {
  const offered = pickUpdate(release([asset(zipName), asset(sumsName)]), '0.50.0');
  assert.equal(offered.sumsUrl, `${DOWNLOAD_PREFIX}v${NAME}/${sumsName}`);
  assert.equal(pickUpdate(release([asset(zipName)]), '0.50.0').sumsUrl, '');
  assert.equal(pickUpdate(release([{...asset(zipName), size: 1234}]), '0.50.0').size, 1234, 'the listed size travels with the update');
  assert.equal(pickUpdate(release([asset(zipName)]), '0.50.0').size, 0);
  assert.equal(pickUpdate(release([asset(zipName), asset(sumsName, 'https://example.com/sums.txt')]), '0.50.0').sumsUrl, '', 'a checksum file from elsewhere is ignored');
  assert.equal(pickUpdate(release([asset(zipName), asset(`NoteMind-0.99.0-mac-SHA256SUMS.txt`)]), '0.50.0').sumsUrl, '', 'only this version\'s checksums count');
});

test('listedHash reads sha256sum lines and ignores everything else', () => {
  const good = 'a'.repeat(64), other = 'b'.repeat(64);
  const text = `${other}  other.dmg\n${good}  ${zipName}\nnot a line\n${good.toUpperCase()} *star.zip\n`;
  assert.equal(listedHash(text, zipName), good);
  assert.equal(listedHash(text, 'star.zip'), good);
  assert.equal(listedHash(text, 'missing.zip'), null);
  assert.equal(listedHash('', zipName), null);
});

function bundleHarness({inside = NAME, bytes = Buffer.from('zip bytes'), sums = undefined, fetchFail = null} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-bundle-test-'));
  const log = [];
  const update = {version: NAME, url: `${DOWNLOAD_PREFIX}v${NAME}/${zipName}`, sumsUrl: sums === null ? '' : `${DOWNLOAD_PREFIX}v${NAME}/${sumsName}`};
  const options = {
    current: '0.50.0', compareVersions, team: TEAM, tmpdir: tmp, log: message => log.push(message),
    fetchFile: async (url, destination) => { if (fetchFail) throw fetchFail; fs.writeFileSync(destination, bytes); return {sha256: sha(bytes), bytes: bytes.length}; },
    fetchText: async () => sums === undefined ? `${sha(bytes)}  ${zipName}\n` : sums,
    inspect: () => inside,
  };
  return {update, options, tmp, log, leftovers: () => fs.readdirSync(tmp)};
}

test('an update that matches its checksum and carries its own version is kept for Squirrel', async () => {
  const h = bundleHarness();
  const prepared = await prepareUpdate(h.update, h.options);
  assert.equal(fs.readFileSync(prepared.file, 'utf8'), 'zip bytes');
  assert.equal(h.leftovers().length, 1);
  prepared.cleanup();
  assert.deepEqual(h.leftovers(), []);
});

test('a zip that is not the one the release lists is refused and removed', async () => {
  for (const [options, pattern] of [
    [{sums: `${'0'.repeat(64)}  ${zipName}\n`}, /does not match the checksum/],
    [{sums: `${sha(Buffer.from('zip bytes'))}  something-else.zip\n`}, /do not list the update zip/],
    [{sums: ''}, /do not list the update zip/],
  ]) {
    const h = bundleHarness(options);
    await assert.rejects(prepareUpdate(h.update, h.options), pattern);
    assert.deepEqual(h.leftovers(), []);
  }
});

test('an older signed build attached to a newer release is a downgrade and is refused', async () => {
  for (const inside of ['0.40.0', '0.50.0', '0.49.9', '0.51.1', 'junk']) {
    const h = bundleHarness({inside});
    await assert.rejects(prepareUpdate(h.update, h.options), /the app inside is|not newer/);
    assert.deepEqual(h.leftovers(), []);
  }
  const rollback = bundleHarness({inside: '0.51.0'});
  rollback.options.current = '0.52.0';
  await assert.rejects(prepareUpdate(rollback.update, rollback.options), /not newer than this one/);
});

test('with no published checksums the signature checks still run, and the download failure is passed on', async () => {
  const quiet = bundleHarness({sums: null});
  const prepared = await prepareUpdate(quiet.update, quiet.options);
  assert.ok(quiet.log.some(message => /no checksums/.test(message)));
  prepared.cleanup();
  const failing = bundleHarness({fetchFail: Object.assign(Error('limited'), {status: 429, retryAfterMs: 5})});
  await assert.rejects(prepareUpdate(failing.update, failing.options), error => error.status === 429);
  assert.deepEqual(failing.leftovers(), []);
});

test('inspectZip demands exactly NoteMind.app, this bundle id, arm64 and a signature for this team', () => {
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-inspect-')), 'u.zip');
  fs.writeFileSync(zip, 'x');
  const harness = ({entries = ['NoteMind.app'], id = 'com.seancheren.notemind', archs = 'arm64', failVerify = null} = {}) => {
    const calls = [];
    const run = (command, args) => {
      calls.push([path.basename(command), ...args]);
      const tool = path.basename(command);
      if (tool === 'ditto') for (const entry of entries) fs.mkdirSync(path.join(args.at(-1), entry), {recursive: true});
      if (tool === 'plutil') return {CFBundleIdentifier: id, CFBundleExecutable: 'NoteMind', CFBundleShortVersionString: '0.51.0'}[args[1]] + '\n';
      if (tool === 'codesign' && failVerify && args.join(' ').includes(failVerify)) throw Error('signature invalid');
      return '';
    };
    return {calls, run, archOf: () => archs};
  };
  const ok = harness();
  assert.equal(inspectZip(zip, {run: ok.run, team: TEAM, archOf: ok.archOf}), '0.51.0');
  assert.ok(!ok.calls.some(call => ['lipo', 'otool', 'xcrun'].includes(call[0])), 'no developer-tools shim on a user\'s Mac');
  assert.ok(ok.calls.some(call => call[0] === 'codesign' && call.includes('--deep') && call.includes('--strict')));
  const requirement = ok.calls.find(call => call.some(part => part.startsWith('-R=')));
  assert.ok(requirement && requirement.includes(`-R=${REQUIREMENT}`));
  assert.match(REQUIREMENT, /certificate leaf\[subject\.OU\] = "TEAMID0000"/);
  assert.match(REQUIREMENT, /identifier "com\.seancheren\.notemind"/);
  for (const [options, pattern] of [
    [{entries: ['NoteMind.app', 'extra.app']}, /exactly NoteMind\.app/],
    [{entries: ['Other.app']}, /exactly NoteMind\.app/],
    [{id: 'com.example.other'}, /not NoteMind/],
    [{archs: 'other'}, /Apple Silicon/],
    [{archs: null}, /Apple Silicon/],
    [{failVerify: '--deep'}, /signature invalid/],
    [{failVerify: '-R='}, /signature invalid/],
  ]) { const bad = harness(options); assert.throws(() => inspectZip(zip, {run: bad.run, team: TEAM, archOf: bad.archOf}), pattern); }
  assert.throws(() => inspectZip(zip, {run: harness().run, team: null}), /not signed by a team/);
  assert.deepEqual(fs.readdirSync(path.dirname(zip)), ['u.zip'], 'the unpacked app is always removed');
});

test('only GitHub release hosts over https are fetched; a loopback address needs the test override', () => {
  assert.ok(allowedAddress('https://github.com/chere005/NoteMind/releases/download/v1/x.zip', false));
  assert.ok(allowedAddress('https://objects.githubusercontent.com/x', false));
  assert.ok(allowedAddress('https://release-assets.githubusercontent.com/x', false));
  for (const bad of ['http://github.com/x', 'https://evil.example.com/x', 'https://github.com.evil.example/x', 'https://notgithubusercontent.com/x', 'file:///etc/passwd', 'nonsense']) assert.ok(!allowedAddress(bad, false), bad);
  assert.ok(!allowedAddress('http://127.0.0.1:1/x', false));
  assert.ok(allowedAddress('http://127.0.0.1:1/x', true));
  assert.ok(!allowedAddress('https://github.com/x', true));
});

function serve(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({server, base: `http://127.0.0.1:${server.address().port}`}));
  });
}

test('the download streams to a file with its sha256, and refuses a redirect away, a big body and a rate limit', async () => {
  const body = Buffer.alloc(5000, 7);
  const {server, base} = await serve((request, response) => {
    if (request.url === '/ok') { response.writeHead(200, {'Content-Length': body.length}); response.end(body); }
    else if (request.url === '/limited') { response.writeHead(429, {'Retry-After': '120'}); response.end(); }
    else if (request.url === '/forbidden') { response.writeHead(403, {'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)}); response.end(); }
    else if (request.url === '/missing') { response.writeHead(404); response.end(); }
    else { response.writeHead(200, {'Transfer-Encoding': 'chunked'}); response.write(Buffer.alloc(3000)); setTimeout(() => response.end(Buffer.alloc(3000)), 10); }
  });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-fetch-'));
    const file = path.join(dir, 'z');
    const got = await defaultFetchFile(`${base}/ok`, file, {loopback: true});
    assert.equal(got.sha256, sha(body));
    assert.equal(got.bytes, 5000);
    assert.equal(fs.readFileSync(file).length, 5000);
    await assert.rejects(defaultFetchFile(`${base}/big`, file, {loopback: true, maxBytes: 4000}), /larger than NoteMind allows/);
    await assert.rejects(defaultFetchFile(`${base}/ok`, file, {loopback: true, expectedBytes: 4999}), /5000 bytes but the release lists 4999/, 'a body of another size than the release lists is not downloaded');
    assert.equal((await defaultFetchFile(`${base}/ok`, file, {loopback: true, expectedBytes: 5000})).bytes, 5000);
    await assert.rejects(defaultFetchFile(`${base}/ok`, file, {loopback: false}), /not a GitHub release address/);
    await assert.rejects(defaultFetchFile(`${base}/missing`, file, {loopback: true}), /answered 404/);
    const limited = await defaultFetchFile(`${base}/limited`, file, {loopback: true}).catch(error => error);
    assert.equal(limited.status, 429);
    assert.equal(limited.retryAfterMs, 15 * 60 * 1000, 'a short Retry-After is stretched to a quarter hour');
    const forbidden = await defaultFetchFile(`${base}/forbidden`, file, {loopback: true}).catch(error => error);
    assert.equal(forbidden.status, 403);
    assert.ok(forbidden.retryAfterMs > 50 * 60 * 1000 && forbidden.retryAfterMs <= 60 * 60 * 1000);
    const redirected = {ok: true, status: 200, url: 'https://evil.example.com/z', headers: new Headers(), body: new Response(body).body};
    await assert.rejects(defaultFetchFile('https://github.com/chere005/NoteMind/releases/download/v1/z', file, {fetchImpl: async () => redirected}), /redirected away from GitHub/);
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('rateLimited reads Retry-After, then X-RateLimit-Reset, and clamps the wait', () => {
  const response = (status, headers) => ({status, headers: new Headers(headers)});
  assert.equal(rateLimited(response(429, {'retry-after': '3600'}), 'x').retryAfterMs, 3600 * 1000);
  assert.equal(rateLimited(response(403, {'retry-after': '999999999'}), 'x').retryAfterMs, 24 * 3600 * 1000);
  assert.equal(rateLimited(response(403, {}), 'x').retryAfterMs, 15 * 60 * 1000);
  assert.equal(rateLimited(response(403, {}), 'x').status, 403);
});

// ---- the updater around it

function harness({prepared, fetchJson, clock = {time: 1000}, answers = [], automatic = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-updater-verify-'));
  const dialogs = [], timers = [], events = [];
  const autoUpdater = Object.assign(new EventEmitter(), {setFeedURL(options) { this.feed = options; }, checkForUpdates() { this.onCheck?.(this); }, quitAndInstall() { this.installs = (this.installs || 0) + 1; }});
  let fetches = 0;
  const updater = createUpdater({
    app: {getVersion: () => '0.50.0', isPackaged: true, getPath: () => dir}, autoUpdater, platform: 'darwin', arch: 'arm64', env: {},
    dialog: {showMessageBox: async (...args) => { dialogs.push(args.at(-1)); return {response: answers.length ? answers.shift() : 1}; }},
    fetchJson: async () => { fetches++; return fetchJson(fetches); },
    prepare: async update => prepared(update),
    now: () => clock.time,
    setTimer: (fn, ms) => { const timer = {fn, ms, unref() {}}; timers.push(timer); return timer; },
    clearTimer: () => {}, prefsFile: path.join(dir, 'updates.json'), log: message => events.push(message),
  });
  if (!automatic) updater.setAutomatic(false);
  return {updater, autoUpdater, dialogs, timers, events, clock, fetches: () => fetches};
}
const doc = () => release([asset(zipName), asset(sumsName)]);
const get = url => new Promise((resolve, reject) => http.get(url, {agent: false}, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks), headers: response.headers})); }).on('error', reject));

test('Squirrel is given the checked file from this Mac, and the file is removed afterwards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-served-'));
  const file = path.join(dir, 'NoteMind.zip');
  fs.writeFileSync(file, 'verified zip bytes');
  let cleaned = 0;
  const h = harness({fetchJson: doc, prepared: update => { assert.equal(update.sumsUrl, `${DOWNLOAD_PREFIX}v${NAME}/${sumsName}`); return {file, cleanup: () => { cleaned++; }}; }});
  let served;
  h.autoUpdater.onCheck = async updater => {
    const feed = JSON.parse((await get(updater.feed.url)).body.toString());
    served = {feed, zip: await get(feed.url)};
    setImmediate(() => updater.emit('update-downloaded', {}, 'Notes', NAME));
  };
  assert.deepEqual(await h.updater.check(), {status: 'ready', version: NAME});
  assert.match(served.feed.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/NoteMind\.zip$/);
  assert.notEqual(served.feed.url, `${DOWNLOAD_PREFIX}v${NAME}/${zipName}`, 'never the GitHub address');
  assert.equal(served.zip.status, 200);
  assert.equal(served.zip.body.toString(), 'verified zip bytes');
  assert.equal(cleaned, 1);
});

test('an update that fails its checks is never given to Squirrel, and is reported when asked', async () => {
  const h = harness({fetchJson: doc, prepared: () => { throw Error('The app inside is 0.40.0.'); }});
  h.autoUpdater.onCheck = () => assert.fail('Squirrel must not be asked');
  assert.deepEqual(await h.updater.check(), {status: 'error', message: 'The app inside is 0.40.0.'});
  assert.equal(h.dialogs.length, 0);
  await h.updater.check({manual: true});
  assert.match(h.dialogs.at(-1).message, /could not download/);
  assert.equal(h.dialogs.at(-1).detail, 'The app inside is 0.40.0.');
});

test('Squirrel reporting a different release than the one checked is an error', async () => {
  let cleaned = 0;
  const h = harness({fetchJson: doc, prepared: () => ({file: __filename, cleanup: () => { cleaned++; }})});
  h.autoUpdater.onCheck = async updater => { await get(updater.feed.url); setImmediate(() => updater.emit('update-downloaded', {}, 'Notes', '0.49.0')); };
  const result = await h.updater.check();
  assert.equal(result.status, 'error');
  assert.match(result.message, /downloaded 0\.49\.0, not 0\.51\.0/);
  assert.equal(cleaned, 1);
});

test('after a 403 or 429 NoteMind stops asking until the wait is over, and says so only when asked', async () => {
  for (const status of [403, 429]) {
    const h = harness({fetchJson: () => { throw Object.assign(Error('limited'), {status, retryAfterMs: 20 * 60 * 1000}); }, prepared: () => assert.fail('no download')});
    assert.deepEqual(await h.updater.check(), {status: 'rate-limited', retryAt: 1000 + 20 * 60 * 1000});
    assert.equal(h.dialogs.length, 0, 'quiet in the background');
    assert.equal(h.fetches(), 1);
    assert.deepEqual(await h.updater.check(), {status: 'rate-limited', retryAt: 1000 + 20 * 60 * 1000});
    assert.equal(h.fetches(), 1, 'no second request while limited');
    await h.updater.check({manual: true});
    assert.equal(h.fetches(), 1);
    assert.match(h.dialogs.at(-1).message, /limiting update checks/);
    h.clock.time += 21 * 60 * 1000;
    await h.updater.check();
    assert.equal(h.fetches(), 2, 'asks again once the wait is over');
  }
});

test('the next automatic check waits out a rate limit longer than six hours', async () => {
  const h = harness({fetchJson: () => { throw Object.assign(Error('limited'), {status: 429, retryAfterMs: 10 * 3600 * 1000}); }, prepared: () => assert.fail('no download')});
  h.updater.start();
  h.timers[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers[1].ms, 10 * 3600 * 1000);
});

test('a failed check that is not a rate limit is still just an error', async () => {
  const h = harness({fetchJson: () => { throw Object.assign(Error('The update server answered 500.'), {status: 500}); }, prepared: () => assert.fail('no download')});
  assert.deepEqual(await h.updater.check(), {status: 'error', message: 'The update server answered 500.'});
  await h.updater.check();
  assert.equal(h.fetches(), 2);
});

test('the architecture comes from the Mach-O header, so the update check needs no developer tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-macho-'));
  const header = (magic, cpu) => { const buffer = Buffer.alloc(32); buffer.writeUInt32LE(magic, 0); buffer.writeUInt32LE(cpu, 4); return buffer; };
  const write = (name, bytes) => { const file = path.join(dir, name); fs.writeFileSync(file, bytes); return file; };
  assert.equal(machOArch(write('arm64', header(0xfeedfacf, 0x0100000c))), 'arm64');
  assert.equal(machOArch(write('x86_64', header(0xfeedfacf, 0x01000007))), 'other');
  const fat = Buffer.alloc(32); fat.writeUInt32BE(0xcafebabe, 0);
  assert.equal(machOArch(write('fat', fat)), 'other', 'a universal file is not an Apple Silicon-only build');
  assert.equal(machOArch(write('script', Buffer.from('#!/bin/sh\necho hi\n'))), null);
  assert.equal(machOArch(write('tiny', Buffer.from('abc'))), null);
  const real = process.platform === 'darwin' && fs.existsSync('/bin/ls') ? machOArch('/bin/ls') : null;
  if (real) assert.ok(['arm64', 'other'].includes(real), 'reads a real system binary');
});

test('nothing on the update path runs an xcrun shim (lipo, otool, swift, ...): users do not have developer tools', () => {
  const shims = /['"`/](?:lipo|otool|swift|swiftc|xcodebuild|xcrun|clang|git|make|python3?|ruby|perl)['"`]/;
  for (const file of ['src/update-bundle.cjs', 'src/updater.cjs', 'src/updater-win.cjs']) {
    const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, shims, `${file} spawns a developer-tools shim`);
  }
  // Every command the real update check spawns is a binary macOS ships, not a shim.
  const spawned = new Set([...fs.readFileSync(path.join(__dirname, '..', 'src/update-bundle.cjs'), 'utf8').matchAll(/['"](\/usr\/(?:bin|sbin|libexec)\/[a-zA-Z]+)['"]/g)].map(match => match[1]));
  assert.deepEqual([...spawned].sort(), ['/usr/bin/codesign', '/usr/bin/ditto', '/usr/bin/plutil']);
});

test('a release whose checksum file was already refused is not downloaded again; a changed release is', async () => {
  const bad = Buffer.from('not the real zip');
  const refusedSums = `${'0'.repeat(64)}  ${zipName}\n`;
  const first = bundleHarness({bytes: bad, sums: refusedSums});
  let rejection = null;
  await assert.rejects(prepareUpdate(first.update, first.options), error => { rejection = error.rejection; return /does not match the checksum/.test(error.message); });
  assert.equal(rejection.version, NAME);
  assert.match(rejection.key, /^sums:[0-9a-f]{64}$/);

  const again = bundleHarness({bytes: bad, sums: refusedSums});
  let downloads = 0;
  again.options.fetchFile = async () => { downloads++; throw Error('must not download'); };
  await assert.rejects(prepareUpdate(again.update, {...again.options, rejected: rejection}), error => error.alreadyRejected === true && !error.rejection);
  assert.equal(downloads, 0, 'the body is not fetched a second time');
  assert.deepEqual(again.leftovers(), []);

  const fixed = bundleHarness();
  const prepared = await prepareUpdate(fixed.update, {...fixed.options, rejected: rejection});
  prepared.cleanup();

  const otherVersion = bundleHarness({bytes: bad, sums: refusedSums});
  otherVersion.update.version = '0.52.0';
  otherVersion.options.inspect = () => '0.52.0';
  await assert.rejects(prepareUpdate(otherVersion.update, {...otherVersion.options, rejected: rejection}), /does not match the checksum/, 'a different release is tried');

  const wrongInside = bundleHarness({inside: '0.40.0'});
  await assert.rejects(prepareUpdate(wrongInside.update, wrongInside.options), error => error.rejection?.version === NAME, 'a wrong app inside is remembered too');
  const network = bundleHarness({fetchFail: Object.assign(Error('offline'), {status: 500})});
  await assert.rejects(prepareUpdate(network.update, network.options), error => !error.rejection, 'a failed download is not a refusal');
});

test('the updater remembers a refused release across restarts and skips it, until another release or a manual check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-rejected-'));
  const prefsFile = path.join(dir, 'updates.json');
  const make = prepared => {
    const autoUpdater = new EventEmitter();
    autoUpdater.setFeedURL = () => {}; autoUpdater.checkForUpdates = () => {};
    return createUpdater({app: {getVersion: () => '0.50.0', isPackaged: true, getPath: () => dir}, autoUpdater, dialog: {showMessageBox: async () => ({response: 1})}, platform: 'darwin', arch: 'arm64', env: {}, fetchJson: async () => release([asset(zipName), asset(sumsName)]), prepare: prepared, prefsFile, setTimer: () => ({unref() {}}), clearTimer() {}});
  };
  const seen = [];
  const refuse = async (update, extra) => { seen.push(extra.rejected); throw Object.assign(Error('The update zip does not match the checksum the release publishes.'), {rejection: {version: update.version, key: 'sums:abc'}}); };
  const first = make(refuse);
  assert.equal((await first.check()).status, 'error');
  assert.deepEqual(JSON.parse(fs.readFileSync(prefsFile, 'utf8')), {automatic: true, rejected: {version: NAME, key: 'sums:abc'}});
  first.setAutomatic(false);
  assert.deepEqual(JSON.parse(fs.readFileSync(prefsFile, 'utf8')).rejected, {version: NAME, key: 'sums:abc'}, 'the setting keeps the refusal');

  const restarted = make(async (update, extra) => { seen.push(extra.rejected); throw Object.assign(Error('refused earlier'), {alreadyRejected: true}); });
  assert.equal(restarted.isAutomatic(), false);
  assert.deepEqual(await restarted.check(), {status: 'rejected', message: 'refused earlier'});
  assert.deepEqual(seen.at(-1), {version: NAME, key: 'sums:abc'}, 'the saved refusal is passed to the check');
  await restarted.check({manual: true});
  assert.equal(seen.at(-1), null, 'asking by hand tries again');
});
