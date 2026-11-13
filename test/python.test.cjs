const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runPython } = require('../src/python.cjs');
test('Python runs a saved script in its directory', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notemind-python-'));
  try { const file = path.join(dir, 'example.py'); await fs.writeFile(file, 'import os\nprint(os.path.basename(os.getcwd()))\n'); const result = await runPython(file); if (result.code === null) return t.skip(result.output); assert.equal(result.code, 0, result.output); assert.equal(result.output.trim(), path.basename(dir)); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('only Python files can be run', async () => assert.rejects(runPython('file.md'), /\.py/));
