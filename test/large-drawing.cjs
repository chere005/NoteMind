const { app } = require('electron'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve('test-results/large-drawing-' + Date.now());fs.mkdirSync(root, { recursive: true });process.env.NOTEMIND_DATA = root;app.disableHardwareAcceleration();
const sourceRoot = process.env.NOTEMIND_TEST_APP || path.resolve('src'), format = require(path.join(sourceRoot, 'notepad-format.cjs'));
const strokes = Array.from({ length: 10000 }, (_, i) => ({ colorHex: '#112233', width: 1, points: Array.from({ length: 20 }, (_, j) => ({ x: .01 + i % 100 * .009 + j * .00005, y: .01 + Math.floor(i / 100) * .009 })) }));
fs.writeFileSync(path.join(root, 'sheets.json'), JSON.stringify([{ name: 'Dense drawing', aspect: 1.5, strokes }]));
const assets = {}, panes = {}, lines = [];
for (let i = 0; i < 100; i++) { const name = 'assets/image-' + i + '.svg';assets[name] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dddddd"/><text x="10" y="30">Picture ' + i + '</text><!--' + ' '.repeat(100000) + '--></svg>').toString('base64');panes[name] = { version: 1 };lines.push('![Picture ' + i + '](' + name + ')'); }
const images = path.join(root, 'Pictures.nm');fs.writeFileSync(images, format.encode({ text: lines.join('\n\n'), assets, meta: { graphicsPanes: panes } }));
const report = { root, checks: [], metrics: {} }, pause = ms => new Promise(r => setTimeout(r, ms));let tested = false;
app.on('browser-window-created', (_, w) => { if (tested) return;tested = true;w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load', async () => {
 const js = code => w.webContents.executeJavaScript(code), check = (ok, label) => { if (!ok) throw Error(label);report.checks.push(label); };
 try {
  await pause(1500);
  report.metrics = await js(`(async()=>{
    const next=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),surface=document.querySelector('[data-tablet=surface]'),rect=surface.getBoundingClientRect();
    const pointer=(type,x,y)=>surface.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:4242,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,pressure:type==='pointerup'?0:.5,clientX:rect.left+rect.width*x,clientY:rect.top+rect.height*y}));
    const original=CanvasRenderingContext2D.prototype.stroke;window.__strokeCalls=0;CanvasRenderingContext2D.prototype.stroke=function(...args){window.__strokeCalls++;return original.apply(this,args)};
    document.querySelector('[data-bar=select]').click();pointer('pointerdown',.05,.05);pointer('pointermove',.55,.55);pointer('pointerup',.55,.55);await next();
    pointer('pointerdown',.2,.2);pointer('pointermove',.21,.2);await next();window.__strokeCalls=0;
    const times=[];for(let i=0;i<30;i++){const start=performance.now();pointer('pointermove',.21+i*.001,.2);times.push(performance.now()-start);await next()}
    const redraws=window.__strokeCalls;pointer('pointerup',.24,.2);await next();
    document.querySelector('[data-bar=pen]').click();await next();window.__strokeCalls=0;pointer('pointerdown',.95,.95);pointer('pointermove',.97,.97);pointer('pointerup',.97,.97);await next();
    const appendPaints=window.__strokeCalls;CanvasRenderingContext2D.prototype.stroke=original;
    const start=performance.now(),opened=await window.notemind.openPath(${JSON.stringify(images)});addTab(opened);await next();
    return {strokes:10000,points:200000,selectionVectorRedraws:redraws,newStrokePaintCalls:appendPaints,selectionHandlerP95:times.sort((a,b)=>a-b)[Math.floor(times.length*.95)],imageCount:document.querySelectorAll('#rich img').length,imageOpenMs:performance.now()-start,editorMarkupBytes:rich.innerHTML.length,allImagesUseBlobs:[...rich.querySelectorAll('img')].every(img=>img.src.startsWith('blob:')&&img.loading==='lazy')};
  })()`);
  check(report.metrics.selectionVectorRedraws === 0, 'moving dense selections reuses two bitmaps without repainting vector paths');
  check(report.metrics.newStrokePaintCalls <= 3, 'adding ink to 10,000 existing strokes paints only the new stroke');
  check(report.metrics.imageCount === 100 && report.metrics.allImagesUseBlobs && report.metrics.editorMarkupBytes < 100000, '100 large pictures render as compact cached previews with deferred decoding');
  await pause(700);check(JSON.parse(fs.readFileSync(path.join(root, 'sheets.json')))[0].strokes.length === 10001, 'the dense drawing remains complete after editing and autosave');
  fs.writeFileSync(path.join(root, 'large-drawing.png'), (await w.webContents.capturePage()).toPNG());report.ok = true;
 } catch (error) { report.ok = false;report.error = error.stack; }
 fs.writeFileSync('test-results/large-drawing.json', JSON.stringify(report, null, 2));console.log(JSON.stringify(report, null, 2));app.exit(report.ok ? 0 : 1);
 });
});
require(path.join(sourceRoot, 'main.cjs'));setTimeout(() => app.exit(1), 45000).unref();
