#!/usr/bin/env node
// NoteMind's release lane (`npm run release`): the dtp for this repository. From a clean, pushed-or-pushable main it
//   1. checks the version, the tree and the tag are releasable (never a downgrade, never an existing tag or release),
//   2. builds the signed app under the shared heavy-build lock and notarizes, staples and packages it (package-update.cjs),
//   3. tags, scans the public tree, pushes main and the tag (the tag push starts the Windows installer workflow),
//   4. creates a DRAFT release with the Mac zip, dmg and checksums,
//   5. waits for the Windows installer, its blockmap and latest.yml (windows-release.yml uploads them), publishes,
//   6. downloads every published file again and verifies it as a user or the updater would see it,
//   7. records the tag in MindSuite, and
//   8. installs the verified app into /Applications.
// `--mac-only` publishes without waiting for the Windows files (the release then has no Windows update feed).
// `--resume` continues from step 5 for a tag and draft that exist (after a Windows build failed), using the notarized files in dist.
// `--no-install` stops after the record step. Nothing here runs in a test: every external command goes through `sh`.
'use strict';
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { names } = require('./mac-release.cjs');
const { resolveIdentity, teamOf } = require('./mac-signing.cjs');
const { pickUpdate, compareVersions, parseVersion } = require('../src/updater.cjs');

