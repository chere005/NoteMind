// Manual hidden Electron attribution. No installed app or user data is opened.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const v8 = require('node:v8');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const graphics = require('../src/graphics-pane.js');
app.commandLine.appendSwitch('enable-precise-memory-info');
const count = Number(process.env.NOTEMIND_ATTRIBUTION_STROKES) || 2000000;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notemind-ink-attribution-'));
app.setPath('userData', path.join(root, 'profile'));
app.dock?.hide();
app.on('window-all-closed', () => {});
const output = process.env.NOTEMIND_ATTRIBUTION_REPORT || 'test-results/performance/ink-history-native-2m.json';
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtime: process.versions, count, mainHeapLimit: v8.getHeapStatistics().heap_size_limit, stages: [], samples: [], target: 1024 ** 3, passed: false };
let phase = 'fixture', window, sampling, timeout, closing = false, sourceOwnedBytes = 0;
const workerSessions = new Map(), workerLifecycle = [];
const prefix = graphics.encodeBytes({ name: 'Attribution', aspect: 1, strokes: [] });
let binary = new Uint8Array(prefix.length + count * 32);
sourceOwnedBytes = binary.byteLength;
report.fixtureBytes = sourceOwnedBytes;
binary.set(prefix);
const data = new DataView(binary.buffer);
data.setUint32(12, count, true); data.setUint32(16, count, true); data.setUint32(20, binary.length, true);
for (let i = 0, at = prefix.length; i < count; i++, at += 32) {
  binary.set([17, 34, 51, 0], at); data.setFloat64(at + 4, 2, true); data.setUint32(at + 12, 1, true);
  data.setFloat64(at + 16, (i % 2000) / 2000, true); data.setFloat64(at + 24, Math.floor(i / 2000) / 1000, true);
}
// This probe has no redundant per-stroke identity array.
buildSync({ stdin: { contents: "import {TabletPage} from './src/tablet/renderer/tabletPage';import graphics from './src/graphics-pane';import {DrawingHistoryBudget} from './src/drawing-history';import {normalizeGraphicsBytes} from './src/drawing-export';window.Perf={TabletPage,graphics,DrawingHistoryBudget,normalizeGraphicsBytes};", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(root, 'bench.js'), alias: { '@notemind/core': path.resolve('src/tablet/core.js') } });
buildSync({ entryPoints: ['src/drawing-worker.ts'], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(root, 'drawing-worker.js'), alias: { '@notemind/core': path.resolve('src/tablet/core.js') } });
fs.writeFileSync(path.join(root, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{info:()=>ipcRenderer.invoke('attribution:info'),chunk:at=>ipcRenderer.invoke('attribution:chunk',at),finish:()=>ipcRenderer.invoke('attribution:finish'),phase:(name,stats)=>ipcRenderer.invoke('attribution:phase',name,stats)});");
fs.writeFileSync(path.join(root, 'index.html'), '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; worker-src \'self\';"><script src="bench.js"></script>');
function sample() {
  const rows = app.getAppMetrics().map(row => ({ pid: row.pid, type: row.type, rss: (row.memory?.workingSetSize || 0) * 1024 }));
  const all = rows.reduce((sum, row) => sum + row.rss, 0), item = { phase, all, main: process.memoryUsage(), sourceOwnedBytes, workerSessions: [...workerSessions.values()], rows };
  report.peak = Math.max(report.peak || 0, all);
  report.samples.push(item);
  return item;
}
async function finish(code, error) {
  if (closing) return;
  closing = true; clearInterval(sampling); clearTimeout(timeout);
  report.workerLifecycle = workerLifecycle;
  if (error) report.error = String(error.stack || error);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, JSON.stringify(report, null, 2));
  window?.destroy();
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }).catch(error => { report.cleanupError=String(error); });
  console.log(JSON.stringify({ passed: report.passed, guard: report.guard, source: report.source, peak: report.peak, stages: report.stages, output }));
  app.exit(code);
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 1000, webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  window.webContents.setBackgroundThrottling(false);
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Target.attachedToTarget') {
      const worker = { sessionId: params.sessionId, ...params.targetInfo };
      workerSessions.set(params.sessionId, worker); workerLifecycle.push({ event: 'attached', phase, worker });
    } else if (method === 'Target.detachedFromTarget') {
      workerLifecycle.push({ event: 'detached', phase, sessionId: params.sessionId }); workerSessions.delete(params.sessionId);
    }
  });
  await window.webContents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  ipcMain.handle('attribution:info', () => ({ bytes: binary.byteLength, count }));
  ipcMain.handle('attribution:chunk', (event, offset) => {
    if (event.sender !== window.webContents || !Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid probe chunk.');
    return binary.slice(offset, offset + 524288);
  });
  ipcMain.handle('attribution:finish', () => { binary.buffer.transfer?.(0); binary = null; sourceOwnedBytes = 0; });
  ipcMain.handle('attribution:phase', async (event, name, stats) => {
    if (event.sender !== window.webContents) throw Error('Invalid probe sender.');
    phase = name;
    if (stats) {
      const heap = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
      const workers = await Promise.all([...workerSessions.values()].map(async worker => {
        try { return { ...worker, heap: await window.webContents.debugger.sendCommand('Runtime.getHeapUsage', {}, worker.sessionId) }; }
        catch (error) { return { ...worker, error: String(error) }; }
      }));
      if (name.endsWith('-progress')) { report.progress = { name, ...stats, heap, workers }; return; }
      report.workerLifecycle = workerLifecycle;
      report.stages.push({ name, ...stats, heap, workers, ...sample() });
      await fsp.mkdir(path.dirname(output), { recursive: true });
      await fsp.writeFile(output, JSON.stringify(report, null, 2));
    }
  });
  sampling = setInterval(() => { if (sample().all > report.target) { report.guard = { phase, limit: report.target }; void finish(1); } }, 50);
  timeout = setTimeout(() => void finish(2, Error('Attribution timeout.')), 90000);
  await window.loadFile(path.join(root, 'index.html'));
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const info=await fixture.info();let bytes=new Uint8Array(info.bytes);for(let at=0;at<bytes.length;at+=524288)bytes.set(await fixture.chunk(at),at);await fixture.finish();
    let work=0,budget=null,state=null,loaded=null,activeName='renderer-baseline',lastProgress=0;
    const memory=()=>({used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit});
    const resources=()=>budget?{total:budget.total,extra:budget.extra,ledger:{total:budget.geometry.total,extra:budget.geometry.extra,size:budget.geometry.size,capacity:budget.geometry.capacity,storageBytes:budget.geometry.storageBytes},tree:{count:state?.tree?.count||0,points:state?.tree?.pointCount||0,estimatedBytes:state?.tree?.estimatedBytes||0},current:state?.current||0,history:state?.history||0}:null;
    const pause=async()=>{await Perf.graphics.yieldTask();if(performance.now()-lastProgress>(activeName==='decode-model'?250:40)){lastProgress=performance.now();await fixture.phase(activeName+'-progress',{rendererMemory:memory(),work,resources:resources()})}};
    async function stage(name,run){activeName=name;lastProgress=0;await fixture.phase(name);let last=performance.now(),gap=0;const beat=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now},5);const start=performance.now();const value=await run();await pause();clearInterval(beat);await fixture.phase(name+'-complete',{ms:performance.now()-start,maxTimerGapMs:gap,rendererMemory:memory(),work,resources:resources(),loadedStrokes:loaded?.strokes.length||0,sourceBytes:bytes?.byteLength||0});return value;}
    await fixture.phase('renderer-baseline',{rendererMemory:memory(),sourceBytes:bytes.byteLength});const hook=globalThis.NoteMindDrawingHistory;globalThis.NoteMindDrawingHistory={...hook,primeStroke(stroke){work++;return hook.primeStroke(stroke)}};
    loaded=await stage('decode-model',async()=>{loaded=await Perf.graphics.decodeAsync(bytes,{owned:true,yieldControl:pause});return loaded});bytes=null;globalThis.NoteMindDrawingHistory=hook;
    budget=new Perf.DrawingHistoryBudget();const prime=budget.prime.bind(budget);budget.prime=stroke=>{work++;return prime(stroke)};
    work=0;state=await stage('history-state',async()=>{state=await budget.stateAsync(loaded.strokes,pause);return state});
    await stage('hold-current',()=>budget.holdAsync(state,'current',1,pause));
    await stage('hold-history',()=>budget.holdAsync(state,'history',1,pause));
    await stage('release-history',()=>budget.holdAsync(state,'history',-1,pause));
    await stage('release-current',()=>budget.holdAsync(state,'current',-1,pause));
    return {resources:resources(),count:loaded.strokes.length};
  })()`);
  report.result = result;
  if (result.count !== count || result.resources.total || result.resources.extra || result.resources.ledger.size || result.resources.ledger.storageBytes) throw Error('Incomplete staged geometry or resource release.');
  if (report.peak > report.target) { report.guard = { phase, limit: report.target }; throw Error('Combined owned app memory exceeded the staged target.'); }
  report.passed = true; await finish(0);
}).catch(error => void finish(1, error));
