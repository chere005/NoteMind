#!/usr/bin/env node
// The Windows installer: dist/installer/NoteMind-<version>-win-x64-setup.exe, its .blockmap and latest.yml, made from the
// portable folder `npm run build` leaves in dist/NoteMind. Run by .github/workflows/windows-release.yml on windows-latest;
// Tauri-style cross builds from a Mac are not attempted. The installer is NOT Authenticode-signed (no certificate, by
// decision), so Windows shows a SmartScreen warning on a first manual install. Updates go through electron-updater.
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { version, build } = require('../package.json');
const [owner, repo] = [build.publish[0].owner, build.publish[0].repo];

/** What electron-updater reads at run time (electron-builder writes it only when it packs the app itself). */
const appUpdateYml = () => `provider: github\nowner: ${owner}\nrepo: ${repo}\nupdaterCacheDirName: notemind-updater\n`;

/** The folder electron-builder wraps: the portable build without the second, unrenamed copy of the runtime. */
function stage({ source = path.join(root, 'dist', 'NoteMind'), destination = path.join(root, 'dist', 'win-prepackaged'), fileSystem = fs } = {}) {
  if (!fileSystem.existsSync(path.join(source, 'NoteMind.exe'))) throw Error(`${source} has no NoteMind.exe; run npm run build on Windows first.`);
  if (!fileSystem.existsSync(path.join(source, 'resources', 'app', 'package.json'))) throw Error(`${source} has no resources/app; run npm run build on Windows first.`);
  if (!fileSystem.existsSync(path.join(source, 'resources', 'app', 'node_modules', 'electron-updater'))) throw Error('The build does not carry electron-updater; the installer could not update itself.');
  fileSystem.rmSync(destination, { recursive: true, force: true });
  fileSystem.cpSync(source, destination, { recursive: true, filter: file => path.relative(source, file) !== 'electron.exe' });
  fileSystem.writeFileSync(path.join(destination, 'resources', 'app-update.yml'), appUpdateYml());
  return destination;
}

function main() {
  if (process.platform !== 'win32') throw Error('The Windows installer is built on Windows (CI runs it on windows-latest).');
  const prepackaged = stage();
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  cp.execFileSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--prepackaged', prepackaged, '--publish', 'never'], { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  const installer = path.join(root, 'dist', 'installer', `NoteMind-${version}-win-x64-setup.exe`);
  const feed = path.join(root, 'dist', 'installer', 'latest.yml');
  for (const file of [installer, `${installer}.blockmap`, feed]) if (!fs.existsSync(file)) throw Error(`electron-builder did not write ${path.relative(root, file)}.`);
  const header = Buffer.alloc(2);
  const fd = fs.openSync(installer, 'r');
  fs.readSync(fd, header, 0, 2, 0);
  fs.closeSync(fd);
  if (header.toString('latin1') !== 'MZ') throw Error('The installer is not a Windows executable.');
  const yml = fs.readFileSync(feed, 'utf8');
  if (!yml.includes(`version: ${version}`) || !yml.includes(path.basename(installer)) || !/sha512: \S+/.test(yml)) throw Error('latest.yml does not describe this installer.');
  console.log(`${path.relative(root, installer)}  ${(fs.statSync(installer).size / 1048576).toFixed(1)} MiB`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`package-win: ${error.message}`); process.exit(1); }
}

module.exports = { stage, appUpdateYml };
