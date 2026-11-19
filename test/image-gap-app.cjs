// Hidden app check: the text cursor can be put between two adjacent inserted drawings with a real click.
// Run: node_modules/.bin/electron test/hidden-runner.cjs image-gap-app
const {app} = require('electron'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve('test-results/image-gap-app-' + Date.now());
fs.mkdirSync(root, {recursive: true});
process.env.NOTEMIND_DATA = root;
app.setPath('documents', root);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {root, checks: []};
let started = false;
app.on('browser-window-created', (_, w) => {
  if (started) return;
  started = true;
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load', async () => {
    const js = source => w.webContents.executeJavaScript(source);
    const check = (ok, name) => { if (!ok) throw Error(name); report.checks.push(name); };
    const mouse = async (x, y) => {
      w.webContents.sendInputEvent({type: 'mouseMove', x, y});
      await pause(60);
      w.webContents.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1});
      w.webContents.sendInputEvent({type: 'mouseUp', x, y, button: 'left', clickCount: 1});
      await pause(250);
    };
    const pointer = async (type, x, y) => {
      await js(`(()=>{const s=document.querySelector('[data-tablet=surface]'),r=s.getBoundingClientRect();
        s.dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerId:4242,pointerType:'mouse',button:0,
        buttons:${type === 'pointerup' ? 0 : 1},pressure:${type === 'pointerup' ? 0 : .7},
        clientX:r.left+r.width*${x},clientY:r.top+r.height*${y}}))})()`);
      await pause(40);
    };
    // What sits in the note, in order: 'pane' for an inserted drawing, the text of a paragraph, 'gap' for an open gap.
    const blocks = () => js(`[...document.querySelectorAll('#rich>*')].map(e=>e.querySelector('.graphics-pane')?'pane':
      e.querySelector('[data-editor-control="image-gap"]')?'gap':e.hasAttribute('data-editor-tail')?'tail':e.textContent)`);
    const caretBlock = () => js(`(()=>{const s=getSelection();if(!s.rangeCount)return -1;let n=s.getRangeAt(0).startContainer;
      while(n&&n.parentNode!==document.getElementById('rich'))n=n.parentNode;
      return n?[...document.getElementById('rich').children].indexOf(n):-1})()`);
    try {
      w.setContentSize(1440, 900);
      await pause(2500);
      if (await js(`document.getElementById('pane').hidden`)) await js(`document.getElementById('paneToggle').click()`);
      await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))`);
      await pause(1500);
      await pointer('pointerdown', .3, .3);
      await pointer('pointermove', .5, .4);
      await pointer('pointerup', .5, .4);
      await pause(650);
      for (let i = 0; i < 2; i++) {
        await js(`document.querySelector('[data-capture=ink]').click()`);
        await pause(1500);
      }
      // Through Markdown and back, as a saved or imported note is: the drawings have nothing between them.
      await js(`switchMode(false)`);
      await pause(400);
      await js(`switchMode(true)`);
      await pause(800);
      let order = await blocks();
      report.before = order;
      const first = order.indexOf('pane');
      check(first >= 0 && order[first + 1] === 'pane', 'Two inserted drawings are adjacent: ' + JSON.stringify(order));
      const edge = await js(`(()=>{const p=[...document.querySelectorAll('#rich .graphics-pane')],a=p[0].getBoundingClientRect(),
        b=p[1].getBoundingClientRect();return {x:a.left+a.width/2,y:(a.bottom+b.top)/2,middle:a.top+a.height/2}})()`);
      await mouse(Math.round(edge.x), Math.round(edge.y));
      order = await blocks();
      report.afterClick = order;
      check(order[first + 1] === 'gap' && order[first + 2] === 'pane', 'A click where two drawings meet opens a paragraph between them: ' + JSON.stringify(order));
      check(await caretBlock() === first + 1, 'The text cursor is in that paragraph');
      await w.webContents.insertText('between');
      await pause(400);
      order = await blocks();
      report.afterTyping = order;
      check(order[first] === 'pane' && order[first + 1] === 'between' && order[first + 2] === 'pane',
        'Typed text lands between the two drawings: ' + JSON.stringify(order));
      fs.writeFileSync(path.join(root, 'between.png'), (await w.webContents.capturePage()).toPNG());

      const assetState = () => js(`({ names: [...rich.querySelectorAll('img[data-asset]')].map(img => img.dataset.asset),
        assets: Object.keys(doc.assets), text: currentText() })`);
      const beforeDelete = await assetState();
      const center = await js(`(() => {
        const r = rich.querySelector('img[data-asset]').getBoundingClientRect();
        return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
      })()`);
      await mouse(center.x, center.y);
      check(await js(`NoteMindPicture.selected()?.dataset.asset`) === beforeDelete.names[0],
        'Clicking an image selects that image');
      w.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Backspace'});
      w.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Backspace'});
      await pause(100);
      const afterDelete = await assetState(), removed = beforeDelete.names[0];
      check(afterDelete.names.join() === beforeDelete.names[1] && afterDelete.text.includes('between') &&
        !afterDelete.assets.includes(removed) && !afterDelete.assets.includes(removed + '.json'),
      'Backspace removes the selected image and its unreferenced sidecar');
      await js(`window.dispatchEvent(new CustomEvent('notemind-command', {detail: 'undoText'}))`);
      await pause(100);
      const afterUndo = await assetState();
      check(afterUndo.names.join() === beforeDelete.names.join() && afterUndo.text === beforeDelete.text &&
        afterUndo.assets.includes(removed + '.json'), 'One undo restores the drawing, its sidecar, and the text');
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.error = error.stack;
      fs.writeFileSync(path.join(root, 'failure.png'), (await w.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync('test-results/image-gap-app.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  });
});
require(path.join(process.env.NOTEMIND_TEST_APP || path.resolve('src'), 'main.cjs'));
setTimeout(() => app.exit(1), 60000).unref();
