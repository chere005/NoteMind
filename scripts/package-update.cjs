#!/usr/bin/env node
// The zip the in-app updater downloads: dist/NoteMind-<version>-mac-arm64.zip, made from the signed app that
// `npm run build` left in dist/NoteMind. Attach it to the GitHub release v<version> (docs: README, "Updates").
'use strict';
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assetName } = require('../src/updater.cjs');

const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const app = path.join(root, 'dist', 'NoteMind', 'NoteMind.app');
const zip = path.join(root, 'dist', assetName(version));

function fail(message) {
  console.error(`package-update: ${message}`);
  process.exit(1);
}

function run(command, args) {
  return cp.spawnSync(command, args, { encoding: 'utf8' });
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('the update zip is made on an Apple Silicon Mac.');
if (!fs.existsSync(app)) fail(`${app} is missing; run npm run build first.`);

const plist = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents', 'Info.plist')]);
const built = plist.stdout.trim();
if (built !== version) fail(`the built app is ${built || 'unreadable'} but package.json says ${version}; run npm run build.`);

const verify = run('codesign', ['--verify', '--deep', '--strict', app]);
if (verify.status !== 0) fail(`the app's signature is not valid: ${verify.stderr.trim()}`);
const details = run('codesign', ['-dvv', app]).stderr;
// An app signed ad hoc or by another identity can never replace the installed one: Squirrel refuses it.
if (!/^Authority=Developer ID Application:/m.test(details) || !/^TeamIdentifier=(?!not set)/m.test(details)) {
  fail('the app is not signed with a Developer ID Application identity.');
}

fs.rmSync(zip, { force: true });
const made = run('ditto', ['-c', '-k', '--keepParent', app, zip]);
if (made.status !== 0) fail(`ditto failed: ${made.stderr.trim()}`);

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(zip));
const bytes = fs.statSync(zip).size;
console.log(`${path.relative(root, zip)}  ${(bytes / 1048576).toFixed(1)} MiB  sha256 ${hash.digest('hex')}`);
