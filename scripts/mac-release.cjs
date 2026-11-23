'use strict';
// Notarize, staple and package the signed Mac app: the update zip the in-app updater downloads, a dmg for first installs,
// and a checksum file. Every external tool goes through `exec` so tests can stand in for codesign, notarytool and hdiutil.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditMacSignature, assertArm64, resolveIdentity, requireReleaseIdentity, teamOf } = require('./mac-signing.cjs');

/** The notarytool keychain profile every MindSuite app shares. */
const DEFAULT_PROFILE = 'DisplayMind';

const names = version => ({
  zip: `NoteMind-${version}-mac-arm64.zip`,
  dmg: `NoteMind-${version}-mac-arm64.dmg`,
  sums: `NoteMind-${version}-mac-SHA256SUMS.txt`,
});

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const text = value => (value == null ? '' : String(value));

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const STAPLE_TRIES = 5;
const STAPLE_BACKOFF_MS = 8 * 1000;

function makeTools({ exec = cp.execFileSync, env = process.env, log = console.log, sleep = pause } = {}) {
  const run = (command, args, options = {}) => exec(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const profile = env.NOTEMIND_NOTARY_PROFILE?.trim() || DEFAULT_PROFILE;
  const credentials = ['--keychain-profile', profile];

  /** The profile must exist and Apple must accept it before anything is built on it. */
  function checkCredentials() {
    try {
      run('/usr/bin/xcrun', ['notarytool', 'history', ...credentials, '--output-format', 'json']);
    } catch (error) {
      throw Error(`The notarytool keychain profile "${profile}" does not work: ${text(error.stderr || error.message).trim()}`);
    }
    return profile;
  }

  /** Submit a zip or dmg and wait. Anything but Accepted throws with Apple's log. */
  function notarize(file) {
    log(`Notarizing ${path.basename(file)} with profile ${profile}`);
    let result;
    try {
      result = JSON.parse(text(run('/usr/bin/xcrun', ['notarytool', 'submit', file, ...credentials, '--wait', '--timeout', '45m', '--output-format', 'json'])));
    } catch (error) {
      let parsed = null;
      try { parsed = JSON.parse(text(error.stdout)); } catch { /* not JSON */ }
      if (!parsed) throw Error(`notarytool failed for ${path.basename(file)}: ${text(error.stderr || error.message).trim()}`);
      result = parsed;
    }
    if (result.status !== 'Accepted') {
      let detail = '';
      try { detail = text(run('/usr/bin/xcrun', ['notarytool', 'log', result.id, ...credentials])); } catch (error) { detail = `(no log: ${error.message})`; }
      throw Error(`Apple did not accept ${path.basename(file)} (${result.status}, submission ${result.id}):\n${detail}`);
    }
    log(`Accepted (submission ${result.id})`);
    return result.id;
  }

  /**
   * A ticket Apple has just accepted is sometimes not fetchable for a few seconds ("Could not find base64 encoded ticket",
   * error 65), so stapling is retried with a pause before it counts as a failure.
   */
  const staple = file => {
    for (let attempt = 1; ; attempt++) {
      try {
        run('/usr/bin/xcrun', ['stapler', 'staple', file]);
        break;
      } catch (error) {
        if (attempt >= STAPLE_TRIES) throw Error(`stapler could not staple ${path.basename(file)} after ${attempt} tries: ${text(error.stderr || error.stdout || error.message).trim()}`);
        log(`The ticket for ${path.basename(file)} is not ready yet (try ${attempt} of ${STAPLE_TRIES}); waiting`);
        sleep(STAPLE_BACKOFF_MS * attempt);
      }
    }
    run('/usr/bin/xcrun', ['stapler', 'validate', file]);
  };

  /** Gatekeeper's verdict on an app or a dmg; only a notarized Developer ID passes. spctl writes it to stderr. */
  function assessVerdict(file, kind, spawn = cp.spawnSync) {
    const args = kind === 'dmg' ? ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', file] : ['--assess', '--type', 'execute', '-vv', file];
    const result = spawn('/usr/sbin/spctl', args, { encoding: 'utf8' });
    const said = `${text(result.stdout)}${text(result.stderr)}`;
    if (result.status !== 0 || !/source=Notarized Developer ID/.test(said)) throw Error(`Gatekeeper does not accept ${path.basename(file)} as a notarized Developer ID ${kind === 'dmg' ? 'disk image' : 'app'}: ${said.trim()}`);
    return said;
  }
  return { run, profile, checkCredentials, notarize, staple, assessVerdict };
}

/**
 * Build the release files in `dist` from the app `npm run build` left there.
 * Returns { zip, dmg, sums, hashes } (paths and sha256 by file name).
 */
function packageRelease({ root, version, exec = cp.execFileSync, env = process.env, log = console.log, spawn = cp.spawnSync, platform = process.platform, arch = process.arch, fileSystem = fs, notarize = true, sleep = pause } = {}) {
  if (platform !== 'darwin' || arch !== 'arm64') throw Error('The release files are made on an Apple Silicon Mac.');
  const tools = makeTools({ exec, env, log, sleep });
  const { run } = tools;
  const app = path.join(root, 'dist', 'NoteMind', 'NoteMind.app');
  const file = names(version);
  const out = name => path.join(root, 'dist', name);
  if (!fileSystem.existsSync(app)) throw Error(`${app} is missing; run npm run build first.`);

  const built = text(run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents', 'Info.plist')])).trim();
  if (built !== version) throw Error(`The built app is ${built || 'unreadable'} but package.json says ${version}; run npm run build.`);
  // A notarized release is signed with the identity the owner names in full; scratch runs (no notarization) may discover one.
  const { identity, team } = notarize ? requireReleaseIdentity(env) : (() => {
    const found = resolveIdentity({ env, execFileSync: exec, warn() {} });
    return { identity: found, team: teamOf(found) };
  })();
  if (identity === '-' || !team) throw Error('Releases are signed with a Developer ID Application identity; none is available (ad hoc and unnamed identities cannot be notarized).');

  log('Checking every signature in the app');
  assertArm64(app, { execFileSync: (...args) => run(...args), fileSystem });
  const audited = auditMacSignature(app, { spawn, execFileSync: (...args) => run(...args), fileSystem, team });
  log(`${audited} signatures are Developer ID, hardened and timestamped`);

  const scratch = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'notemind-release-'));
  try {
    if (notarize) {
      tools.checkCredentials();
      const submission = path.join(scratch, 'NoteMind-notarize.zip');
      run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, submission]);
      tools.notarize(submission);
      tools.staple(app);
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    if (notarize) tools.assessVerdict(app, 'app', spawn);

    // The update zip is made from the stapled app, then proven by unpacking it: the ticket and the seal must survive.
    fileSystem.rmSync(out(file.zip), { force: true });
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, out(file.zip)]);
    const unpacked = path.join(scratch, 'unpacked');
    fileSystem.mkdirSync(unpacked);
    run('/usr/bin/ditto', ['-x', '-k', out(file.zip), unpacked]);
    const copy = path.join(unpacked, 'NoteMind.app');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', copy]);
    if (notarize) { run('/usr/bin/xcrun', ['stapler', 'validate', copy]); tools.assessVerdict(copy, 'app', spawn); }

    // The dmg: the same stapled app and a link to /Applications; signed, notarized and stapled itself.
    const staging = path.join(scratch, 'dmg');
    fileSystem.mkdirSync(staging);
    run('/usr/bin/ditto', [app, path.join(staging, 'NoteMind.app')]);
    fileSystem.symlinkSync('/Applications', path.join(staging, 'Applications'));
    fileSystem.rmSync(out(file.dmg), { force: true });
    run('/usr/bin/hdiutil', ['create', '-volname', `NoteMind ${version}`, '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', '-ov', out(file.dmg)]);
    run('/usr/bin/codesign', ['--force', '--sign', identity, '--timestamp', out(file.dmg)]);
    if (notarize) {
      tools.notarize(out(file.dmg));
      tools.staple(out(file.dmg));
      tools.assessVerdict(out(file.dmg), 'dmg', spawn);
    }
  } finally {
    fileSystem.rmSync(scratch, { recursive: true, force: true });
  }

  const hashes = { [file.zip]: sha256(out(file.zip)), [file.dmg]: sha256(out(file.dmg)) };
  fileSystem.writeFileSync(out(file.sums), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n');
  return { zip: out(file.zip), dmg: out(file.dmg), sums: out(file.sums), hashes };
}

module.exports = { packageRelease, makeTools, names, sha256, DEFAULT_PROFILE };
