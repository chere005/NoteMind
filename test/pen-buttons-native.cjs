// Hidden app check of the pen buttons' contract (docs/PEN-BUTTONS.md) the way a Wacom pen display delivers it: the display's own
// button reports (pen:buttons-push) and contact points (pen:contact-point), which the sheet turns into pen events, not driver pointer
// events. Wrapped by test/pen-buttons-native.test.cjs so `npm test` runs it.
// Run: node_modules/.bin/electron test/hidden-runner.cjs pen-buttons-native
const {app} = require('electron'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve('test-results/pen-buttons-native-' + Date.now());
fs.mkdirSync(root, {recursive: true});
process.env.NOTEMIND_DATA = root;
app.setPath('documents', root);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {root, checks: []};
let started = false;
const TIP = 1, LOWER = 2, UPPER = 4;
app.on('browser-window-created', (_, w) => {
  if (started) return;
  started = true;
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load', async () => {
    const js = source => w.webContents.executeJavaScript(source);
    const check = (ok, name) => { if (!ok) throw Error(name); report.checks.push(name); };
    const rect = () => js(`(()=>{const r=document.querySelector('[data-tablet=surface]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    let surfaceRect = null;
    // What the display reports: the pen near, its side buttons and its tip (the helper's lines, main's pen:buttons-push).
    let reported = {present: true, range: true, tip: false, lower: false, upper: false, contactPosition: true};
    const reportPen = async patch => { reported = {...reported, ...patch}; w.webContents.send('pen:buttons-push', reported); await pause(25); };
    const contact = async (start, x, y, buttons) => {
      w.webContents.send('pen:contact-point', {clientX: surfaceRect.left + surfaceRect.width * x, clientY: surfaceRect.top + surfaceRect.height * y,
        pad: false, start, buttons: buttons | TIP, pressure: 0.5, tiltX: 0, tiltY: 0});
      await pause(30);
    };
    const sides = buttons => ({lower: (buttons & LOWER) !== 0, upper: (buttons & UPPER) !== 0});
    // What the Wacom driver sends the page for the same pen, beside the display's reports, as Sean's Wacom One 12 is set up
    // (Wacom Center: bottom button Right Click, top button Pan/Scroll):
    //  - the plain tip: pen events where the pen is;
    //  - the bottom button: a right click as a pen press of button 2 with pressure 1 while the pen only hovers, the same as a mouse
    //    right click at the pen, then pen moves that carry the button and, once the tip touches, the tip and a pressure;
    //  - the top button: the pointer frozen where the button went down, a touch reported THERE when the tip touches, the pen's
    //    movement turned into a wheel at that point, nothing where the pen really is.
    const driver = (type, x, y, button, buttons, pressure, pointerType = 'pen') => js(`(()=>{const s=document.querySelector('[data-tablet=surface]'),
      r=s.getBoundingClientRect(),at={clientX:r.left+r.width*${x},clientY:r.top+r.height*${y}};
      s.dispatchEvent('${type}'==='wheel'?new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:24,...at})
        :new PointerEvent('${type}',{bubbles:true,cancelable:true,pointerId:${pointerType === 'pen' ? 7 : 1},pointerType:'${pointerType}',isPrimary:true,button:${button},
          buttons:${buttons},pressure:${pressure},...at}))})()`);
    let frozen = null, rightHeld = false;
    const echo = async (phase, x, y, buttons) => {
      if (buttons & UPPER) {
        frozen = frozen ?? [x, y];
        const [fx, fy] = frozen;
        if (phase === 'down') await driver('pointerdown', fx, fy, 0, TIP | UPPER, 0.6);
        else if (phase === 'move') { await driver('pointermove', fx, fy, -1, TIP | UPPER, 0.6); await driver('wheel', fx, fy, 0, 0, 0); await driver('wheel', x, y, 0, 0, 0); }
        else if (phase === 'up') await driver('pointerup', fx, fy, 0, UPPER, 0);
        else await driver('pointermove', fx, fy, -1, UPPER, 0);
        return;
      }
      frozen = null;
      if (buttons & LOWER) {
        if (!rightHeld) { rightHeld = true; await driver('pointerdown', x, y, 2, LOWER, 1); await driver('pointerdown', x, y, 2, LOWER, 1, 'mouse'); await driver('pointerup', x, y, 2, 0, 0, 'mouse'); }
        const touching = phase === 'down' || phase === 'move';
        await driver('pointermove', x, y, -1, LOWER | (touching ? TIP : 0), touching ? 0.6 : 1);
        return;
      }
      if (rightHeld) { rightHeld = false; await driver('pointerup', x, y, 2, 0, 0); }
      if (phase === 'hover') return;
      await driver(phase === 'down' ? 'pointerdown' : phase === 'up' ? 'pointerup' : 'pointermove', x, y, phase === 'move' ? -1 : 0, phase === 'up' ? 0 : TIP, phase === 'up' ? 0 : 0.5);
    };
    const hover = async (x, y, buttons) => { await reportPen({tip: false, ...sides(buttons)}); await echo('hover', x, y, buttons); };
    // The driver's event for a touch can reach the page before the display's report of it: that order is the one played here.
    const down = async (x, y, buttons) => { await echo('down', x, y, buttons); await reportPen({tip: true, ...sides(buttons)}); await contact(true, x, y, buttons); await pause(20); };
    const move = async (x, y, buttons) => { await echo('move', x, y, buttons); await contact(false, x, y, buttons); };
    const up = async (x, y, buttons) => { await echo('up', x, y, buttons); await reportPen({tip: false, ...sides(buttons)}); await pause(700); };
    // Timed button sequences: the presses and releases the display reports, with the gaps between them.
    const play = async steps => { for (const [, , buttons, wait] of steps) { await reportPen({tip: false, ...sides(buttons)}); await pause(wait); } };
    const tapSteps = (button, x = 0.5, y = 0.5) => [[x, y, button, 70], [x, y, 0, 10]];
    const tap = (button, x, y) => play(tapSteps(button, x, y));
    const doubleTap = async button => { await play([...tapSteps(button), [0.5, 0.5, 0, 90], ...tapSteps(button)]); await pause(300); };
    const arm = (first, second) => play([...tapSteps(first), [0.5, 0.5, 0, 90], [0.5, 0.5, second, 20]]);
    const strokes = () => js(`(()=>{const host=document.querySelector('[data-tablet=host]'),
      key=Object.getOwnPropertyNames(host).find(name=>name.startsWith('__reactFiber'));let fiber=host[key];
      while(fiber&&!fiber.memoizedProps?.page?.strokes)fiber=fiber.return;
      return fiber.memoizedProps.page.strokes.map(s=>({y:s.points[0].y,x:s.points[Math.floor(s.points.length/2)].x,count:s.points.length}))})()`);
    const view = () => js(`(()=>{const s=document.querySelector('[data-tablet=surface]');
      return {zoom:Number(s.dataset.precisionZoom),viewport:JSON.parse(s.dataset.sheetViewport)}})()`);
    const selected = () => js(`!!document.querySelector('[data-ink-selection=outline]')`);
    const write = async y => {
      await down(0.2, y, 0);
      for (const x of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) await move(x, y, 0);
      await up(0.8, y, 0);
    };
    try {
      w.setContentSize(1440, 900);
      await pause(2500);
      if (await js(`document.getElementById('pane').hidden`)) await js(`document.getElementById('paneToggle').click()`);
      await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))`);
      await pause(1500);

      await js(`document.hasFocus=()=>true;window.dispatchEvent(new Event('focus'))`);
      surfaceRect = await rect();
      await reportPen({});
      await pause(300);
      await write(0.3);
      await write(0.6);
      const drawn = await strokes();
      const fitted = await view();
      check((await strokes()).length === 2, 'The plain tip writes two strokes, each once, with the driver\'s events and the display\'s reports both arriving');
      check(drawn.every(stroke => stroke.count >= 6), 'A plain stroke has every sample the driver sent');

      // Bottom button: delete on tap, only when the tip touches.
      // The driver's right click for the button reaches the page before the display's report of it, with a pressure (0.5 or 1),
      // and then follows the hovering pen: that is the button, not a touch.
      for (const pressure of [0.5, 1]) {
        await driver('pointerdown', 0.25, 0.3, 2, LOWER, pressure);
        for (const x of [0.3, 0.5, 0.7]) await driver('pointermove', x, 0.3, -1, LOWER, pressure);
        await driver('pointerup', 0.7, 0.3, 2, 0, 0);
      }
      check((await strokes()).length === 2, 'Bottom button pressed while hovering, the driver\'s click arriving first: nothing is erased and nothing is drawn');
      for (const x of [0.3, 0.5, 0.7]) await hover(x, 0.3, LOWER);
      check((await strokes()).length === 2, 'Bottom button held while hovering over ink, with the driver\'s right click: nothing is erased');
      await hover(0.7, 0.3, 0);
      await down(0.5, 0.3, LOWER);
      await up(0.5, 0.3, LOWER);
      await hover(0.5, 0.3, 0, 100);
      let now = await strokes();
      check(now.length === 1 && Math.abs(now[0].y - drawn[1].y) < 1e-9, 'Bottom button held, tip tapped on a stroke: that stroke (and only it) is deleted');
      // The same touch away from any ink: the driver's right click draws nothing and deletes nothing.
      await down(0.5, 0.9, LOWER);
      await move(0.6, 0.9, LOWER);
      await up(0.6, 0.9, LOWER);
      await hover(0.6, 0.9, 0, 100);
      check((await strokes()).length === 1, 'Bottom button held, tip dragged over empty paper: nothing is drawn and nothing else is deleted');

      // Bottom button double-tap: Undo. Top button double-tap: Redo.
      await doubleTap(LOWER);
      check((await strokes()).length === 2, 'Bottom button double-tap is Undo: the deleted stroke is back');
      await doubleTap(UPPER);
      check((await strokes()).length === 1, 'Top button double-tap is Redo: the stroke is deleted again');
      await doubleTap(LOWER);
      check((await strokes()).length === 2, 'Undo once more, ready for the next steps');

      // Top button: hold and tap-and-drag makes a selection box; hovering with it held selects nothing.
      for (const x of [0.2, 0.5]) await hover(x, 0.6, UPPER);
      check(!(await selected()), 'Top button held while hovering selects nothing');
      await down(0.1, 0.5, UPPER);
      for (const [x, y] of [[0.3, 0.55], [0.6, 0.65], [0.9, 0.72]]) await move(x, y, UPPER);
      await up(0.9, 0.72, UPPER);
      await pause(300);
      check(await selected(), 'Top button held, tip dragged over a stroke: the stroke is selected');
      // The box follows the pen, not the pointer the driver froze where the button went down.
      const outline = await js(`(()=>{const r=document.querySelector('[data-ink-selection=outline] rect'),n=k=>Number(r.getAttribute(k))/1000;
        return {left:n('x'),right:n('x')+n('width'),top:n('y'),bottom:n('y')+n('height')}})()`);
      const near = (a, b) => Math.abs(a - b) < 0.02;
      check(near(outline.left, 0.1) && near(outline.right, 0.9) && near(outline.top, 0.5) && near(outline.bottom, 0.72),
        'The selection box is the pen\'s drag (0.1 to 0.9, 0.5 to 0.72), not the frozen pointer at 0.2, 0.6: ' + JSON.stringify(outline));
      check((await strokes()).length === 2, 'Selecting erases nothing');
      await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:'pen:clearSelection'}))`);
      await pause(300);
      check(!(await selected()), 'The selection clears');
      await hover(0.5, 0.5, 0, 100);

      // Chords. Top then bottom, held: scroll, which does nothing until the page is zoomed in.
      let before = await view();
      await arm(UPPER, LOWER);
      await down(0.5, 0.5, LOWER);
      await move(0.6, 0.6, LOWER);
      await move(0.7, 0.7, LOWER);
      await up(0.7, 0.7, LOWER);
      await hover(0.5, 0.5, 0, 100);
      let after = await view();
      check(after.zoom === before.zoom && (await strokes()).length === 2, 'Scroll chord on a page that is not zoomed in changes nothing and erases nothing');

      // Bottom then top, held: zoom. Hovering with it held zooms nothing; touching and dragging up zooms in.
      await arm(LOWER, UPPER);
      for (const y of [0.5, 0.4, 0.3]) await hover(0.5, y, UPPER);
      check((await view()).zoom === before.zoom, 'Zoom chord while hovering zooms nothing');
      await down(0.5, 0.5, UPPER);
      for (const y of [0.45, 0.4, 0.35, 0.3, 0.25]) await move(0.5, y, UPPER);
      await up(0.5, 0.25, UPPER);
      const zoomed = await view();
      check(zoomed.zoom > before.zoom * 1.3, 'Zoom chord, tip dragged up: zoomed in (' + before.zoom + ' to ' + zoomed.zoom + ')');
      check((await strokes()).length === 2, 'Zooming selects and erases nothing');
      await down(0.5, 0.3, UPPER);
      for (const y of [0.35, 0.4, 0.45, 0.5, 0.55]) await move(0.5, y, UPPER);
      await up(0.5, 0.55, UPPER);
      const back = await view();
      check(back.zoom < zoomed.zoom, 'A second drag in the same hold, tip dragged down: zoomed out (' + zoomed.zoom + ' to ' + back.zoom + ')');
      await down(0.5, 0.3, UPPER);
      for (const y of [0.25, 0.2, 0.15, 0.1]) await move(0.5, y, UPPER);
      await up(0.5, 0.1, UPPER);
      const zoomedAgain = await view();
      await hover(0.5, 0.5, 0, 100);
      check(zoomedAgain.zoom > 1.3, 'Zoomed in again for the scroll check');

      // Top then bottom, held, on a zoomed page: scroll moves the view.
      before = await view();
      await arm(UPPER, LOWER);
      await down(0.5, 0.5, LOWER);
      for (const [x, y] of [[0.55, 0.55], [0.6, 0.6], [0.65, 0.65]]) await move(x, y, LOWER);
      await up(0.65, 0.65, LOWER);
      await hover(0.5, 0.5, 0, 100);
      after = await view();
      check(Math.abs(after.viewport.x - before.viewport.x) > 1e-4 || Math.abs(after.viewport.y - before.viewport.y) > 1e-4,
        'Scroll chord on a zoomed page moves the view');
      check(after.zoom === before.zoom && (await strokes()).length === 2, 'Scrolling changes no zoom and erases nothing');

      // After a chord the buttons are the buttons again: aim at where the first stroke is on screen now (the view is zoomed and moved).
      const where = async index => {
        const stroke = (await strokes())[index], {viewport} = await view();
        return [(stroke.x - viewport.x) / viewport.width, (stroke.y - viewport.y) / viewport.height];
      };
      const [fx, fy] = await where(0);
      check(fx > 0 && fx < 1 && fy > 0 && fy < 1, 'The first stroke is on screen after the chords: ' + [fx, fy]);
      await down(fx, fy, LOWER);
      await up(fx, fy, LOWER);
      await hover(fx, fy, 0, 100);
      check((await strokes()).length === 1, 'After the chord, the bottom button held and tapped deletes again');
      await doubleTap(LOWER);
      check((await strokes()).length === 2, 'After the chord, the bottom button double-tap is still Undo');
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.error = error.stack;
      try { fs.writeFileSync(path.join(root, 'failure.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* none */ }
    }
    fs.writeFileSync('test-results/pen-buttons-native.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  });
});
require(path.join(process.env.NOTEMIND_TEST_APP || path.resolve('src'), 'main.cjs'));
setTimeout(() => app.exit(1), 150000).unref();
