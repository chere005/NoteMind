'use strict';
// A pen display's side buttons reach the app only when macOS lets the app listen to the device (Input Monitoring). When a Wacom
// display is attached and macOS says no, ask once per launch whether to open that setting. What macOS answered goes in the log.

function createInputMonitoringCheck({
  inputMonitoring,
  dialog,
  shell,
  getWindow = () => null,
  hasPenDisplay,
  settingsUrl,
  log = () => {},
  onGranted = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  env = process.env,
  platform = process.platform,
}) {
  let asked = false;
  let running = null;
  let watching = null;
  let tries = 0;

  async function run() {
    if (platform !== 'darwin' || !hasPenDisplay()) return {access: 'skipped'};
    const access = await inputMonitoring.status();
    log(`input monitoring: ${access}`);
    if (access === 'granted' || access === 'unknown') return {access};
    // Tests and scratch runs (a data folder of their own) never put a question on the screen.
    if (asked || env.NOTEMIND_DATA) return {access};
    asked = true;
    if (access === 'denied') watch();
    const options = {
      type: 'info',
      buttons: ['Open System Settings', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      message: "NoteMind needs Input Monitoring to read the pen's side buttons.",
      detail: 'Turn NoteMind on under Privacy & Security, Input Monitoring. If it already looks on, turn it off and on again, or remove it with the minus button and add it back, then reopen NoteMind.',
    };
    const window = getWindow();
    const answer = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (answer.response === 0) {
      try {
        await shell.openExternal(settingsUrl);
      } catch (error) {
        log(`could not open System Settings: ${error.message}`);
      }
    }
    return {access, asked: true};
  }

  /**
   * The person is in System Settings: look again every few seconds (for fifteen minutes) and, the moment macOS says yes,
   * let the pen's button reader start over, so the setting takes effect without reopening the app.
   */
  function watch() {
    if (watching || platform !== 'darwin') return;
    const tick = async () => {
      watching = null;
      if (++tries > 225) return;
      const access = await inputMonitoring.status();
      if (access === 'granted') {
        log('input monitoring: granted');
        try { onGranted(); } catch (error) { log(`could not restart the pen buttons: ${error.message}`); }
        return;
      }
      if (access === 'denied') watching = setTimer(tick, 4000);
    };
    watching = setTimer(tick, 4000);
    watching.unref?.();
  }

  /** One check at a time. */
  function check() {
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }

  return {check, stop() { clearTimer(watching); watching = null; tries = 1e9; }};
}

module.exports = {createInputMonitoringCheck};