const REPO = 'chere005/NoteMind';
const WINDOWS_WORKFLOW = 'windows-release.yml';
const winNames = version => ({ installer: `NoteMind-${version}-win-x64-setup.exe`, blockmap: `NoteMind-${version}-win-x64-setup.exe.blockmap`, feed: 'latest.yml' });
/** The release for a tag, drafts included (gh release view cannot see a draft by tag): { draft, assets: [names] } or null. */
function findRelease({ sh, root, repo, tag }) {
  const listed = sh('gh', ['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--jq', `.[] | select(.tag_name == "${tag}") | {draft, assets: [.assets[].name]}`], { cwd: root }).stdout;
  const found = listed.split('\n').filter(Boolean).map(line => JSON.parse(line));
  return found.length ? found[0] : null;
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

class ReleaseError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

function defaultSh(command, args, { cwd, allowFail = false, input } = {}) {
  const result = cp.spawnSync(command, args, { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) throw new ReleaseError(`${path.basename(command)} ${args.slice(0, 3).join(' ')} failed (${result.status}): ${String(result.stderr || result.stdout).trim().slice(0, 2000)}`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const releaseNotes = (version, tag, subject) => `${subject || `NoteMind ${version}`}

## Installing

- **macOS** (Apple Silicon): open \`NoteMind-${version}-mac-arm64.dmg\` and drag NoteMind to Applications. The app is signed with a Developer ID and notarized by Apple. Installed copies update themselves.
- **Windows** (x64): run \`NoteMind-${version}-win-x64-setup.exe\`. The installer is not code-signed, so SmartScreen may say "Windows protected your PC": choose More info, then Run anyway. Installed copies update themselves.

\`NoteMind-${version}-mac-SHA256SUMS.txt\` lists the checksum of each Mac file.
`;

/** The classes of a public-scan RESULT line as counts; a clean scan has none. */
function parseScan(output) {
  const counts = {};
  const line = /RESULT: hits in \d+ class\(es\): (.*)$/m.exec(output);
  if (line) for (const part of line[1].split(', ')) { const [name, count] = part.split('='); counts[name] = Number(count); }
  return counts;
}

/**
 * Why a scan should stop the push. The repository's history carries hits that were accepted when it was published (the owner's
 * name, the owner/by literals), so the tree classes are compared with docs/public-scan-baseline.json instead of with zero.
 * Exit 2 means the scan could not run, which is never a pass.
 */
const SCAN_BASELINE_CLASSES = ['tree', 'literals', 'personal'];
function scanProblems({ status, output, baseline }) {
  if (status === 2 || status === null) return ['the public scan could not run (exit ' + status + ')'];
  const counts = parseScan(output);
  if (status !== 0 && !/RESULT:/.test(output)) return [`the public scan failed without a result (exit ${status})`];
  if (status === 0) return [];
  if (!baseline) return ['docs/public-scan-baseline.json is missing; record the accepted tree, literals and personal counts after reviewing a scan'];
  return SCAN_BASELINE_CLASSES.filter(name => (counts[name] || 0) > (baseline[name] ?? 0)).map(name => `${name}: ${counts[name]} hits, baseline ${baseline[name] ?? 0}`);
}

/** The shared heavy-build lock script, found beside the MindSuite checkouts (the lock itself is one fixed path per user). */
function heavyLockScript(root, exists = fs.existsSync, env = process.env) {
  const base = path.resolve(root, '..');
  if (env.NOTEMIND_HEAVY_LOCK_SCRIPT) return exists(env.NOTEMIND_HEAVY_LOCK_SCRIPT) ? env.NOTEMIND_HEAVY_LOCK_SCRIPT : null;
  return [
    path.join(base, 'MindSuite/CalMind/tools/heavy-lock.sh'),
    path.join(base, 'DisplayMind/tools/heavy-lock.sh'),
    path.join(os.homedir(), 'GIT/MindSuite/CalMind/tools/heavy-lock.sh'),
    path.join(os.homedir(), 'GIT/DisplayMind/tools/heavy-lock.sh'),
  ].find(file => file && exists(file)) || null;
}

function release({ root, sh = defaultSh, log = console.log, options = {}, env = process.env, fileSystem = fs, packageRelease = require('./mac-release.cjs').packageRelease, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, spawn = cp.spawnSync, platform = process.platform, arch = process.arch } = {}) {
  /** A MindSuite tool: the environment's path when given (and only that), else the sibling or home checkout. */
  const tool = (variable, relative) => {
    if (env[variable]) return fileSystem.existsSync(env[variable]) ? env[variable] : null;
    return [path.resolve(root, '../MindSuite', relative), path.join(os.homedir(), 'GIT/MindSuite', relative)].find(candidate => fileSystem.existsSync(candidate)) || null;
  };
  const run = async () => {
    const pkg = JSON.parse(fileSystem.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = pkg.version;
    const tag = `v${version}`;
    const file = names(version);
    const win = winNames(version);
    const git = (...args) => sh('git', args, { cwd: root });
    const gh = (...args) => sh('gh', args, { cwd: root });
    const step = message => log(`==> ${message}`);
    if (platform !== 'darwin' || arch !== 'arm64') throw new ReleaseError('The release lane runs on an Apple Silicon Mac.');
    if (!parseVersion(version)) throw new ReleaseError(`${version} is not a release version.`);

    step('Checking that this can be released');
    const lock = JSON.parse(fileSystem.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    if (lock.version !== version || lock.packages?.['']?.version !== version) throw new ReleaseError(`package.json says ${version} but package-lock.json says ${lock.version}.`);
    if (git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() !== 'main') throw new ReleaseError('Release from main.');
    if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) throw new ReleaseError('The working tree has uncommitted changes to tracked files.');
    git('fetch', 'origin', 'main', '--tags');
    if (sh('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: root, allowFail: true }).status !== 0) throw new ReleaseError('main is behind or has diverged from origin/main; bring it up to date first.');
    if (sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: root, allowFail: true }).status === 0) throw new ReleaseError(`${tag} already exists as a tag; a released version is never rebuilt.`);
    if (findRelease({ sh, root, repo: REPO, tag })) throw new ReleaseError(`${tag} already has a release.`);
    gh('auth', 'status');
    const latest = sh('gh', ['release', 'view', '--repo', REPO, '--json', 'tagName', '--jq', '.tagName'], { cwd: root, allowFail: true });
    const previous = latest.status === 0 ? latest.stdout.trim() : '';
    if (previous) {
      const order = compareVersions(version, previous);
      if (order === null || order <= 0) throw new ReleaseError(`${version} is not newer than the latest release ${previous}; the updater would never offer it.`);
    }

    step('Building the signed app');
    const lockScript = heavyLockScript(root, fileSystem.existsSync, env);
    if (!lockScript) log('warning: no heavy-build lock script found; building without the lock');
    const build = lockScript
      ? sh('bash', ['-c', '. "$1" && heavy_lock "NoteMind release build" && npm run build', 'lane', lockScript], { cwd: root })
      : sh('npm', ['run', 'build'], { cwd: root });
    if (build.status !== 0) throw new ReleaseError('npm run build failed.');

    step('Notarizing, stapling and packaging');
    const made = packageRelease({ root, version, env, log });

    step(`Tagging ${tag} and scanning the public tree`);
    const subject = git('log', '-1', '--format=%s').stdout.trim();
    git('tag', '-a', tag, '-m', subject || `NoteMind ${version}`);
    const scan = tool('NOTEMIND_PUBLIC_SCAN', 'tools/publish/public-scan.sh');
    if (!scan) { git('tag', '-d', tag); throw new ReleaseError('MindSuite tools/publish/public-scan.sh was not found; nothing is pushed without the public scan.'); }
    const identity = git('log', '-1', '--format=%an <%ae>').stdout.trim();
    const scanned = sh('sh', [scan, '--from', root, '--expect-ref', 'refs/heads/main', '--expect-ref', 'refs/tags/*', '--allow-identity', `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`], { cwd: root, allowFail: true });
    const baselineFile = path.join(root, 'docs', 'public-scan-baseline.json');
    const problems = scanProblems({ status: scanned.status, output: `${scanned.stdout}\n${scanned.stderr}`, baseline: fileSystem.existsSync(baselineFile) ? JSON.parse(fileSystem.readFileSync(baselineFile, 'utf8')) : null });
    if (problems.length) { git('tag', '-d', tag); throw new ReleaseError(`The public scan blocks the push (nothing pushed, tag removed):\n  ${problems.join('\n  ')}`.slice(0, 4000)); }

    step('Pushing main and the tag');
    git('push', 'origin', 'main');
    git('push', 'origin', tag);

    step('Creating the draft release');
    const notes = path.join(fileSystem.mkdtempSync(path.join(os.tmpdir(), 'notemind-notes-')), 'notes.md');
    fileSystem.writeFileSync(notes, releaseNotes(version, tag, subject));
    gh('release', 'create', tag, '--repo', REPO, '--draft', '--verify-tag', '--title', `NoteMind ${version}`, '--notes-file', notes, made.zip, made.dmg, made.sums);

    return await finish({ made, subject });
  };

  /** Everything after the draft exists: wait for Windows, publish, verify the published files, record, install. */
  const finish = async ({ made }) => {
    const pkg = JSON.parse(fileSystem.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = pkg.version, tag = `v${version}`, win = winNames(version);
    const gh = (...args) => sh('gh', args, { cwd: root });
    const step = message => log(`==> ${message}`);
    const assetNames = () => (findRelease({ sh, root, repo: REPO, tag })?.assets || []);
    const latest = sh('gh', ['release', 'view', '--repo', REPO, '--json', 'tagName', '--jq', '.tagName'], { cwd: root, allowFail: true });
    const previous = latest.status === 0 && latest.stdout.trim() !== tag ? latest.stdout.trim() : '';
    if (!options.macOnly) {
      step('Waiting for the Windows installer');
      const needed = [win.installer, win.blockmap, win.feed];
      const deadline = now() + (options.waitMinutes ?? 45) * 60 * 1000;
      let dispatched = false;
      const started = now();
      for (;;) {
        const have = assetNames();
        if (needed.every(name => have.includes(name))) break;
        if (!dispatched && now() - started > 3 * 60 * 1000) {
          const runs = sh('gh', ['run', 'list', '--repo', REPO, '--workflow', WINDOWS_WORKFLOW, '--limit', '10', '--json', 'headBranch'], { cwd: root, allowFail: true });
          const known = runs.status === 0 && JSON.parse(runs.stdout || '[]').some(item => item.headBranch === tag);
          if (!known) sh('gh', ['workflow', 'run', WINDOWS_WORKFLOW, '--repo', REPO, '--ref', tag, '-f', `tag=${tag}`], { cwd: root });
          dispatched = true;
        }
        if (now() > deadline) throw new ReleaseError(`The Windows files (${needed.filter(name => !have.includes(name)).join(', ')}) are not on the draft ${tag}. The draft stays unpublished. Retry the build with: gh workflow run ${WINDOWS_WORKFLOW} --repo ${REPO} --ref ${tag} -f tag=${tag}; then run this lane again with --resume (or --resume --mac-only to publish without Windows).`, 2);
        await sleep(30 * 1000);
      }
    } else log('--mac-only: publishing without the Windows installer');

    step('Publishing');
    gh('release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest');

    step('Downloading the published files again and verifying them');
    const scratch = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'notemind-verify-'));
    const downloaded = verifyPublished({ sh, root, repo: REPO, tag, version, scratch, localHashes: made.hashes, macOnly: !!options.macOnly, previous, spawn, fileSystem });
    log(`verified ${downloaded.checked.join(', ')}`);

    step('Recording the release in MindSuite');
    const recorder = tool('NOTEMIND_MINDSUITE_RELEASE', 'tools/mindsuite-release.mjs');
    if (!recorder) throw new ReleaseError('MindSuite tools/mindsuite-release.mjs was not found; the release is published but not recorded.', 3);
    sh('node', [recorder, 'record', 'NoteMind', tag, '--app-repo', root], { cwd: root });

    if (!options.noInstall) {
      step('Installing into /Applications');
      installApp({ sh, app: downloaded.app, version, spawn, fileSystem, log, team: teamOf(resolveIdentity({ env, execFileSync: (command, args) => sh(command, args).stdout, warn() {} })), ...(options.installDestination ? { destination: options.installDestination } : {}) });
    }
    return { tag, version, assets: downloaded.checked };
  };

  /** --resume: the tag and the draft exist; the files are the ones in dist, which must still match the checksums written when they were notarized. */
  const resume = async () => {
    const pkg = JSON.parse(fileSystem.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = pkg.version, tag = `v${version}`, file = names(version);
    log(`==> Resuming ${tag}`);
    if (sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: root, allowFail: true }).status !== 0) throw new ReleaseError(`${tag} does not exist; nothing to resume.`);
    const found = findRelease({ sh, root, repo: REPO, tag });
    if (!found) throw new ReleaseError(`${tag} has no release to resume.`);
    if (!found.draft) throw new ReleaseError(`${tag} is already published.`);
    const dist = name => path.join(root, 'dist', name);
    const hashes = {};
    for (const name of [file.zip, file.dmg]) {
      const line = fileSystem.readFileSync(dist(file.sums), 'utf8').split('\n').find(entry => entry.endsWith(`  ${name}`));
      hashes[name] = line?.slice(0, 64);
      if (!hashes[name] || sha256(dist(name)) !== hashes[name]) throw new ReleaseError(`dist/${name} no longer matches ${file.sums}; build and notarize again.`);
    }
    return finish({ made: { zip: dist(file.zip), dmg: dist(file.dmg), sums: dist(file.sums), hashes } });
  };
  return options.resume ? resume() : run();
}

/** Fetch every published asset of the release and check it the way a user, the updater or Gatekeeper would. */
function verifyPublished({ sh, root, repo, tag, version, scratch, localHashes, macOnly, previous, spawn, fileSystem = fs }) {
  const file = names(version), win = winNames(version);
  const dir = path.join(scratch, 'download');
  fileSystem.mkdirSync(dir);
  sh('gh', ['release', 'download', tag, '--repo', repo, '--dir', dir, '--clobber'], { cwd: root });
  const checked = [];
  const need = name => { const p = path.join(dir, name); if (!fileSystem.existsSync(p)) throw new ReleaseError(`The published release has no ${name}.`); return p; };
  const verdict = (target, kind) => {
    const args = kind === 'dmg' ? ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', target] : ['--assess', '--type', 'execute', '-vv', target];
    const result = spawn('/usr/sbin/spctl', args, { encoding: 'utf8' });
    const said = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0 || !/source=Notarized Developer ID/.test(said)) throw new ReleaseError(`Gatekeeper does not accept the published ${path.basename(target)}: ${said.trim()}`);
  };

  const sums = fileSystem.readFileSync(need(file.sums), 'utf8');
  for (const name of [file.zip, file.dmg]) {
    const downloadedHash = sha256(need(name));
    if (downloadedHash !== localHashes[name]) throw new ReleaseError(`${name} as published differs from the file that was notarized.`);
    if (!sums.split('\n').some(line => line.startsWith(`${downloadedHash}  ${name}`))) throw new ReleaseError(`${file.sums} does not list ${name} with the published hash.`);
    checked.push(name);
  }

  // The zip: unpack it exactly as Squirrel would and judge the app.
  const unpacked = path.join(scratch, 'unpacked');
  fileSystem.mkdirSync(unpacked);
  sh('/usr/bin/ditto', ['-x', '-k', need(file.zip), unpacked]);
  const app = path.join(unpacked, 'NoteMind.app');
  sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  sh('/usr/bin/xcrun', ['stapler', 'validate', app]);
  verdict(app, 'app');
  const shown = String(sh('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')]).stdout).trim();
  if (shown !== version) throw new ReleaseError(`The published app is ${shown}, not ${version}.`);
  if (sh('/usr/bin/lipo', ['-archs', path.join(app, 'Contents/MacOS/NoteMind')]).stdout.trim() !== 'arm64') throw new ReleaseError('The published app is not arm64.');

  // The dmg: stapled, accepted by Gatekeeper, and intact.
  sh('/usr/bin/xcrun', ['stapler', 'validate', need(file.dmg)]);
  verdict(need(file.dmg), 'dmg');
  sh('/usr/bin/hdiutil', ['verify', need(file.dmg)]);

  // What the in-app updater will see: GitHub's own "latest release" document must offer this zip to the previous version.
  const doc = JSON.parse(sh('gh', ['api', `repos/${repo}/releases/latest`], { cwd: root }).stdout);
  if (doc.tag_name !== tag) throw new ReleaseError(`GitHub's latest release is ${doc.tag_name}, not ${tag}.`);
  const probe = previous ? previous.replace(/^v/, '') : '0.0.0';
  const offer = pickUpdate(doc, probe);
  if (!offer || offer.version !== version) throw new ReleaseError(`The updater would not offer ${version} to ${probe}.`);
  if (!offer.sumsUrl) throw new ReleaseError('The updater would see no checksum file for the update.');
  checked.push('updater feed');

  if (!macOnly) {
    const installer = need(win.installer);
    const header = Buffer.alloc(2);
    const fd = fileSystem.openSync(installer, 'r');
    fileSystem.readSync(fd, header, 0, 2, 0);
    fileSystem.closeSync(fd);
    if (header.toString('latin1') !== 'MZ') throw new ReleaseError('The published Windows installer is not a Windows executable.');
    need(win.blockmap);
    const feed = fileSystem.readFileSync(need(win.feed), 'utf8');
    const expected = /sha512: (\S+)/.exec(feed)?.[1];
    const actual = crypto.createHash('sha512').update(fileSystem.readFileSync(installer)).digest('base64');
    if (!feed.includes(`version: ${version}`) || !feed.includes(win.installer) || expected !== actual) throw new ReleaseError('latest.yml does not describe the published Windows installer.');
    checked.push(win.installer, win.feed);
  }
  return { checked, app };
}

