const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createInputMonitoringCheck} = require('../src/input-monitoring-check.cjs');

const URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';

function harness({access = 'denied', display = true, answer = 0, env = {}, platform = 'darwin', openFails = false} = {}) {
  const calls = {status: 0, dialogs: [], opened: [], log: []};
  const check = createInputMonitoringCheck({
    inputMonitoring: {status: async () => { calls.status++; return access; }},
    dialog: {showMessageBox: async (...args) => { calls.dialogs.push(args[args.length - 1]); return {response: answer}; }},
    shell: {openExternal: async url => { calls.opened.push(url); if (openFails) throw Error('refused'); }},
    getWindow: () => ({isDestroyed: () => false}),
    hasPenDisplay: () => display,
    settingsUrl: URL,
    log: message => calls.log.push(message),
    env, platform,
  });
  return {check, calls};
}

test('a pen display that macOS will not let the app listen to gets one question, and Open goes to the setting', async () => {
  const h = harness();
  assert.deepEqual(await h.check.check(), {access: 'denied', asked: true});
  assert.equal(h.calls.dialogs.length, 1);
  assert.deepEqual(h.calls.dialogs[0].buttons, ['Open System Settings', 'Not Now']);
  assert.match(h.calls.dialogs[0].message, /Input Monitoring/);
  assert.deepEqual(h.calls.opened, [URL]);
  assert.deepEqual(h.calls.log, ['input monitoring: denied']);
});

test('Not Now opens nothing, and the question is not asked again in the same launch', async () => {
  const h = harness({answer: 1});
  await h.check.check();
  assert.deepEqual(h.calls.opened, []);
  const again = await h.check.check();
  assert.equal(again.asked, undefined);
  assert.equal(h.calls.dialogs.length, 1);
});

test('an undecided answer is a question too', async () => {
  const h = harness({access: 'undecided'});
  await h.check.check();
  assert.equal(h.calls.dialogs.length, 1);
});

test('granted or unknown asks nothing, and the answer is logged', async () => {
  for (const access of ['granted', 'unknown']) {
    const h = harness({access});
    assert.deepEqual(await h.check.check(), {access});
    assert.equal(h.calls.dialogs.length, 0);
    assert.deepEqual(h.calls.log, ['input monitoring: ' + access]);
  }
});

test('without a pen display, off the Mac, or in a scratch run nothing is asked', async () => {
  const none = harness({display: false});
  assert.deepEqual(await none.check.check(), {access: 'skipped'});
  assert.equal(none.calls.status, 0);
  const linux = harness({platform: 'linux'});
  assert.deepEqual(await linux.check.check(), {access: 'skipped'});
  const scratch = harness({env: {NOTEMIND_DATA: '/tmp/scratch'}});
  assert.deepEqual(await scratch.check.check(), {access: 'denied'});
  assert.equal(scratch.calls.dialogs.length, 0);
  assert.deepEqual(scratch.calls.log, ['input monitoring: denied']);
});

test('a refused System Settings is logged, not thrown', async () => {
  const h = harness({openFails: true});
  await h.check.check();
  assert.deepEqual(h.calls.log, ['input monitoring: denied', 'could not open System Settings: refused']);
});
