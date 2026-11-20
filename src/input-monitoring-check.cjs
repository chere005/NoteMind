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
  env = process.env,
  platform = process.platform,
}) {
  let asked = false;
  let running = null;

  async function run() {
    if (platform !== 'darwin' || !hasPenDisplay()) return {access: 'skipped'};
    const access = await inputMonitoring.status();
    log(`input monitoring: ${access}`);
    if (access === 'granted' || access === 'unknown') return {access};
    // Tests and scratch runs (a data folder of their own) never put a question on the screen.
    if (asked || env.NOTEMIND_DATA) return {access};
    asked = true;
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

  /** One check at a time. */
  function check() {
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }

  return {check};
}

module.exports = {createInputMonitoringCheck};
