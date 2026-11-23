#!/usr/bin/env node
// The release files for the Mac: from the signed app `npm run build` left in dist/NoteMind, notarize and staple it, then write
//   dist/NoteMind-<version>-mac-arm64.zip     the file the in-app updater downloads (its name is the updater's contract)
//   dist/NoteMind-<version>-mac-arm64.dmg     a signed, notarized, stapled disk image for first installs
//   dist/NoteMind-<version>-mac-SHA256SUMS.txt
// `--check` only verifies the signatures and the notarytool profile. `--no-notarize` is for scratch runs: the files it
// writes are not releasable. See README, "Updates and releases".
'use strict';
const path = require('node:path');
const { packageRelease, makeTools } = require('./mac-release.cjs');

const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const flags = new Set(process.argv.slice(2));

try {
  if (flags.has('--check')) {
    const { auditMacSignature, resolveIdentity, teamOf } = require('./mac-signing.cjs');
    const app = path.join(root, 'dist', 'NoteMind', 'NoteMind.app');
    const team = teamOf(resolveIdentity({ env: process.env, execFileSync: require('node:child_process').execFileSync, warn: console.warn }));
    console.log(`${auditMacSignature(app, { team })} signatures are Developer ID, hardened and timestamped`);
    console.log(`notarytool profile ${makeTools().checkCredentials()} works`);
  } else {
    const made = packageRelease({ root, version, notarize: !flags.has('--no-notarize') });
    for (const [name, hash] of Object.entries(made.hashes)) console.log(`${name}  sha256 ${hash}`);
    if (flags.has('--no-notarize')) console.log('NOT NOTARIZED: these files are for testing only.');
  }
} catch (error) {
  console.error(`package-update: ${error.message}`);
  process.exit(1);
}
