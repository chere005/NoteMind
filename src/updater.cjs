'use strict';
// Updates from the public GitHub releases of this repository.
//
// Trust: macOS. The release zip holds the signed, notarized app; Squirrel.Mac (Electron's autoUpdater) installs it only when
// its code signature satisfies the running app's designated requirement, so an update has to be signed by the same developer
// identity. Before Squirrel sees the zip, update-bundle.cjs also checks it against the release's published checksum and
// against the app inside (same bundle id, arm64, the release's own version, newer than this app, team signature), so an old
// signed build attached to a new release is refused. Windows installs go through updater-win.cjs.
//
// Squirrel needs a server that answers with the zip's address. GitHub's release list has no such document, so a one-shot
// server on 127.0.0.1 gives it the answer once the release list says a newer version exists.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prepareUpdate, rateLimited } = require('./update-bundle.cjs');

const REPO = 'chere005/NoteMind';
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const ASSET_NAME = /^NoteMind-(\d+\.\d+\.\d+)-mac-arm64\.zip$/;
/** The release asset for a version: the one name scripts/package-update.cjs writes and this module looks for. */
const assetName = version => `NoteMind-${version}-mac-arm64.zip`;
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** "1.2.3" or "v1.2.3" as [1, 2, 3]; null for anything else (a pre-release suffix is not a version we offer). */
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when a is older than b, 0 when equal, positive when newer; null when either is not a version. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * The update a GitHub "latest release" document offers to `current`, or null.
 * The asset must be the arm64 zip named for the release's own version and must live under the release download address.
 */
function pickUpdate(release, current, { prefix = DOWNLOAD_PREFIX } = {}) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;
  const version = parseVersion(release.tag_name);
  if (!version) return null;
  const text = version.join('.');
  const newer = compareVersions(text, current);
  if (newer === null || newer <= 0) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find(item => item && typeof item.name === 'string' && ASSET_NAME.exec(item.name)?.[1] === text);
  const url = asset && typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
  if (!url.startsWith(prefix) || url.includes('..')) return null;
  const sums = assets.find(item => item && item.name === `NoteMind-${text}-mac-SHA256SUMS.txt`);
  const sumsUrl = sums && typeof sums.browser_download_url === 'string' && sums.browser_download_url.startsWith(prefix) && !sums.browser_download_url.includes('..') ? sums.browser_download_url : '';
  return {
    version: text,
    url,
    size: Number.isSafeInteger(asset.size) && asset.size > 0 ? asset.size : 0,
    sumsUrl,
    notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
  };
}

/** NOTEMIND_UPDATE_API may point the check at a server on this Mac, for tests; any other address is ignored. */
function loopbackOverride(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return null;
    return { api: url.href, prefix: `${url.origin}/` };
  } catch {
    return null;
  }
}

/** updates.json: { automatic, rejected: { version, key } }; rejected is the last release that was downloaded and refused. */
function readPrefs(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rejected = saved.rejected && typeof saved.rejected.version === 'string' && typeof saved.rejected.key === 'string' ? { version: saved.rejected.version, key: saved.rejected.key } : null;
    return { automatic: saved.automatic !== false, rejected };
  } catch {
    return { automatic: true, rejected: null };
  }
}

function defaultFetchJson(url) {
  return fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NoteMind' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(response => {
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) throw rateLimited(response, 'update checks');
    if (!response.ok) throw Error(`The update server answered ${response.status}.`);
    return response.json();
  });
}

function createUpdater(options) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return require('./updater-win.cjs').createWindowsUpdater(options);
  return createMacUpdater(options);
}

