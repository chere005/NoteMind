'use strict';
// Signs the NoteMind Mac app inside-out: every Mach-O file, then every bundle that holds them, then the app.
// A Developer ID signature gets the hardened runtime and a secure timestamp, which notarization requires; without a
// Developer ID (or with NOTEMIND_CODESIGN_IDENTITY=-) the app is signed ad hoc and cannot be released.
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ENTITLEMENTS = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
const BUNDLE_SUFFIX = /\.(?:app|framework|xpc)$/;
const NAMESPACE = /^com\.seancheren\.notemind(?:\.preview)?$/;
const MACH_O_MAGIC = new Set(['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface']);
const FAT_MAGIC = new Set(['cafebabe', 'bebafeca']);

/** The ten-character Apple team id at the end of an identity name such as "Developer ID Application: Name (TEAMID0000)". */
const teamOf = identity => /\(([A-Z0-9]{10})\)\s*$/.exec(String(identity || ''))?.[1] ?? null;

/**
 * The identity to sign with, as a full name (never a hash). NOTEMIND_CODESIGN_IDENTITY wins ("-" is ad hoc). Otherwise the
 * keychain must hold exactly one Developer ID Application identity; several coexist with Apple Development and local ones,
 * so only that class is considered, and two Developer ID identities are an error rather than a guess. The name is not kept in
 * this public repository, because it carries the owner's Apple team id.
 */
function resolveIdentity({ env, execFileSync, warn }) {
  const requested = env.NOTEMIND_CODESIGN_IDENTITY?.trim();
  if (requested === '-') return '-';
  if (requested) return requested;
  try {
    const listed = String(execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }));
    const names = [...new Set([...listed.matchAll(/"(Developer ID Application:[^"]+)"/g)].map(match => match[1]))];
    if (names.length === 1) return names[0];
    if (names.length > 1) throw Error(`The keychain holds ${names.length} Developer ID Application identities; set NOTEMIND_CODESIGN_IDENTITY to the full name of one.`);
    warn('No Developer ID Application identity is in the keychain.');
  } catch (error) {
    if (/Developer ID Application identities/.test(error.message)) throw error;
    warn('Could not list the local signing identities: ' + error.message);
  }
  return '-';
}

/** 'Contents/Frameworks/Electron Helper (GPU).app' -> 'Electron-Helper-GPU': the stable identifier suffix of a bundle. */
const bundleRole = parts => {
  const inside = parts.slice(parts.indexOf('Frameworks') + 1);
  return inside.map(part => identifierPart(part.replace(BUNDLE_SUFFIX, ''))).filter(Boolean).join('.');
};

const identifierPart = name => name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** Where a bundle's own executable lives; the bundle's signature covers it, so it is not signed on its own. */
function isBundleExecutable(relativeParts) {
  const bundleIndex = relativeParts.findLastIndex(part => BUNDLE_SUFFIX.test(part));
  if (bundleIndex === -1) return relativeParts.length === 3 && relativeParts[0] === 'Contents' && relativeParts[1] === 'MacOS';
  const rest = relativeParts.slice(bundleIndex + 1);
  const name = relativeParts[bundleIndex];
  if (/\.framework$/.test(name)) return rest.length === 3 && rest[0] === 'Versions' && rest[2] === name.replace(/\.framework$/, '');
  return rest.length === 3 && rest[0] === 'Contents' && rest[1] === 'MacOS';
}

function readMagic(file, fileSystem) {
  if (fileSystem.magic) return fileSystem.magic(file);
  const fd = fileSystem.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(4);
    return fileSystem.readSync(fd, buffer, 0, 4, 0) === 4 ? buffer.toString('hex') : '';
  } finally {
    fileSystem.closeSync(fd);
  }
}

/**
 * Everything that needs its own signature, deepest first: {file, kind: 'binary' | 'bundle', parts}.
 * Symlinks are never followed, so a framework's Versions/Current alias does not show up twice.
 */
function signables(bundle, { execFileSync, fileSystem }) {
  const found = [];
  const walk = folder => {
    let entries;
    try {
      entries = fileSystem.readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      const parts = path.relative(bundle, file).split(path.sep);
      if (entry.isDirectory()) {
        walk(file);
        if (BUNDLE_SUFFIX.test(entry.name)) found.push({ file, kind: 'bundle', parts });
      } else if (!isBundleExecutable(parts)) {
        const magic = readMagic(file, fileSystem);
        let machO = MACH_O_MAGIC.has(magic);
        if (!machO && FAT_MAGIC.has(magic)) {
          try {
            execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' });
            machO = true;
          } catch { /* a Java class file, not a universal binary */ }
        }
        if (machO) found.push({ file, kind: 'binary', parts });
      }
    }
  };
  walk(bundle);
  return found.sort((a, b) => b.parts.length - a.parts.length);
}

