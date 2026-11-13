const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMacTarget } = require('../scripts/mac-target.cjs');

test('Mac builds require an Apple Silicon host and Electron runtime', () => {
  assert.doesNotThrow(() => validateMacTarget('darwin', 'arm64', 'arm64'));
  assert.throws(() => validateMacTarget('darwin', 'x64', 'x86_64'), /Apple Silicon/);
  assert.throws(() => validateMacTarget('darwin', 'arm64', 'x86_64 arm64'), /Apple Silicon/);
  assert.throws(() => validateMacTarget('darwin', 'arm64', 'x86_64'), /Apple Silicon/);
  assert.doesNotThrow(() => validateMacTarget('win32', 'x64', 'x86_64'));
  assert.doesNotThrow(() => validateMacTarget('linux', 'x64', 'x86_64'));
});
