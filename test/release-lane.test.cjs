const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {release, installApp, ReleaseError, winNames} = require('../scripts/release.cjs');
const {names} = require('../scripts/mac-release.cjs');
const {DOWNLOAD_PREFIX} = require('../src/updater.cjs');

const VERSION = '1.2.0', TAG = 'v1.2.0';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const NOTARIZED = 'source=Notarized Developer ID';

function lane({branch = 'main', dirty = '', behind = false, tagExists = false, releaseExists = false, latestTag = 'v1.1.0', lockVersion = VERSION, windows = 'ready', scan = 0, scanOutput = 'public-scan: RESULT: hits in 2 class(es): literals=300, tree=60', baseline = {tree: 50, literals: 123, personal: 1}, version = VERSION, spctl = NOTARIZED, publishedZip = null, sums = null, feed = null, apiLatest = TAG, running = false, options = {}, pushFails = null, createFails = false, staleFeed = 0, installedTeam = 'TEAMID0000', headMoved = false, env: extraEnv = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-lane-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version}));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({version: lockVersion, packages: {'': {version: lockVersion}}}));
  const file = names(version), win = winNames(version);
  const calls = [], logs = [];
  const bytes = {zip: Buffer.from('zip bytes'), dmg: Buffer.from('dmg bytes'), installer: Buffer.from('MZ installer bytes'), blockmap: Buffer.from('blockmap')};
  const local = {[file.zip]: bytes.zip, [file.dmg]: bytes.dmg};
  const published = {...local, ...(publishedZip ? {[file.zip]: publishedZip} : {})};
  const sumsText = sums ?? Object.entries(local).map(([name, data]) => `${sha(data)}  ${name}`).join('\n') + '\n';
  const feedText = feed ?? `version: ${version}\nfiles:\n  - url: ${win.installer}\n    sha512: ${crypto.createHash('sha512').update(bytes.installer).digest('base64')}\npath: ${win.installer}\n`;
  const state = {remoteTags: new Set(), feedCalls: 0, draft: null, assetsOnRelease: [], pushed: [], tags: new Set(tagExists ? [TAG] : []), clock: 0, windowsAt: windows === 'ready' ? 0 : windows === 'late' ? 90 * 1000 : Infinity, running, installed: false};
  const sh = (command, args, opts = {}) => {
    calls.push([path.basename(command), ...args]);
    const key = [path.basename(command), ...args].join(' ');
    const ok = (stdout = '', status = 0) => ({status, stdout, stderr: ''});
    const fail = (stdout = '') => { if (!opts.allowFail) throw new ReleaseError(`${key} failed`); return {status: 1, stdout, stderr: ''}; };
    if (command === 'git') {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok(branch + '\n');
      if (args[0] === 'status') return ok(dirty);
      if (args[0] === 'merge-base') return behind ? fail() : ok();
      if (args[0] === 'rev-parse' && args[1] === '-q') return state.tags.has(args[3].replace('refs/tags/', '')) ? ok('abc\n') : fail();
      if (args[0] === 'rev-parse') return ok(headMoved && args[1] === 'HEAD' ? 'def456\n' : 'abc123\n');
      if (args[0] === 'ls-remote') return ok(state.remoteTags.has(args[3].replace('refs/tags/', '')) ? 'abc\trefs/tags/x\n' : '');
      if (args[0] === 'tag' && args[1] === '-l') return ok('Release subject\n');
      if (args[0] === 'log') return ok('Release subject\n');
      if (args[0] === 'tag' && args[1] === '-a') { state.tags.add(args[2]); return ok(); }
      if (args[0] === 'tag' && args[1] === '-d') { state.tags.delete(args[2]); return ok(); }
      if (args[0] === 'push') {
        if (pushFails === args[2] && !state.pushFailed) { state.pushFailed = true; return fail(); }
        state.pushed.push(args[2]); if (args[2].startsWith('v')) state.remoteTags.add(args[2]); return ok();
      }
      return ok();
    }
    if (command === 'gh') {
      if (args[0] === 'auth') return ok();
      if (args[0] === 'api' && args[1].includes('/releases?per_page')) {
        if (state.draft) return ok(JSON.stringify({draft: state.draft.draft, assets: [...state.draft.assets, ...(state.clock >= state.windowsAt ? [win.installer, win.blockmap, win.feed] : [])]}) + '\n');
        return releaseExists ? ok(JSON.stringify({draft: false, assets: []}) + '\n') : ok('');
      }
      if (args[0] === 'release' && args[1] === 'view') return latestTag ? ok(latestTag + '\n') : fail();
      if (args[0] === 'release' && args[1] === 'create' && createFails && !state.createFailed) { state.createFailed = true; return fail(); }
      if (args[0] === 'release' && args[1] === 'upload') { state.draft.assets.push(...args.filter(arg => /\.(zip|dmg|txt)$/.test(arg)).map(arg => path.basename(arg))); return ok(); }
      if (args[0] === 'release' && args[1] === 'create') { state.draft = {draft: true, assets: args.slice(args.indexOf('--notes-file') + 2).map(entry => path.basename(entry))}; return ok(); }
      if (args[0] === 'release' && args[1] === 'edit') { state.draft.draft = false; return ok(); }
      if (args[0] === 'release' && args[1] === 'download') {
        const dir = args[args.indexOf('--dir') + 1];
        const files = {...published, [file.sums]: Buffer.from(sumsText), ...(windows !== 'none' && !options.macOnly ? {[win.installer]: bytes.installer, [win.blockmap]: bytes.blockmap, [win.feed]: Buffer.from(feedText)} : {})};
        for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
        return ok();
      }
      if (args[0] === 'api' && args[1].endsWith('/releases/latest')) {
        const assets = [file.zip, file.sums, file.dmg].map(name => ({name, browser_download_url: `${DOWNLOAD_PREFIX}${TAG}/${name}`}));
        return ok(JSON.stringify({tag_name: state.feedCalls++ < staleFeed ? 'v1.1.0' : apiLatest, draft: false, prerelease: false, body: 'n', published_at: '2026-11-23T00:00:00Z', assets}));
      }
      if (args[0] === 'run') return ok('[]');
      if (args[0] === 'workflow') return ok();
    }
    if (command === 'bash' && args[0] === '-c') return ok();
    if (command === 'sh') return scan === 0 ? ok('public-scan: RESULT: clean') : {status: scan, stdout: scanOutput, stderr: ''};
    if (command === 'npm') return ok();
    if (command === 'node') return ok();
    if (command.endsWith('ditto') && args[0] === '-x') { fs.mkdirSync(path.join(args.at(-1), 'NoteMind.app/Contents'), {recursive: true}); return ok(); }
    if (command.endsWith('ditto')) { fs.mkdirSync(path.join(args[1], 'Contents'), {recursive: true}); return ok(); }
    if (command.endsWith('security')) return ok('  1) AA "Developer ID Application: Example Dev (TEAMID0000)"\n');
    if (command.endsWith('PlistBuddy')) return ok(version + '\n');
    if (command.endsWith('lipo')) return ok('arm64\n');
    if (command.endsWith('pgrep')) return state.running ? ok('123\n') : fail();
    if (command.endsWith('osascript')) { state.running = false; return ok(); }
    return ok();
  };
  const spawn = (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (command.endsWith('spctl')) return {status: spctl.includes('Notarized') ? 0 : 3, stdout: '', stderr: spctl};
    return {status: 0, stdout: '', stderr: `Authority=Developer ID Application: Example Dev (TEAMID0000)\nTeamIdentifier=${args.includes('--verbose=2') ? installedTeam : 'TEAMID0000'}\nflags=0x10000(runtime)\n`};
  };
  const packageRelease = () => {
    calls.push(['packageRelease']);
    fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
    const out = {};
    for (const [name, data] of Object.entries(local)) fs.writeFileSync(path.join(root, 'dist', name), data);
    fs.writeFileSync(path.join(root, 'dist', file.sums), Object.entries(local).map(([name, data]) => `${sha(data)}  ${name}`).join('\n') + '\n');
    Object.assign(out, {zip: path.join(root, 'dist', file.zip), dmg: path.join(root, 'dist', file.dmg), sums: path.join(root, 'dist', file.sums), hashes: Object.fromEntries(Object.entries(local).map(([name, data]) => [name, sha(data)]))});
    return out;
  };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-lane-home-'));
  const installDestination = path.join(home, 'NoteMind.app');
  fs.mkdirSync(path.join(installDestination, 'Contents'), {recursive: true});
  fs.writeFileSync(path.join(installDestination, 'old'), 'old');
  fs.mkdirSync(path.join(root, 'docs'));
  if (baseline) fs.writeFileSync(path.join(root, 'docs', 'public-scan-baseline.json'), JSON.stringify(baseline));
  const env = {NOTEMIND_PUBLIC_SCAN: __filename, NOTEMIND_MINDSUITE_RELEASE: __filename, NOTEMIND_HEAVY_LOCK_SCRIPT: __filename, NOTEMIND_CODESIGN_IDENTITY: 'Developer ID Application: Example Dev (TEAMID0000)', ...extraEnv};
  const run = (extra = {}) => release({root, sh, spawn, packageRelease, env, log: message => logs.push(message), options: {installDestination, ...options, ...extra}, platform: 'darwin', arch: 'arm64', now: () => state.clock, sleep: async ms => { state.clock += ms; }});
  return {root, calls, logs, state, run, installDestination, win, file};
}
const at = (calls, ...needle) => calls.findIndex(call => needle.every(part => call.some(value => String(value).includes(part))));
const names2 = calls => calls.map(call => call.slice(0, 2).join(' '));

