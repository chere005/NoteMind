'use strict';
// Downloads a release zip and proves what is in it before Squirrel.Mac is allowed to install it.
//
// Squirrel accepts any zip whose app satisfies the running app's code-signing requirement. That does not stop an older
// build of NoteMind, signed by the same identity, from being attached to a newer release. So the update is bound three ways:
//   - the sha256 the release publishes for the zip (NoteMind-<version>-mac-SHA256SUMS.txt) matches the bytes;
//   - the app inside is NoteMind (bundle id), arm64, and its own version is exactly the release's, and newer than this app;
//   - the app inside verifies and was signed by this team's Developer ID.
// What passes is served to Squirrel from a file on this Mac, so what was checked is what gets installed.

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const BUNDLE_ID = 'com.seancheren.notemind';
const MAX_ZIP_BYTES = 900 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const RELEASE_HOSTS = /^(?:github\.com|(?:[a-z0-9-]+\.)*githubusercontent\.com)$/;
/** The code requirement an update must meet: NoteMind, signed by an Apple-issued certificate of the same team as this app. */
const requirementFor = team => `anchor apple generic and identifier "${BUNDLE_ID}" and certificate leaf[subject.OU] = "${team}"`;

/** The team that signed the running app (its bundle, three levels above the executable); null when it carries none. */
function ownTeam(execPath) {
  const bundle = path.resolve(execPath, '..', '..', '..');
  const result = cp.spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8' });
  return /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(`${result.stdout || ''}${result.stderr || ''}`)?.[1] ?? null;
}

/** An error that says GitHub is limiting requests, and for how long to stop asking. */
function rateLimited(response, what) {
  const header = name => response.headers.get(name);
  let wait = 0;
  const retryAfter = Number(header('retry-after'));
  const reset = Number(header('x-ratelimit-reset'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) wait = retryAfter * 1000;
  else if (Number.isFinite(reset) && reset > 0) wait = reset * 1000 - Date.now();
  const retryAfterMs = Math.min(Math.max(wait, 15 * 60 * 1000), 24 * 60 * 60 * 1000);
  return Object.assign(Error(`GitHub is limiting requests for ${what} (${response.status}).`), { status: response.status, retryAfterMs });
}

/** A release address is fetched over https from GitHub's own hosts; a loopback address is allowed only when a test says so. */
function allowedAddress(url, loopback) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (loopback) return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  return parsed.protocol === 'https:' && RELEASE_HOSTS.test(parsed.hostname);
}

async function defaultFetchFile(url, destination, { maxBytes = MAX_ZIP_BYTES, loopback = false, fetchImpl = fetch, expectedBytes = 0 } = {}) {
  if (!allowedAddress(url, loopback)) throw Error('The update address is not a GitHub release address.');
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'NoteMind' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (response.status === 403 || response.status === 429) throw rateLimited(response, 'the update download');
  if (!response.ok) throw Error(`The update server answered ${response.status}.`);
  if (response.url && !allowedAddress(response.url, loopback)) throw Error('The update download was redirected away from GitHub.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw Error('The update download is larger than NoteMind allows.');
  // The release lists each asset's size; a body of another size is not the file the release describes, so it is not downloaded.
  if (expectedBytes > 0 && declared > 0 && declared !== expectedBytes) throw Error(`The update download is ${declared} bytes but the release lists ${expectedBytes}.`);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) return done(Error('The update download is larger than NoteMind allows.'));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(destination, { mode: 0o600 }));
  return { sha256: hash.digest('hex'), bytes };
}

async function defaultFetchText(url, { loopback = false, fetchImpl = fetch } = {}) {
  if (!allowedAddress(url, loopback)) throw Error('The checksum address is not a GitHub release address.');
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'NoteMind' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 403 || response.status === 429) throw rateLimited(response, 'the checksum download');
  if (!response.ok) throw Error(`The checksum file answered ${response.status}.`);
  return (await response.text()).slice(0, 64 * 1024);
}

/** The sha256 a SHA256SUMS file lists for `name`, or null. */
function listedHash(sums, name) {
  for (const line of String(sums).split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;

/**
 * The architecture of a THIN Mach-O file, read from its header: 'arm64', 'other' (another thin CPU, or a fat file, which is
 * not an Apple Silicon-only build), or null when the file is not Mach-O at all. This runs on users' Macs, which may have no
 * developer tools: /usr/bin/lipo, otool and the like are xcrun shims that fail (or open an install dialog) without them.
 */
function machOArch(file) {
  const header = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.readSync(fd, header, 0, 8, 0) < 8) return null;
  } finally {
    fs.closeSync(fd);
  }
  const magic = header.readUInt32LE(0);
  if (magic === MH_MAGIC_64) return header.readUInt32LE(4) === CPU_TYPE_ARM64 ? 'arm64' : 'other';
  if (magic === 0xfeedface || magic === 0xcafebabe || magic === 0xbebafeca || magic === 0xcafebabf || magic === 0xbfbafeca) return 'other';
  return null;
}

