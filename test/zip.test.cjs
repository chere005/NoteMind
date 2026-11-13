const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pack, unpack } = require('../src/zip.cjs');
test('notepad archives preserve Markdown and binary assets', () => { const files = { 'document.md': Buffer.from('# Hello\n\n![drawing](assets/a.svg)'), 'assets/a.svg': Buffer.from('<svg/>') }; const result = unpack(pack(files)); assert.deepEqual({ ...result }, files); });
test('rejects damaged archives', () => { assert.throws(() => unpack(Buffer.from('not an archive'))); });