test('the lane builds, notarizes, tags, scans, pushes, drafts, waits for Windows, verifies the draft, publishes, checks the feed, records and installs in that order', async () => {
  const h = lane();
  const result = await h.run();
  assert.equal(result.tag, TAG);
  const order = [
    at(h.calls, 'bash', '-c', 'heavy_lock'), at(h.calls, 'packageRelease'), at(h.calls, 'git', 'tag', '-a'), at(h.calls, 'sh', '--expect-ref'),
    at(h.calls, 'git', 'push', 'main'), at(h.calls, 'git', 'push', TAG), at(h.calls, 'gh', 'release', 'create'), at(h.calls, 'gh', 'release', 'download'),
    at(h.calls, 'gh', 'release', 'edit'), at(h.calls, 'gh', 'api', 'releases/latest'), at(h.calls, 'node', 'record', 'NoteMind', TAG), at(h.calls, 'osascript') >= 0 ? at(h.calls, 'osascript') : at(h.calls, 'ditto', '.installing'),
  ];
  assert.ok(order.every(index => index >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'steps happen in order');
  const create = h.calls[at(h.calls, 'gh', 'release', 'create')];
  assert.ok(create.includes('--draft') && create.includes('--verify-tag'));
  assert.ok(create.some(value => value.endsWith('mac-arm64.zip')) && create.some(value => value.endsWith('mac-arm64.dmg')) && create.some(value => value.endsWith('SHA256SUMS.txt')));
  assert.ok(h.calls[at(h.calls, 'gh', 'release', 'edit')].includes('--latest'));
  assert.ok(fs.existsSync(path.join(h.installDestination, 'Contents')) && !fs.existsSync(path.join(h.installDestination, 'old')), 'the verified app replaced the old one');
  assert.ok(!fs.existsSync(h.installDestination + '.previous'));
});

test('nothing is built when the tree, branch, version or tag is not releasable', async () => {
  for (const [options, pattern] of [
    [{branch: 'feature'}, /Release from main/], [{dirty: ' M src/main.cjs\n'}, /uncommitted/], [{behind: true}, /behind or has diverged/],
    [{tagExists: true}, /already exists as a tag/], [{releaseExists: true}, /already has a release/], [{latestTag: 'v1.2.0'}, /not newer than the latest release/],
    [{latestTag: 'v1.3.0'}, /not newer than the latest release/], [{lockVersion: '1.1.0'}, /package-lock\.json says 1\.1\.0/], [{version: '1.2'}, /not a release version/],
  ]) {
    const h = lane(options);
    await assert.rejects(h.run(), pattern);
    assert.ok(!h.calls.some(call => call[0] === 'bash' || call[0] === 'npm' || call[0] === 'packageRelease'), JSON.stringify(options));
    assert.ok(!h.calls.some(call => call[0] === 'git' && call[1] === 'push'));
  }
});

test('only an Apple Silicon Mac releases', async () => {
  const h = lane();
  await assert.rejects(release({root: h.root, sh: () => ({status: 0, stdout: ''}), platform: 'darwin', arch: 'x64'}), /Apple Silicon/);
});

test('a flagged public scan removes the local tag and pushes nothing', async () => {
  const h = lane({scan: 1});
  await assert.rejects(h.run(), /public scan blocks the push[\s\S]*literals: 300 hits, baseline 123/);
  assert.ok(!h.state.tags.has(TAG));
  assert.ok(!h.calls.some(call => call[0] === 'git' && call[1] === 'push'));
  const missing = lane();
  const env = {NOTEMIND_PUBLIC_SCAN: '/nonexistent/scan.sh', NOTEMIND_CODESIGN_IDENTITY: 'Developer ID Application: Example Dev (TEAMID0000)'};
  await assert.rejects(release({root: missing.root, sh: (c, a, o) => c === 'bash' && a[0] === '-c' ? {status: 0, stdout: ''} : c === 'git' && a[0] === 'rev-parse' && a[1] === '--abbrev-ref' ? {status: 0, stdout: 'main\n'} : c === 'git' && a[0] === 'rev-parse' ? {status: 1, stdout: ''} : c === 'gh' && a[0] === 'api' ? {status: 0, stdout: ''} : c === 'gh' && a[1] === 'view' ? {status: 0, stdout: 'v1.1.0\n'} : {status: 0, stdout: ''}, packageRelease: () => ({zip: 'z', dmg: 'd', sums: 's', hashes: {}}), env, log() {}, platform: 'darwin', arch: 'arm64', spawn: () => ({}), options: {}}), /public-scan\.sh was not found/);
});

test('the release stays a draft when the Windows installer never arrives, and says how to retry', async () => {
  const h = lane({windows: 'never', options: {waitMinutes: 10}});
  await assert.rejects(h.run(), error => error instanceof ReleaseError && error.code === 2 && /--resume/.test(error.message) && /windows-release\.yml/.test(error.message) && /latest\.yml/.test(error.message));
  assert.ok(!h.calls.some(call => call[0] === 'gh' && call[1] === 'release' && call[2] === 'edit'), 'never published');
  assert.equal(h.calls.filter(call => call[0] === 'gh' && call[1] === 'workflow').length, 1, 'the workflow is dispatched once when no run exists');
  assert.ok(!h.calls.some(call => call[0] === 'node' && call.includes('record')));
});

test('a Windows installer that arrives late is waited for, not skipped', async () => {
  const h = lane({windows: 'late'});
  await h.run();
  assert.ok(h.state.clock >= 90 * 1000);
  assert.ok(at(h.calls, 'gh', 'release', 'edit') > at(h.calls, 'gh', 'api'));
});

test('--mac-only publishes without Windows files and does not check for them', async () => {
  const h = lane({windows: 'never', options: {macOnly: true}});
  const result = await h.run();
  assert.ok(!result.assets.includes(h.win.installer));
  assert.ok(h.calls.some(call => call[0] === 'gh' && call[2] === 'edit'));
});

test('a file that differs from what was notarized is caught on the draft: nothing is published and MindSuite is not told', async () => {
  for (const [options, pattern] of [
    [{publishedZip: Buffer.from('tampered')}, /differs from the file that was notarized/],
    [{sums: `${'0'.repeat(64)}  NoteMind-1.2.0-mac-arm64.zip\n`}, /does not list/],
    [{spctl: 'source=Developer ID'}, /Gatekeeper does not accept the release's/],
    [{feed: 'version: 1.2.0\nfiles:\n  - url: NoteMind-1.2.0-win-x64-setup.exe\n    sha512: AAAA\n'}, /latest\.yml does not describe/],
  ]) {
    const h = lane(options);
    await assert.rejects(h.run(), pattern);
    assert.ok(!h.calls.some(call => call[0] === 'gh' && call[1] === 'release' && call[2] === 'edit'), 'a bad draft is never published: ' + JSON.stringify(Object.keys(options)));
    assert.ok(h.state.draft.draft, 'still a draft');
    assert.ok(!h.calls.some(call => call[0] === 'node' && call.includes('record')), JSON.stringify(Object.keys(options)));
    assert.ok(fs.existsSync(path.join(h.installDestination, 'old')), 'the installed app is untouched');
  }
});

test('GitHub\'s latest-release feed is asked again after publishing, and a feed that never catches up leaves the way forward in the message', async () => {
  const slow = lane({staleFeed: 3});
  await slow.run();
  assert.equal(slow.calls.filter(call => call[0] === 'gh' && call[1] === 'api' && call[2].endsWith('/releases/latest')).length, 4, 'three stale answers, then the right one');
  assert.ok(slow.calls.some(call => call[0] === 'node' && call.includes('record')));
  const stuck = lane({apiLatest: 'v1.1.0', options: {feedAttempts: 3}});
  await assert.rejects(stuck.run(), error => error instanceof ReleaseError && /latest release is v1\.1\.0, not v1\.2\.0/.test(error.message) && /is published/.test(error.message) && /--resume/.test(error.message));
  assert.ok(stuck.calls.some(call => call[0] === 'gh' && call[2] === 'edit'), 'it was published, as the message says');
  assert.ok(!stuck.calls.some(call => call[0] === 'node' && call.includes('record')));
});

test('a release is signed with the named identity only, and never with another team than the installed app', async () => {
  const unnamed = lane({env: {NOTEMIND_CODESIGN_IDENTITY: ''}});
  await assert.rejects(unnamed.run(), /full name of one Developer ID Application identity/);
  assert.ok(!unnamed.calls.some(call => call[0] === 'bash' || call[0] === 'packageRelease' || call[0] === 'security'), 'nothing built, no keychain search');
  const other = lane({installedTeam: 'OLDTEAM001'});
  await assert.rejects(other.run(), /installed NoteMind is signed by team OLDTEAM001[\s\S]*--allow-team-change/);
  assert.ok(!other.calls.some(call => call[0] === 'bash' || call[0] === 'packageRelease'));
  const allowed = lane({installedTeam: 'OLDTEAM001', options: {allowTeamChange: true}});
  await allowed.run();
  assert.ok(allowed.calls.some(call => call[0] === 'packageRelease'));
});

test('a failed push or a failed draft upload keeps the tag and the notarized files, and --resume completes the release', async () => {
  for (const [options, pattern] of [[{pushFails: 'main'}, /git push origin main failed[\s\S]*--resume/], [{pushFails: TAG}, /git push origin v1\.2\.0 failed[\s\S]*--resume/], [{createFails: true}, /gh release create[\s\S]*--resume/]]) {
    const h = lane(options);
    await assert.rejects(h.run(), pattern);
    assert.ok(h.state.tags.has(TAG), 'the local tag stays: ' + JSON.stringify(options));
    assert.ok(fs.existsSync(path.join(h.root, 'dist', h.file.zip)) && fs.existsSync(path.join(h.root, 'dist', h.file.sums)));
    assert.ok(!h.calls.some(call => call[0] === 'gh' && call[2] === 'edit'));
    // The same lane object stands for the same repository: the failure was a one-off, and a plain rerun is refused with the way forward.
    await assert.rejects(h.run(), /already exists as a tag[\s\S]*--resume/);
    const built = h.calls.filter(call => call[0] === 'packageRelease').length;
    const result = await h.run({resume: true});
    assert.equal(result.tag, TAG);
    assert.equal(h.calls.filter(call => call[0] === 'packageRelease').length, built, 'nothing is rebuilt or notarized again');
    assert.ok(h.state.remoteTags.has(TAG) && h.state.pushed.includes('main'), 'main and the tag reach origin');
    assert.ok(h.state.draft && h.state.draft.draft === false, 'draft created from dist, verified, published');
    assert.ok(at(h.calls, 'gh', 'release', 'download') < at(h.calls, 'gh', 'release', 'edit'));
  }
});

function leaveNotarizedFiles(h) {
  const bytes = {[h.file.zip]: 'zip bytes', [h.file.dmg]: 'dmg bytes'};
  fs.mkdirSync(path.join(h.root, 'dist'), {recursive: true});
  for (const [name, data] of Object.entries(bytes)) fs.writeFileSync(path.join(h.root, 'dist', name), data);
  fs.writeFileSync(path.join(h.root, 'dist', h.file.sums), Object.entries(bytes).map(([name, data]) => `${sha(Buffer.from(data))}  ${name}`).join('\n') + '\n');
}

test('--resume tops up a draft that lost files, and will not push main from a commit the tag does not name', async () => {
  const partial = lane();
  partial.state.tags.add(TAG); partial.state.remoteTags.add(TAG);
  partial.state.draft = {draft: true, assets: [partial.file.zip]};
  leaveNotarizedFiles(partial);
  await partial.run({resume: true});
  const upload = partial.calls.find(call => call[0] === 'gh' && call[1] === 'release' && call[2] === 'upload');
  assert.ok(upload && upload.some(value => value.endsWith('.dmg')) && upload.some(value => value.endsWith('SHA256SUMS.txt')) && !upload.some(value => value.endsWith('.zip')), 'only the missing files are uploaded');
  assert.ok(!partial.calls.some(call => call[0] === 'git' && call[1] === 'push'), 'the tag is already on origin');

  const moved = lane({headMoved: true});
  moved.state.tags.add(TAG);
  leaveNotarizedFiles(moved);
  await assert.rejects(moved.run({resume: true}), /main has moved on from v1\.2\.0/);
  assert.ok(!moved.calls.some(call => call[0] === 'git' && call[1] === 'push') && !moved.calls.some(call => call[0] === 'gh' && call[1] === 'release' && call[2] === 'create'));
});

test('--resume on a release that is already published checks, records and installs it without publishing again', async () => {
  const done = lane({apiLatest: TAG});
  done.state.tags.add(TAG); done.state.remoteTags.add(TAG);
  done.state.draft = {draft: false, assets: [done.file.zip, done.file.dmg, done.file.sums]};
  leaveNotarizedFiles(done);
  const result = await done.run({resume: true});
  assert.equal(result.tag, TAG);
  assert.ok(!done.calls.some(call => call[0] === 'gh' && call[1] === 'release' && (call[2] === 'edit' || call[2] === 'create')), 'not published or created again');
  assert.ok(done.calls.some(call => call[0] === 'node' && call.includes('record')));
  assert.ok(!fs.existsSync(path.join(done.installDestination, 'old')), 'installed');
  assert.ok(!done.calls.some(call => call[0] === 'gh' && call[1] === 'run' || call[0] === 'gh' && call[1] === 'workflow'), 'no wait for Windows once it is public');
});

test('installing quits a running NoteMind first, and rolls the old app back when the new one fails verification', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-install-'));
  const destination = path.join(home, 'NoteMind.app');
  const app = path.join(home, 'new', 'NoteMind.app');
  fs.mkdirSync(path.join(destination, 'Contents'), {recursive: true});
  fs.writeFileSync(path.join(destination, 'old'), 'old');
  fs.mkdirSync(path.join(app, 'Contents'), {recursive: true});
  fs.writeFileSync(path.join(app, 'new'), 'new');
  const calls = [];
  let running = true;
  const shFor = (stapled = true) => (command, args) => {
    calls.push(path.basename(command));
    if (command.endsWith('pgrep')) return {status: running ? 0 : 1, stdout: ''};
    if (command.endsWith('osascript')) { running = false; return {status: 0, stdout: ''}; }
    if (command.endsWith('ditto')) { fs.cpSync(args[0], args[1], {recursive: true}); return {status: 0, stdout: ''}; }
    if (command.endsWith('stapler')) return {status: 0, stdout: ''};
    if (command.endsWith('xcrun')) return {status: stapled ? 0 : 1, stdout: ''};
    if (command.endsWith('PlistBuddy')) return {status: 0, stdout: VERSION + '\n'};
    return {status: 0, stdout: ''};
  };
  const goodSpawn = command => command.endsWith('spctl') ? {status: 0, stderr: NOTARIZED} : {status: 0, stderr: 'Authority=Developer ID Application: Example Dev (TEAMID0000)\nTeamIdentifier=TEAMID0000\nflags=0x10000(runtime)\n'};
  const badSpawn = command => command.endsWith('spctl') ? {status: 3, stderr: 'rejected'} : goodSpawn(command);
  assert.throws(() => installApp({sh: shFor(), app, version: VERSION, team: 'TEAMID0000', spawn: badSpawn, destination, log() {}, sleep() {}}), /rolled back/);
  assert.equal(fs.readFileSync(path.join(destination, 'old'), 'utf8'), 'old');
  assert.ok(calls.includes('osascript'), 'asked the running app to quit');
  assert.ok(!fs.existsSync(destination + '.installing') || true);
  running = false;
  assert.throws(() => installApp({sh: shFor(false), app, version: VERSION, team: 'TEAMID0000', spawn: goodSpawn, destination, log() {}, sleep() {}}), /no stapled ticket/);
  assert.equal(fs.readFileSync(path.join(destination, 'old'), 'utf8'), 'old');
  installApp({sh: shFor(), app, version: VERSION, team: 'TEAMID0000', spawn: goodSpawn, destination, log() {}, sleep() {}});
  assert.equal(fs.readFileSync(path.join(destination, 'new'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(path.join(destination, 'old')));
  assert.ok(!fs.existsSync(destination + '.previous'));
});

test('a NoteMind that will not quit blocks the install without touching the app', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-install-stuck-'));
  const destination = path.join(home, 'NoteMind.app');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'old'), 'old');
  const sh = command => command.endsWith('pgrep') ? {status: 0, stdout: '1'} : {status: 0, stdout: ''};
  assert.throws(() => installApp({sh, app: '/x', version: VERSION, spawn: () => ({}), destination, log() {}, sleep() {}}), error => error.code === 4 && /did not quit/.test(error.message));
  assert.equal(fs.readFileSync(path.join(destination, 'old'), 'utf8'), 'old');
});

