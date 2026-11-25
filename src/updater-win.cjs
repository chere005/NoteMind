'use strict';
// Windows updates, through electron-updater and the latest.yml that electron-builder writes beside the NSIS installer.
//
// Trust: the installer is not Authenticode-signed (the owner chose to skip a certificate), so an update is as trustworthy as
// HTTPS to GitHub plus the sha512 in latest.yml, which electron-updater checks against the downloaded installer and refuses
// on a mismatch. This module adds the same version rules as the Mac updater (never an older or equal version, never a
// pre-release) and the same behaviour: quiet background checks, a restart prompt, Help > Check for Updates, a rate-limit
// back-off. It has not been run on Windows: the unit tests drive it with a fake electron-updater.

const fs = require('node:fs');
const path = require('node:path');
const { parseVersion, compareVersions } = require('./updater.cjs');

const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function readAutomatic(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).automatic !== false;
  } catch {
    return true;
  }
}

const statusOf = error => Number(error?.statusCode ?? error?.status ?? 0);
const isMissingFeed = error => error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || statusOf(error) === 404;

function createWindowsUpdater({
  app,
  dialog,
  getWindow = () => null,
  arch = process.arch,
  resourcesPath = process.resourcesPath,
  exists = fs.existsSync,
  loadAutoUpdater = () => require('electron-updater').autoUpdater,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  prefsFile = path.join(app.getPath('userData'), 'updates.json'),
  log = () => {},
}) {
  // Only the installed (NSIS) app has app-update.yml in its resources; the portable folder and a source checkout do not.
  const supported = arch === 'x64' && !!app.isPackaged && !!resourcesPath && exists(path.join(resourcesPath, 'app-update.yml'));
  let automatic = readAutomatic(prefsFile);
  let autoUpdater = null;
  let running = null;
  let ready = null;
  let declined = null;
  let timer = null;
  let started = false;
  let disposed = false;
  let backoffUntil = 0;

  const parent = () => {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : undefined;
  };
  const say = options => {
    const window = parent();
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };
  const note = (message, detail) => say({ type: 'info', buttons: ['OK'], defaultId: 0, message, detail });

  function engine() {
    if (autoUpdater) return autoUpdater;
    autoUpdater = loadAutoUpdater();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true; // Later installs when NoteMind next quits
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    return autoUpdater;
  }

  function install() {
    try {
      engine().quitAndInstall(true, true);
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
    const answer = await say({
      type: 'info',
      buttons: ['Restart and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `NoteMind ${ready.version} is ready to install.`,
      detail: 'NoteMind saves your work, restarts and opens the new version. Choose Later and it installs when you next quit NoteMind.',
    });
    if (answer.response === 0) install();
  }

  function limited(error, manual) {
    backoffUntil = now() + 60 * 60 * 1000;
    log(`rate limited (${statusOf(error)}); not asking again until ${new Date(backoffUntil).toISOString()}`);
    return manual
      ? note('GitHub is limiting update checks right now.', `NoteMind will ask again after ${new Date(backoffUntil).toLocaleTimeString()}.`).then(() => ({ status: 'rate-limited', retryAt: backoffUntil }))
      : { status: 'rate-limited', retryAt: backoffUntil };
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
    let result;
    try {
      result = await engine().checkForUpdates();
    } catch (error) {
      if (statusOf(error) === 403 || statusOf(error) === 429) return limited(error, manual);
      if (isMissingFeed(error)) result = null; // a release without Windows files is simply not an update for us
      else {
        log(`check failed: ${error.message}`);
        if (manual) await note('NoteMind could not check for updates.', error.message);
        return { status: 'error', message: error.message };
      }
    }
    const offered = result?.updateInfo?.version;
    const newer = parseVersion(offered) ? compareVersions(offered, app.getVersion()) : null;
    if (!(newer > 0)) {
      if (manual) await note('NoteMind is up to date.', `Version ${app.getVersion()}`);
      return { status: 'current' };
    }
    log(`downloading ${offered}`);
    if (manual) void note(`NoteMind ${offered} is available.`, 'It downloads in the background and you are asked to restart when it is ready.');
    try {
      await engine().downloadUpdate();
      ready = { version: offered };
      log(`downloaded ${offered}`);
      if (!disposed) await offerRestart();
      return { status: 'ready', version: offered };
    } catch (error) {
      if (statusOf(error) === 403 || statusOf(error) === 429) return limited(error, manual);
      log(`download failed: ${error.message}`);
      if (manual) await note('NoteMind could not download the update.', error.message);
      return { status: 'error', message: error.message };
    }
  }

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
    try {
      fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
      const temp = `${prefsFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ automatic }) + '\n');
      fs.renameSync(temp, prefsFile);
    } catch (error) {
      log(`could not save the update setting: ${error.message}`);
    }
    if (started) schedule(FIRST_CHECK_MS);
  }

  function dispose() {
    disposed = true;
    clearTimer(timer);
    timer = null;
  }

  return { check, start, setAutomatic, dispose, isAutomatic: () => automatic, isSupported: () => supported };
}

module.exports = { createWindowsUpdater };