function createMacUpdater({
  app,
  autoUpdater,
  dialog,
  getWindow = () => null,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  fetchJson = defaultFetchJson,
  createServer = http.createServer,
  prepare = null,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  prefsFile = path.join(app.getPath('userData'), 'updates.json'),
  log = () => {},
}) {
  const override = loopbackOverride(env.NOTEMIND_UPDATE_API);
  const supported = platform === 'darwin' && arch === 'arm64' && (app.isPackaged || !!override);
  const saved = readPrefs(prefsFile);
  let automatic = saved.automatic;
  let rejected = saved.rejected;
  let running = null;
  let ready = null;
  let declined = null;
  let timer = null;
  let started = false;
  let disposed = false;
  let backoffUntil = 0;
  const prepareZip = prepare || ((update, extra) => prepareUpdate(update, { current: app.getVersion(), compareVersions, loopback: !!override, log, ...extra }));

  function savePrefs() {
    try {
      fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
      const temp = `${prefsFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ automatic, ...(rejected ? { rejected } : {}) }) + '\n');
      fs.renameSync(temp, prefsFile);
    } catch (error) {
      log(`could not save the update settings: ${error.message}`);
    }
  }

  const parent = () => {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : undefined;
  };
  const say = options => {
    const window = parent();
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };
  const note = (message, detail) => say({ type: 'info', buttons: ['OK'], defaultId: 0, message, detail });

  function install() {
    try {
      autoUpdater.quitAndInstall();
      return true;
    } catch (error) {
      log(`install failed: ${error.message}`);
      void say({ type: 'warning', buttons: ['OK'], defaultId: 0, message: 'NoteMind could not install the update.', detail: error.message });
      return false;
    }
  }

  async function offerRestart() {
    if (!ready) return;
    declined = ready.version;
    if (override && env.NOTEMIND_UPDATE_RESTART_WHEN_READY === '1') {
      log(`restarting to install ${ready.version}`);
      install();
      return;
    }
    const answer = await say({
      type: 'info',
      buttons: ['Restart and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `NoteMind ${ready.version} is ready to install.`,
      detail: 'NoteMind saves your work, restarts and opens the new version. Choose Later and it installs the next time NoteMind starts.',
    });
    if (answer.response === 0) install();
  }

  /**
   * Check the release zip (update-bundle.cjs), then hand it to Squirrel through a one-shot server on this Mac; resolves when
   * Squirrel has downloaded it or failed. Squirrel is given the checked file, never the GitHub address.
   */
  async function download(update, manual) {
    // A release that was downloaded and refused is not downloaded again until its files change or another release replaces it;
    // asking by hand tries again.
    const prepared = await prepareZip(update, { rejected: manual ? null : rejected });
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(16).toString('hex');
      let port = 0;
      const body = () => JSON.stringify({
        url: prepared.file ? `http://127.0.0.1:${port}/${token}/NoteMind.zip` : prepared.url,
        name: update.version,
        notes: update.notes,
        pub_date: update.publishedAt || undefined,
      });
      const server = createServer((request, response) => {
        if (request.method === 'GET' && request.url === `/${token}/update`) {
          const json = body();
          response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
          response.end(json);
        } else if (prepared.file && request.method === 'GET' && request.url === `/${token}/NoteMind.zip`) {
          const stream = fs.createReadStream(prepared.file);
          stream.on('error', () => response.destroy());
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(prepared.file).size });
          stream.pipe(response);
        } else {
          response.writeHead(404);
          response.end();
        }
      });
      let finished = false;
      let limit = null;
      const offs = [];
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimer(limit);
        for (const off of offs) off();
        server.close();
        server.closeAllConnections?.();
        prepared.cleanup?.();
        if (error) reject(error);
        else resolve(value);
      };
      const on = (name, handler) => {
        autoUpdater.on(name, handler);
        offs.push(() => autoUpdater.removeListener(name, handler));
      };
      // Squirrel reports the release name it was given; a different one means it fetched something else than was checked.
      on('update-downloaded', (_event, _notes, name) => finish(typeof name === 'string' && name !== update.version ? Error(`Squirrel downloaded ${name}, not ${update.version}.`) : null, update));
      on('update-not-available', () => finish(null, null));
      on('error', error => finish(error instanceof Error ? error : Error(String(error))));
      server.on('error', error => finish(error));
      server.listen(0, '127.0.0.1', () => {
        try {
          port = server.address().port;
          autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/update`, serverType: 'json' });
          limit = setTimer(() => finish(Error('The update did not finish downloading.')), DOWNLOAD_TIMEOUT_MS);
          limit.unref?.();
          autoUpdater.checkForUpdates();
        } catch (error) {
          finish(error);
        }
      });
    });
  }

  async function run(manual) {
    if (ready) {
      if (manual || declined !== ready.version) await offerRestart();
      return { status: 'ready', version: ready.version };
    }
    if (now() < backoffUntil) {
      if (manual) await note('GitHub is limiting update checks right now.', `NoteMind will not ask again until ${new Date(backoffUntil).toLocaleTimeString()}.`);
      return { status: 'rate-limited', retryAt: backoffUntil };
    }
    let release;
    try {
      release = await fetchJson(override ? override.api : LATEST_RELEASE);
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        backoffUntil = now() + (error.retryAfterMs || 60 * 60 * 1000);
        log(`rate limited (${error.status}); not asking again until ${new Date(backoffUntil).toISOString()}`);
        if (manual) await note('GitHub is limiting update checks right now.', `NoteMind will ask again after ${new Date(backoffUntil).toLocaleTimeString()}.`);
        return { status: 'rate-limited', retryAt: backoffUntil };
      }
      log(`check failed: ${error.message}`);
      if (manual) await note('NoteMind could not check for updates.', error.message);
      return { status: 'error', message: error.message };
    }
    const update = pickUpdate(release, app.getVersion(), override ? { prefix: override.prefix } : undefined);
    if (!update) {
      if (manual) await note('NoteMind is up to date.', `Version ${app.getVersion()}`);
      return { status: 'current' };
    }
    log(`downloading ${update.version}`);
    if (manual) void note(`NoteMind ${update.version} is available.`, 'It downloads in the background and you are asked to restart when it is ready.');
    try {
      const done = await download(update, manual);
      if (!done) return { status: 'current' };
      ready = update;
      log(`downloaded ${update.version}`);
      if (!disposed) await offerRestart();
      return { status: 'ready', version: update.version };
    } catch (error) {
      if (error.status === 403 || error.status === 429) backoffUntil = now() + (error.retryAfterMs || 60 * 60 * 1000);
      if (error.alreadyRejected) {
        log(error.message);
        return { status: 'rejected', message: error.message };
      }
      if (error.rejection) {
        rejected = error.rejection;
        savePrefs();
      }
      log(`download failed: ${error.message}`);
      if (manual) await note('NoteMind could not download the update.', error.message);
      return { status: 'error', message: error.message };
    }
  }

  /** One check at a time; a second request while one runs gets the same answer. */
  function check({ manual = false } = {}) {
    if (!supported) {
      if (manual) void note('Updates are checked by the installed NoteMind app.', `This copy is version ${app.getVersion()}.`);
      return Promise.resolve({ status: 'unsupported' });
    }
    if (running) return running;
    running = run(manual).finally(() => { running = null; });
    return running;
  }

  function schedule(delay) {
    clearTimer(timer);
    timer = null;
    if (disposed || !automatic || !supported) return;
    timer = setTimer(() => {
      timer = null;
      void check().finally(() => schedule(CHECK_EVERY_MS));
    }, Math.max(delay, backoffUntil - now()));
    timer.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    schedule(FIRST_CHECK_MS);
  }

  function setAutomatic(value) {
    automatic = !!value;
    savePrefs();
    if (started) schedule(FIRST_CHECK_MS);
  }

  function dispose() {
    disposed = true;
    clearTimer(timer);
    timer = null;
  }

  return { check, start, setAutomatic, dispose, isAutomatic: () => automatic, isSupported: () => supported };
}

module.exports = { createUpdater, pickUpdate, parseVersion, compareVersions, loopbackOverride, assetName, ASSET_NAME, REPO, LATEST_RELEASE, DOWNLOAD_PREFIX };