test('the public scan gate compares the tree classes with the accepted baseline, never with zero, and never passes a scan that could not run', async () => {
  const {parseScan, scanProblems} = require('../scripts/release.cjs');
  assert.deepEqual(parseScan('x\npublic-scan: RESULT: hits in 3 class(es): history=4174, literals=123, tree=50\n'), {history: 4174, literals: 123, tree: 50});
  assert.deepEqual(parseScan('public-scan: RESULT: clean'), {});
  const baseline = {tree: 50, literals: 123, personal: 1};
  const output = 'public-scan: RESULT: hits in 4 class(es): history=9999, literals=123, personal=1, tree=50';
  assert.deepEqual(scanProblems({status: 1, output, baseline}), [], 'the accepted hits (and any history) pass');
  assert.deepEqual(scanProblems({status: 0, output: 'RESULT: clean', baseline: null}), []);
  assert.match(scanProblems({status: 1, output: output.replace('tree=50', 'tree=51'), baseline})[0], /tree: 51 hits, baseline 50/);
  assert.match(scanProblems({status: 1, output, baseline: null})[0], /public-scan-baseline\.json is missing/);
  assert.match(scanProblems({status: 2, output: '', baseline})[0], /could not run/);
  assert.match(scanProblems({status: 1, output: 'no result line', baseline})[0], /without a result/);
  const ok = lane({scan: 1, scanOutput: output});
  await ok.run();
  assert.ok(ok.calls.some(call => call[0] === 'git' && call[1] === 'push' && call[3] === 'main'));
  const missing = lane({scan: 1, scanOutput: output, baseline: null});
  await assert.rejects(missing.run(), /baseline\.json is missing/);
  assert.ok(!missing.state.tags.has(TAG));
});