/** Replace /Applications/NoteMind.app with the verified app: quit the running copy, stage beside, swap, verify, relaunch. */
function installApp({ sh, app, version, spawn, team, fileSystem = fs, log = console.log, destination = '/Applications/NoteMind.app', sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
  const running = () => sh('/usr/bin/pgrep', ['-f', `${destination}/Contents/MacOS/NoteMind`], { allowFail: true }).status === 0;
  const wasRunning = running();
  if (wasRunning) {
    sh('/usr/bin/osascript', ['-e', 'tell application id "com.seancheren.notemind" to quit'], { allowFail: true });
    for (let i = 0; i < 60 && running(); i++) sleep(1000);
    if (running()) throw new ReleaseError('NoteMind did not quit; the new version is published but not installed.', 4);
  }
  const staging = `${destination}.installing`, previous = `${destination}.previous`;
  fileSystem.rmSync(staging, { recursive: true, force: true });
  fileSystem.rmSync(previous, { recursive: true, force: true });
  sh('/usr/bin/ditto', [app, staging]);
  sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging]);
  if (fileSystem.existsSync(destination)) fileSystem.renameSync(destination, previous);
  try {
    fileSystem.renameSync(staging, destination);
  } catch (error) {
    if (fileSystem.existsSync(previous)) fileSystem.renameSync(previous, destination);
    throw error;
  }
  const result = spawn('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', destination], { encoding: 'utf8' });
  const said = `${result.stdout || ''}${result.stderr || ''}`;
  const details = `${spawn('/usr/bin/codesign', ['-dvv', destination], { encoding: 'utf8' }).stderr || ''}`;
  const problems = [];
  if (result.status !== 0 || !/source=Notarized Developer ID/.test(said)) problems.push(`Gatekeeper: ${said.trim()}`);
  if (!/^Authority=Developer ID Application:/m.test(details) || !new RegExp(`^TeamIdentifier=${team}$`, 'm').test(details) || !/flags=0x[0-9a-f]+\([^)]*runtime/.test(details)) problems.push('the installed signature is not the hardened Developer ID');
  if (sh('/usr/bin/xcrun', ['stapler', 'validate', destination], { allowFail: true }).status !== 0) problems.push('no stapled ticket');
  if (String(sh('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(destination, 'Contents/Info.plist')]).stdout).trim() !== version) problems.push('wrong version');
  if (problems.length) {
    // Put the previous app back rather than leave a broken one.
    fileSystem.rmSync(destination, { recursive: true, force: true });
    if (fileSystem.existsSync(previous)) fileSystem.renameSync(previous, destination);
    throw new ReleaseError(`The installed app failed verification and was rolled back: ${problems.join('; ')}`, 4);
  }
  fileSystem.rmSync(previous, { recursive: true, force: true });
  if (wasRunning) sh('/usr/bin/open', [destination], { allowFail: true });
  log(`installed ${destination} ${version}`);
}

async function main() {
  const flags = process.argv.slice(2);
  const options = { macOnly: flags.includes('--mac-only'), noInstall: flags.includes('--no-install'), resume: flags.includes('--resume') };
  try {
    await release({ root: path.resolve(__dirname, '..'), options });
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exit(error.code || 1);
  }
}

if (require.main === module) main();

module.exports = { parseScan, scanProblems, findRelease, release, verifyPublished, installApp, heavyLockScript, releaseNotes, ReleaseError, winNames };