/** Apple Silicon only: every Mach-O in the app, including each bundle's executable, must be a thin arm64 file. */
function assertArm64(bundle, { execFileSync, fileSystem }) {
  const files = [];
  const walk = folder => {
    for (const entry of fileSystem.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const magic = readMagic(file, fileSystem);
        if (MACH_O_MAGIC.has(magic) || FAT_MAGIC.has(magic)) files.push(file);
      }
    }
  };
  walk(bundle);
  for (const file of files) {
    let archs;
    try {
      archs = String(execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' })).trim();
    } catch { continue; }
    if (archs !== 'arm64') throw Error(`NoteMind is Apple Silicon only, but ${path.relative(bundle, file)} is ${archs || 'not arm64'}.`);
  }
  return files.length;
}

function signMacApp(bundle, { execFileSync = cp.execFileSync, env = process.env, platform = process.platform, warn = console.warn, fileSystem = fs, entitlements = ENTITLEMENTS } = {}) {
  if (platform !== 'darwin') throw Error('Mac application signing requires macOS.');
  const identity = resolveIdentity({ env, execFileSync, warn });
  const adhoc = identity === '-';
  if (adhoc) warn('WARNING: NoteMind is using ad hoc signing; macOS privacy permissions may not survive app updates and the build cannot be released. Install the Developer ID certificate or set NOTEMIND_CODESIGN_IDENTITY.');
  const secureTimestamp = !adhoc && env.NOTEMIND_SIGN_TIMESTAMP !== 'none';
  const namespace = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  if (!NAMESPACE.test(namespace)) throw Error('Unexpected NoteMind bundle identifier: ' + namespace);
  assertArm64(bundle, { execFileSync, fileSystem });

  const sign = (file, identifier, { withEntitlements = false } = {}) => {
    const args = ['--force', '--sign', identity, '--identifier', identifier, '--options', 'runtime', secureTimestamp ? '--timestamp' : '--timestamp=none'];
    if (withEntitlements) args.push('--entitlements', entitlements);
    args.push(file);
    execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });
  };
  for (const { file, kind, parts } of signables(bundle, { execFileSync, fileSystem })) {
    const name = parts.at(-1);
    if (kind === 'binary') sign(file, `${namespace}.${identifierPart(name)}`);
    else sign(file, `${namespace}.runtime.${bundleRole(parts)}`, { withEntitlements: name.endsWith('.app') });
  }
  sign(bundle, namespace, { withEntitlements: true });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  return { identity, team: teamOf(identity), namespace, adhoc, secureTimestamp };
}

/** Every signature in the app, read back: Developer ID, this team, hardened runtime, secure timestamp. Throws with a list. */
function auditMacSignature(bundle, { spawn = cp.spawnSync, execFileSync = cp.execFileSync, fileSystem = fs, team } = {}) {
  if (!/^[A-Z0-9]{10}$/.test(team || '')) throw Error('auditMacSignature needs the signing team id.');
  const problems = [];
  const targets = [bundle, ...signables(bundle, { execFileSync, fileSystem }).map(item => item.file)];
  for (const file of targets) {
    const label = path.relative(bundle, file) || 'NoteMind.app';
    const verified = spawn('/usr/bin/codesign', ['--verify', '--strict', file], { encoding: 'utf8' });
    if (verified.status !== 0) {
      problems.push(`${label}: ${String(verified.stderr || 'signature does not verify').trim().split('\n')[0]}`);
      continue;
    }
    // codesign -d writes what it found to stderr.
    const shown = spawn('/usr/bin/codesign', ['-dvv', file], { encoding: 'utf8' });
    const details = `${shown.stdout || ''}${shown.stderr || ''}`;
    if (!/^Authority=Developer ID Application:/m.test(details)) problems.push(`${label}: not signed by a Developer ID Application identity`);
    if (!new RegExp(`^TeamIdentifier=${team}$`, 'm').test(details)) problems.push(`${label}: TeamIdentifier is not ${team}`);
    if (!/flags=0x[0-9a-f]+\([^)]*runtime/.test(details)) problems.push(`${label}: hardened runtime is off`);
    if (!/^Timestamp=/m.test(details)) problems.push(`${label}: no secure timestamp`);
  }
  if (problems.length) throw Error('NoteMind signature audit failed:\n  ' + problems.join('\n  '));
  return targets.length;
}

module.exports = { signMacApp, auditMacSignature, signables, assertArm64, resolveIdentity, teamOf, ENTITLEMENTS };
