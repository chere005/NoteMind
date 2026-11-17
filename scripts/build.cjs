const fs = require('node:fs');
const cp = require('node:child_process');
const { validateMacTarget } = require('./mac-target.cjs');
if (process.platform === 'darwin') {
  const executable = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
  const arch = fs.existsSync(executable) ? cp.execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }) : null;
  validateMacTarget(process.platform, process.arch, arch);
}
require('./notices.cjs');
if (process.platform === 'darwin') {
  fs.mkdirSync('src/helpers', { recursive: true });
  cp.execFileSync('swiftc', ['-O', '-target', 'arm64-apple-macos13.0', '-o', 'src/helpers/wm-pen', 'tools/pen/wm-pen.swift', '-framework', 'IOKit'], { stdio: 'inherit' });
  cp.execFileSync('swiftc', ['-O', '-target', 'arm64-apple-macos13.0', '-o', 'src/helpers/wm-pen-display', 'tools/pen/wm-pen-display.swift', '-framework', 'IOKit'], { stdio: 'inherit' });
}
cp.execFileSync(process.execPath, ['scripts/build-documents.cjs'], { stdio: 'inherit' });
cp.execFileSync(process.execPath, ['scripts/build-tablet.cjs'], { stdio: 'inherit' });
cp.execFileSync(require('electron'), ['scripts/build-icon.cjs'], { stdio: 'inherit',windowsHide:true });
fs.mkdirSync('dist', { recursive: true });
for (const file of ['archive-assets.cjs','archive-codec.cjs','archive-limits.cjs','archive-worker.cjs','document-asset-sessions.cjs','document-sync.js','drawing-export.js','drawing-history.js','hydrate-sheet-state.js','load-sheet-state.js','sheet-load-transport.cjs','stroke-bounds.js','native-file-lock.cjs','print-preview.cjs','sheet-persistence-worker.cjs','sheet-persistence.cjs','sheet-revision.cjs','sheet-save-queue.js','sheet-store.cjs','sheet-pack-store.cjs','sheet-pack-lock.cjs','sheet-staging.cjs','sheet-order-index.cjs','sheet-geometry.cjs','sheet-schema.cjs','sheet-json-tokens.cjs','sheet-legacy-reader.cjs','sheet-compaction.cjs','sheet-lazy-loader.js','sheet-model-cache.js','snapshot-store.cjs','stroke-signature.js','recovery-commit.cjs','version-publisher.cjs']) {
  cp.execFileSync(process.execPath, ['--check', `src/${file}`], { stdio: 'inherit' });
}
for (const file of ['main.cjs', 'features.cjs', 'workspaces.cjs', 'file-actions.cjs', 'ui.js', 'preload.cjs', 'renderer.js', 'graphics-pane.js', 'image-previews.js', 'workspace-ui.js', 'shell.js', 'sidebar-order.js', 'python.cjs', 'zip.cjs','notes-core.js','notes-history.js','notes-writing.js','notes-code.js','syntax-highlighter.cjs','notes-tables.js','notes-styles.js','notes-format.js','notes-clipboard.js','picture-geometry.js','notes-picture.js','notes-footer.js','notes-pdf.js','notes-help.js','shortcuts.cjs','quick-reference.cjs','welcome-note.cjs','pdf-options.cjs','print-images.cjs','input-monitoring.cjs','pad-display.cjs','pad-controller.cjs','pad-ownership.cjs','notes-structure.js','notes-tabs.js','keys.cjs','projectfile.cjs','projects.cjs','recents.cjs','notes-find.js','notes-library.js','notes-attachments.js','notes-store.cjs','notes-ipc.cjs','markdown-files.cjs','markdown-reference-rewrite.js','index-images.cjs','read-limited.cjs','guarded-write.cjs','path-key.cjs','tiff-images.cjs']) {
  cp.execFileSync(process.execPath, ['--check', `src/${file}`], { stdio: 'inherit' });
}
fs.cpSync('src', 'dist', { recursive: true });
const runtime = 'node_modules/electron/dist';
if (fs.existsSync(runtime)) {
  const runtimeEntry = process.platform === 'darwin' ? 'dist/NoteMind/NoteMind.app' : process.platform === 'win32' ? 'dist/NoteMind/electron.exe' : 'dist/NoteMind/electron';
  if(process.platform==='darwin'){fs.rmSync(runtimeEntry,{recursive:true,force:true});fs.cpSync(runtime, 'dist/NoteMind', {recursive:true,verbatimSymlinks:true});fs.renameSync('dist/NoteMind/Electron.app',runtimeEntry);}
  else if(!fs.existsSync(runtimeEntry))fs.cpSync(runtime, 'dist/NoteMind', {recursive:true,verbatimSymlinks:true});
  const appDir = process.platform === 'darwin' ? 'dist/NoteMind/NoteMind.app/Contents/Resources/app' : 'dist/NoteMind/resources/app';
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync('src', `${appDir}/src`, { recursive: true });
  fs.copyFileSync('package.json', `${appDir}/package.json`);
  fs.copyFileSync('LICENSE', `${appDir}/LICENSE`);
  fs.copyFileSync('THIRD-PARTY-NOTICES.txt', `${appDir}/THIRD-PARTY-NOTICES.txt`);
  for (const name of ['koffi', '@koromix']) if (fs.existsSync(`node_modules/${name}`) && !fs.existsSync(`${appDir}/node_modules/${name}`)) fs.cpSync(`node_modules/${name}`, `${appDir}/node_modules/${name}`, { recursive: true });
  const dependencies=new Set();function copyDependency(name,from=process.cwd()){if(name.startsWith("@types/")||require("node:module").isBuiltin(name))return;const {root:folder,pkg}=require('./package-root.cjs')(name,from);if(dependencies.has(pkg.name))return;dependencies.add(pkg.name);fs.cpSync(folder,`${appDir}/node_modules/${pkg.name}`,{recursive:true});for(const child of Object.keys(pkg.dependencies||{}))copyDependency(child,folder);}
  for(const name of ['docx','mammoth','markdown-it','turndown','turndown-plugin-gfm','image-size','highlight.js','utif','stream-json'])copyDependency(name);
  if (process.platform === 'win32' && !fs.existsSync('dist/NoteMind/NoteMind.exe')) fs.copyFileSync('dist/NoteMind/electron.exe', 'dist/NoteMind/NoteMind.exe');
  if(process.platform==='win32')cp.execFileSync(process.execPath,['scripts/stamp-icon.cjs'],{stdio:'inherit',windowsHide:true});
  if(process.platform==='darwin')cp.execFileSync(process.execPath,['scripts/package-mac.cjs'],{stdio:'inherit'});
  console.log('Built the portable application in dist/NoteMind.');
} else console.log('Built application files in dist. Install dependencies to build the portable app.');
