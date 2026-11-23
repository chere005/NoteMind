const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {stage, appUpdateYml} = require('../scripts/package-win.cjs');
const pkg = require('../package.json');

function portable({updater = true, exe = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-win-stage-'));
  const source = path.join(dir, 'NoteMind');
  fs.mkdirSync(path.join(source, 'resources', 'app', 'node_modules', ...(updater ? ['electron-updater'] : [])), {recursive: true});
  fs.writeFileSync(path.join(source, 'resources', 'app', 'package.json'), '{}');
  if (exe) fs.writeFileSync(path.join(source, 'NoteMind.exe'), 'MZ');
  fs.writeFileSync(path.join(source, 'electron.exe'), 'MZ duplicate');
  fs.writeFileSync(path.join(source, 'ffmpeg.dll'), 'dll');
  return {dir, source, destination: path.join(dir, 'prepackaged')};
}

test('the installer stage keeps the app, drops the duplicate runtime and writes the update feed address', () => {
  const h = portable();
  stage(h);
  assert.ok(fs.existsSync(path.join(h.destination, 'NoteMind.exe')));
  assert.ok(fs.existsSync(path.join(h.destination, 'ffmpeg.dll')));
  assert.ok(!fs.existsSync(path.join(h.destination, 'electron.exe')));
  assert.equal(fs.readFileSync(path.join(h.destination, 'resources', 'app-update.yml'), 'utf8'), 'provider: github\nowner: chere005\nrepo: NoteMind\nupdaterCacheDirName: notemind-updater\n');
});

test('a build that cannot update itself, or has no application, is not packaged', () => {
  assert.throws(() => stage(portable({updater: false})), /does not carry electron-updater/);
  assert.throws(() => stage(portable({exe: false})), /no NoteMind\.exe/);
});

test('the electron-builder configuration builds a per-user NSIS installer named the way the workflow uploads it', () => {
  const {build} = pkg;
  assert.equal(build.appId, 'com.seancheren.notemind');
  assert.deepEqual(build.win.target, [{target: 'nsis', arch: ['x64']}]);
  assert.equal(build.artifactName, 'NoteMind-${version}-win-x64-setup.${ext}');
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.oneClick, true);
  assert.deepEqual(build.publish, [{provider: 'github', owner: 'chere005', repo: 'NoteMind'}]);
  assert.match(appUpdateYml(), /owner: chere005\nrepo: NoteMind/);
});

test('Windows installers are deliberately not Authenticode-signed: no signing is configured anywhere', () => {
  const text = JSON.stringify(pkg.build);
  assert.ok(!/signtool|signingHash|certificate|signExecutable|azureSignOptions|sign["']?:/i.test(text));
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'windows-release.yml'), 'utf8');
  assert.ok(!/CSC_LINK|WIN_CSC|signtool|Get-AuthenticodeSignature/i.test(workflow));
});

test('the app and the Windows build both carry the updater modules', () => {
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.cjs'), 'utf8');
  assert.match(build, /'update-bundle\.cjs', 'updater-win\.cjs'/);
  assert.match(build, /process\.platform==='win32'\)copyDependency\('electron-updater'\)/);
  assert.equal(pkg.dependencies['electron-updater'], '6.8.12');
});