/** An update that was fetched whole and then refused; `key` names what was refused (see rejectionKey). */
class UpdateRejected extends Error {
  constructor(message, update, key) {
    super(message);
    this.rejection = { version: update.version, key };
  }
}

const rejectionKey = (update, sumsText) => (update.sumsUrl && sumsText != null
  ? `sums:${crypto.createHash('sha256').update(sumsText).digest('hex')}`
  : `published:${update.publishedAt || 'unknown'}`);

function defaultRun(command, args) {
  try {
    return cp.execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60 * 1000 });
  } catch (error) {
    // execFileSync's own message is just the command line; say how it ended and what it printed.
    const how = error.signal ? `signal ${error.signal}` : error.status != null ? `exit ${error.status}` : error.code || 'error';
    throw Error(`${path.basename(command)} failed (${how}): ${String(error.stderr || error.stdout || '').trim().slice(0, 400) || 'no output'}`);
  }
}

/** Unpack the zip beside itself and check the app inside. Returns the app's version. */
function inspectZip(zip, { run = defaultRun, team, archOf = machOArch } = {}) {
  if (!/^[A-Z0-9]{10}$/.test(team || '')) throw Error('This copy of NoteMind is not signed by a team, so it cannot check an update.');
  const folder = path.join(path.dirname(zip), 'unpacked');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder);
  try {
    run('/usr/bin/ditto', ['-x', '-k', zip, folder]);
    const entries = fs.readdirSync(folder);
    if (entries.length !== 1 || entries[0] !== 'NoteMind.app') throw Error('The update zip does not hold exactly NoteMind.app.');
    const app = path.join(folder, 'NoteMind.app');
    const plist = key => String(run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')])).trim();
    if (plist('CFBundleIdentifier') !== BUNDLE_ID) throw Error('The update is not NoteMind.');
    const executable = plist('CFBundleExecutable');
    if (archOf(path.join(app, 'Contents', 'MacOS', path.basename(executable))) !== 'arm64') throw Error('The update is not an Apple Silicon build.');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    run('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirementFor(team)}`, app]);
    return plist('CFBundleShortVersionString');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Fetch, check and keep the update. Resolves { file, cleanup } for a zip that passed every check; rejects otherwise,
 * after removing what it wrote. `compareVersions` is the updater's own.
 */
async function prepareUpdate(update, { current, compareVersions, team = ownTeam(process.execPath), loopback = false, fetchFile = defaultFetchFile, fetchText = defaultFetchText, inspect = inspectZip, run = defaultRun, tmpdir = os.tmpdir(), log = () => {}, rejected = null }) {
  const folder = fs.mkdtempSync(path.join(tmpdir, 'notemind-update-'));
  const cleanup = () => fs.rmSync(folder, { recursive: true, force: true });
  let key = rejectionKey(update, null);
  try {
    const file = path.join(folder, `NoteMind-${update.version}-mac-arm64.zip`);
    // The checksum file is small: read it first. A release already refused with this very file is not downloaded again.
    let sumsText = null;
    if (update.sumsUrl) {
      sumsText = await fetchText(update.sumsUrl, { loopback });
      key = rejectionKey(update, sumsText);
    }
    if (rejected && rejected.version === update.version && rejected.key === key) {
      throw Object.assign(Error(`NoteMind ${update.version} was refused earlier and the release has not changed.`), { alreadyRejected: true });
    }
    const got = await fetchFile(update.url, file, { loopback, expectedBytes: update.size || 0 });
    if (update.sumsUrl) {
      const expected = listedHash(sumsText, path.basename(new URL(update.url).pathname));
      if (!expected) throw new UpdateRejected('The release checksums do not list the update zip.', update, key);
      if (got.sha256 !== expected) throw new UpdateRejected('The update zip does not match the checksum the release publishes.', update, key);
    } else {
      log('the release publishes no checksums; relying on the signature checks');
    }
    let inside;
    try {
      inside = inspect(file, { run, team });
    } catch (error) {
      throw new UpdateRejected(error.message, update, key);
    }
    if (inside !== update.version) throw new UpdateRejected(`The release says ${update.version} but the app inside is ${inside}.`, update, key);
    const order = compareVersions(inside, current);
    if (order === null || order <= 0) throw new UpdateRejected(`The app inside (${inside}) is not newer than this one (${current}).`, update, key);
    return { file, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = { prepareUpdate, inspectZip, machOArch, UpdateRejected, rejectionKey, listedHash, defaultFetchFile, defaultFetchText, allowedAddress, rateLimited, requirementFor, ownTeam, BUNDLE_ID, MAX_ZIP_BYTES };
