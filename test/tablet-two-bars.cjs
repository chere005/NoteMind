// Hidden UI check: a drawing sheet has two bars (tabs, tools); the tool bar keeps its colours as swatches and fits a
// 380 px pane; the pen's menu holds its four kinds, its width and the presets; "Writing" brings in the ink, not the page.
// Run: node_modules/.bin/electron test/hidden-runner.cjs tablet-two-bars
const {app, nativeTheme} = require('electron'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve('test-results/tablet-two-bars-' + Date.now());
fs.mkdirSync(root, {recursive: true});
process.env.NOTEMIND_DATA = root;
app.setPath('documents', root);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {root, checks: [], shots: []};
let started = false;
app.on('browser-window-created', (_, w) => {
  if (started) return;
  started = true;
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load', async () => {
    const js = source => w.webContents.executeJavaScript(source);
    const check = (ok, name) => { if (!ok) throw Error(name); report.checks.push(name); };
    // The whole window, or only the drawing pane (`pane`: the picture is then large enough to read the bar in).
    const shot = async (name, pane = false) => {
      const file = path.join(root, name + '.png');
      const rect = pane ? await js(`(()=>{const r=document.querySelector('.tablet-pane').getBoundingClientRect();
        return {x:Math.max(0,Math.floor(r.left)-${pane === 'menu' ? 240 : 0}),y:Math.floor(r.top),
          width:Math.ceil(r.width)+${pane === 'menu' ? 240 : 0},height:Math.ceil(r.height)}})()`) : undefined;
      fs.writeFileSync(file, (await w.webContents.capturePage(rect)).toPNG());
      report.shots.push(file);
    };
    const event = (type, x, y) => js(`(()=>{const s=document.querySelector('[data-tablet=surface]'),
      r=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerId:4242,
      pointerType:'mouse',button:0,buttons:${type === 'pointerup' ? 0 : 1},pressure:${type === 'pointerup' ? 0 : .7},
      clientX:r.left+r.width*${x},clientY:r.top+r.height*${y}}))})()`);
    const pointer = async (type, x, y) => { await event(type, x, y); await pause(40); };
    const drag = async (a, b) => {
      await pointer('pointerdown', ...a);
      await pointer('pointermove', ...b);
      await pointer('pointerup', ...b);
      await pause(650);
    };
    // A stroke through many points, a few milliseconds apart, as a hand draws it. `held` runs with the pen still down.
    const write = async (points, held) => {
      await event('pointerdown', ...points[0]);
      for (const point of points.slice(1)) { await pause(6); await event('pointermove', ...point); }
      if (held) { await pause(200); await held(); }
      await event('pointerup', ...points.at(-1));
      await pause(700);
    };
    // The sheet as the window shows it (paper, ink and the layer above), and how many of its pixels two pictures differ in.
    const sheetPixels = async () => {
      const rect = await js(`(()=>{const r=document.querySelector('[data-tablet=surface]').getBoundingClientRect();
        return {x:Math.ceil(r.left),y:Math.ceil(r.top),width:Math.floor(r.width)-1,height:Math.floor(r.height)-1}})()`);
      return (await w.webContents.capturePage(rect)).toBitmap();
    };
    const differing = (a, b) => {
      let count = 0;
      for (let at = 0; at < Math.min(a.length, b.length); at += 4) {
        if (Math.abs(a[at] - b[at]) + Math.abs(a[at + 1] - b[at + 1]) + Math.abs(a[at + 2] - b[at + 2]) > 48) count++;
      }
      return count + Math.abs(a.length - b.length);
    };
    const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
      if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click()})()`);
    const escape = async () => {
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await pause(200);
    };
    const command = async id => {
      await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:${JSON.stringify(id)}}))`);
      await pause(700);
    };
    // The open sheet's strokes, read from the page the surface was given.
    const strokes = () => js(`(()=>{const host=document.querySelector('[data-tablet=host]'),
      key=Object.getOwnPropertyNames(host).find(name=>name.startsWith('__reactFiber'));let fiber=host[key];
      while(fiber&&!fiber.memoizedProps?.page?.strokes)fiber=fiber.return;
      return fiber.memoizedProps.page.strokes.map(s=>({colorHex:s.colorHex,width:s.width,count:s.points.length,
        keys:Object.keys(s).join(','),first:s.points[0],
        pressures:s.pressures?{count:s.pressures.length,low:Math.min(...s.pressures),high:Math.max(...s.pressures),
          last:s.pressures.at(-1)}:null}))})()`);
    const luminance = hex => [1, 3, 5].reduce((sum, at, index) =>
      sum + parseInt(hex.slice(at, at + 2), 16) / 255 * [.2126, .7152, .0722][index], 0);
    // One pixel of the ink canvas, at a fraction of the sheet.
    const inkAt = (x, y) => js(`(()=>{const c=document.querySelector('[data-tablet=surface] canvas.ink'),
      d=c.getContext('2d').getImageData(Math.round(c.width*${x}),Math.round(c.height*${y}),1,1).data;return [...d]})()`);
    const bars = () => js(`(()=>{const pane=document.querySelector('.tablet-pane'),bar=pane.querySelector('#pen-control');
      const visible=e=>!!e&&e.getClientRects().length>0,area=bar.getBoundingClientRect();
      // Seen and tapped: inside the bar, and what a tap at its middle (and above its dot) lands on.
      const tappable=e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2;
        return visible(e)&&r.left>=area.left&&r.right<=area.right&&document.elementFromPoint(x,r.top+r.height/2)===e
          &&document.elementFromPoint(x,r.top-4)===e};
      const swatches=[...bar.querySelectorAll('.pen-swatches .pen-swatch')];
      return {rows:[...pane.querySelectorAll(':scope>.sheet-tabs,:scope>.pen-bar,:scope>.bar-row,:scope>.camera-head')]
          .filter(visible).map(e=>e.className),
        undo:visible(bar.querySelector('[data-tablet=undo]')),insert:visible(bar.querySelector('[data-capture=ink]')),
        more:visible(pane.querySelector('.sheet-tabs [data-bar=pane-menu]')),location:!!pane.querySelector('.pen-bar .drawing-location'),
        saveButton:!!pane.querySelector('button[data-tablet=pane-save]'),clearButton:!!pane.querySelector('button[data-tablet=clear]'),
        penSplit:visible(bar.querySelector('[data-bar=pen]'))&&visible(bar.querySelector('[data-bar=pen-kinds]')),
        standard:swatches.filter(e=>!e.classList.contains('custom')&&tappable(e)).length,
        custom:swatches.some(e=>e.classList.contains('custom')&&tappable(e)),
        swatchSize:Math.min(...swatches.filter(visible).map(e=>Math.min(e.offsetWidth,e.offsetHeight))),
        colourMenu:visible(pane.querySelector('.pen-colour-menu')),
        widthSelect:visible(bar.querySelector('.pen-width-select')),presets:visible(bar.querySelector('[data-bar=tool-presets]')),
        paper:visible(bar.querySelector('[data-tablet=paper]')),
        order:[...bar.querySelectorAll('[data-bar],[data-tablet],[data-capture],.pen-swatches')].filter(visible)
          .map(e=>e.classList.contains('pen-swatches')?'swatches':e.dataset.bar||e.dataset.tablet||e.dataset.capture),
        parts:[...bar.children,...(bar.querySelector('.pen-trailing')?.children||[])].filter(visible)
          .map(e=>(e.dataset.bar||e.dataset.tablet||e.className||e.tagName).toString().split(' ').pop()+':'
            +Math.round(e.getBoundingClientRect().width*10)/10),
        splits:[...bar.querySelectorAll('.bar-split')].map(e=>[...e.children].map(c=>Math.round(c.getBoundingClientRect().width*10)/10)),
        overflow:bar.scrollWidth-bar.clientWidth,width:bar.clientWidth}})()`);
    const fits = (state, where) => {
      check(state.overflow <= 0, `The tool bar fits ${where} without scrolling: ` + JSON.stringify(state));
      check(state.penSplit, `The pen is a split button ${where}`);
      check(state.standard >= 5, `At least five standard colours are swatches to tap ${where}: ` + state.standard);
      check(state.swatchSize >= 18, `Swatches are at least 18 px ${where}: ` + state.swatchSize);
      check(!state.colourMenu, `No colour menu button ${where}`);
      check(state.undo && state.insert && state.more, `Undo and Insert are on the pen bar and options are on the tabs bar ${where}`);
    };
    // A tap on a swatch makes it the pen's colour.
    const tap = async name => {
      await click(`#pen-control .pen-swatch[aria-label="${name}"]`);
      await pause(150);
      return js(`(()=>{const e=document.querySelector('#pen-control .pen-swatch[aria-label="${name}"]');
        return {pressed:e.getAttribute('aria-pressed'),colour:localStorage.getItem('notemind.penColour'),
          own:getComputedStyle(e).backgroundColor}})()`);
    };
    const openPenMenu = async () => {
      await click('[data-bar=pen-kinds]');
      await pause(350);
      return js(`(()=>{const menu=document.querySelector('.float-menu'),r=menu.getBoundingClientRect();
        return {kinds:[...menu.querySelectorAll('[data-bar^=pen-kind-]')].map(e=>({bar:e.dataset.bar,
            label:e.querySelector('.float-label').textContent,checked:e.getAttribute('aria-checked'),disabled:e.disabled,
            icon:!!e.querySelector('.float-icon svg')})),
          widths:[...menu.querySelectorAll('[data-pen-width]')].map(e=>Number(e.dataset.penWidth)),
          presets:!!menu.querySelector('[data-bar=pen-presets]'),
          inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&menu.scrollHeight<=menu.clientHeight+1}})()`);
    };
    const choose = async kind => {
      await openPenMenu();
      await click(`.float-menu [data-bar=pen-kind-${kind}]`);
      await pause(250);
      return js(`document.querySelector('[data-bar=pen]').dataset.penKind`);
    };
    try {
      w.setContentSize(1440, 900);
      await pause(2500);
      if (await js(`document.getElementById('pane').hidden`)) await js(`document.getElementById('paneToggle').click()`);
      await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))`);
      await pause(1500);
      let state = await bars();
      report.wide = state;
      check(state.rows.length === 2, 'A drawing sheet shows exactly two bars: ' + JSON.stringify(state.rows));
      check(!state.location, 'The Wacom screen switch is not a button on the tool bar');
      check(!state.saveButton && !state.clearButton, 'Save and Clear are menu rows, not bar buttons');
      fits(state, 'at the default width');
      check(state.standard === 6 && state.custom, 'All six colours and the custom colour show at the default width');

      await drag([.3, .3], [.5, .4]);
      await shot('dark-sheet');
      await shot('dark-bar-default', true);
      await click('[data-bar=pane-menu]');
      await pause(400);
      const rows = await js(`[...document.querySelectorAll('.float-menu [data-bar]')].map(e=>e.dataset.bar)`);
      report.optionRows = rows;
      check(rows.includes('pane-save') && rows.includes('clear'), 'The options menu holds Save Sheet and Clear the Sheet: ' + rows);
      check(rows.includes('pane-paper') && rows.includes('pane-orientation'),
        'The options menu holds Paper and Tablet Orientation: ' + rows);
      await shot('dark-options-menu');
      await escape();
      await click('[data-bar=video-menu]');
      await pause(400);
      const sourceRows = await js(`[...document.querySelectorAll('.float-menu [data-bar]')].map(e=>e.dataset.bar)`);
      check(sourceRows.includes('video-wacom'), 'The capture source menu holds Use Wacom Screen: ' + sourceRows);
      await shot('dark-source-menu');
      await escape();

      // "Writing" with nothing boxed: the ink and a margin, not the visible page.
      const before = await js(`document.querySelectorAll('#rich img[data-asset]').length`);
      const sheet = await js(`(()=>{const s=document.querySelector('[data-tablet=surface]'),r=s.getBoundingClientRect(),
        v=JSON.parse(s.dataset.sheetViewport);return {aspect:r.width/r.height*v.height/v.width,shown:r.width/r.height,view:v}})()`);
      await click('[data-capture=ink]');
      await pause(1800);
      const image = await js(`(async()=>{const all=document.querySelectorAll('#rich img[data-asset]'),img=all[all.length-1];
        if(!img)return null;if(!img.complete)await new Promise(r=>{img.onload=img.onerror=r});
        const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
        const context=canvas.getContext('2d');context.drawImage(img,0,0,100,100);
        const pixels=context.getImageData(0,0,100,100).data;
        const frame=img.closest('.graphics-pane'),style=getComputedStyle(frame);
        return {count:all.length,ratio:img.naturalWidth/img.naturalHeight,asset:img.dataset.asset,
          clearCorner:pixels[3]===0,hasInk:pixels.some((value,index)=>index%4===3&&value>0),
          frameFree:style.borderTopWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)'}})()`);
      report.sheet = sheet;
      report.image = image;
      check(image && image.count === before + 1, 'Insert put one drawing in the note');
      check(image.clearCorner && image.hasInk && image.frameFree, 'Writing floats on the note with transparent margins');
      // The page's full width; the stroke's .1 of the VIEW's height plus a margin of 2% of the page's width above and below.
      const expected = 1 / ((.1 * sheet.view.height + .04 * sheet.aspect) / sheet.aspect);
      check(Math.abs(image.ratio / expected - 1) < .12,
        `The inserted writing is the page's width and the ink's height (ratio ${image.ratio}, expected ${expected}, page ${sheet.shown})`);
      await shot('dark-after-insert');

      // The pen's menu: its four kinds (the current one ticked), its width, the presets.
      const menu = await openPenMenu();
      report.penMenu = menu;
      check(menu.kinds.map(kind => kind.label).join() === 'Pen,Marker,Fountain Pen,Highlighter',
        'The pen menu lists Pen, Marker, Fountain Pen and Highlighter: ' + JSON.stringify(menu.kinds));
      check(menu.kinds.every(kind => kind.icon && !kind.disabled), 'Every kind has its icon and can be chosen on a plain sheet');
      check(menu.kinds.map(kind => kind.checked).join() === 'true,false,false,false', 'The pen is the ticked kind at first');
      check(menu.widths.length >= 7 && menu.presets, 'The pen menu holds the widths and the tool presets: ' + JSON.stringify(menu));
      check(menu.inside, 'The pen menu is whole inside the window');
      await shot('dark-pen-menu', 'menu');
      await click('.float-menu [data-pen-width="3"]');
      await pause(200);
      check(await js(`localStorage.getItem('notemind.penWidth')`) === '3', 'A width chosen in the pen menu is the pen width');
      await escape();

      // One stroke of each kind over a line of pen writing: the stroke format is the pen's for all four.
      const unit = await js(`1000/(()=>{const s=document.querySelector('[data-tablet=surface]'),
        v=JSON.parse(s.dataset.sheetViewport);return s.getBoundingClientRect().width/v.width})()`);
      const near = (actual, wanted) => Math.abs(actual / wanted - 1) < .01;
      let colour = await tap('Black');
      check(colour.pressed === 'true' && colour.colour.toLowerCase() === '#1c1c1e',
        'A tap on a swatch makes it the pen colour: ' + JSON.stringify(colour));
      const start = (await strokes()).length;
      await write(Array.from({length: 57}, (_, at) => [.15 + at * .0125, .5 + (at % 4 < 2 ? -.012 : .012)]));
      let all = await strokes();
      const pen = all.at(-1);
      check(all.length === start + 1 && pen.keys === 'colorHex,width,points' && near(pen.width, 3 * unit),
        'The pen writes the chosen width and colour: ' + JSON.stringify(pen));

      check(await choose('marker') === 'marker', 'Marker chosen in the pen menu is the pen button\'s kind');
      await tap('Red');
      await write(Array.from({length: 40}, (_, at) => [.22 + at * .014, .4 + at * .006]));
      all = await strokes();
      const marker = all.at(-1);
      check(all.length === start + 2 && marker.keys === 'colorHex,width,points' && marker.pressures === null,
        'A marker stroke has no pressures: ' + JSON.stringify(marker));
      check(near(marker.width, 9 * unit) && marker.colorHex.toLowerCase() === '#f2542d',
        'A marker stroke is three times the chosen width, in the chosen colour: ' + JSON.stringify(marker));

      check(await choose('fountain') === 'fountain', 'Fountain Pen chosen in the pen menu is the pen button\'s kind');
      await tap('Blue');
      // A loop: every heading past the nib.
      let live = null;
      await write(Array.from({length: 90}, (_, at) =>
        [.5 + .2 * Math.cos(at / 89 * 2.2 * Math.PI + 1), .5 + .1 * Math.sin(at / 89 * 2.2 * Math.PI + 1)]),
      async () => { live = await sheetPixels(); await shot('dark-live-fountain', true); });
      report.fountainLift = differing(live, await sheetPixels());
      check(report.fountainLift <= 4, 'A fountain pen stroke looks the same when the pen lifts as while it was drawn: ' +
        report.fountainLift + ' pixels differ');
      all = await strokes();
      const fountain = all.at(-1);
      report.fountain = fountain;
      check(all.length === start + 3 && fountain.keys === 'colorHex,width,points,pressures' &&
        fountain.pressures.count === fountain.count, 'A fountain pen stroke has a pressure for every point: ' + JSON.stringify(fountain));
      check(fountain.pressures.high - fountain.pressures.low > .4 && fountain.pressures.low >= 0 && fountain.pressures.high <= 1,
        'A fountain pen stroke drawn with the mouse is thick and thin: ' + JSON.stringify(fountain.pressures));
      check(fountain.pressures.last < fountain.pressures.high * .6, 'A fountain pen stroke ends thin');
      check(near(fountain.width, 4.5 * unit), 'A fountain pen stroke is one and a half times the chosen width');

      check(await choose('highlighter') === 'highlighter', 'Highlighter chosen in the pen menu is the pen button\'s kind');
      await tap('Amber');
      const inked = await strokes();
      // While it is drawn the band is over the ink and lets it through; made, it is under the ink.
      let through = null;
      await write(Array.from({length: 40}, (_, at) => [.12 + at * .02, .5]), async () => {
        through = await js(`(()=>{const c=document.querySelector('[data-tablet=surface] canvas.line-preview'),
          d=c.getContext('2d').getImageData(Math.round(c.width*.5),Math.round(c.height*.5),1,1).data;return [...d]})()`);
        await shot('dark-live-highlighter', true);
      });
      report.liveHighlight = through;
      check(through[3] > 60 && through[3] < 140, 'A highlight being drawn is translucent over the writing: alpha ' + through[3]);
      all = await strokes();
      const highlight = all[0];
      report.highlight = highlight;
      check(all.length === start + 4 && JSON.stringify(all.slice(1)) === JSON.stringify(inked),
        'A highlighter stroke goes under the ink that was there: ' + JSON.stringify(all.map(one => one.colorHex)));
      check(highlight.keys === 'colorHex,width,points' && highlight.pressures === null && near(highlight.width, 18 * unit),
        'A highlighter stroke is a wide even band: ' + JSON.stringify(highlight));
      check(/^#[0-9a-f]{6}$/.test(highlight.colorHex) && highlight.colorHex.toLowerCase() !== '#f5b700' &&
        luminance(highlight.colorHex) > .8, 'A highlighter stroke is a pale tint of the colour: ' + highlight.colorHex);
      // The writing stays crisp on top: a pixel of the pen line inside the band is the pen's black, one beside it the tint.
      const onInk = await inkAt(.15 + 9 * .0125 + .00625, .5), beside = await inkAt(.14, .5);
      report.pixels = {onInk, beside};
      check(onInk[3] > 200 && onInk[0] < 90 && onInk[1] < 90 && onInk[2] < 90, 'Pen writing shows on top of the highlight: ' + onInk);
      check(beside[3] > 200 && beside[0] > 200 && beside[1] > 180, 'The highlight shows beside the writing: ' + beside);
      await shot('dark-kinds', true);
      await command('pen:undo');
      all = await strokes();
      check(JSON.stringify(all) === JSON.stringify(inked), 'One Undo removes the highlight and nothing else');
      await command('pen:redo');
      all = await strokes();
      check(all.length === start + 4 && JSON.stringify(all[0]) === JSON.stringify(highlight) &&
        JSON.stringify(all.slice(1)) === JSON.stringify(inked), 'Redo restores the highlight under the ink');
      // Ink written after a highlight is above it.
      check(await choose('pen') === 'pen', 'Pen chosen again');
      await tap('Green');
      await write(Array.from({length: 30}, (_, at) => [.3 + at * .012, .62 - at * .009]));
      all = await strokes();
      check(all.length === start + 5 && JSON.stringify(all[0]) === JSON.stringify(highlight) &&
        all.at(-1).colorHex.toLowerCase() === '#2fbf71', 'Ink written after a highlight is above it');
      await shot('dark-kinds-all', true);
      check(await js(`document.querySelector('.tablet-footer [role=status]').textContent`) === '', 'No drawing error was reported');

      // The pane at the width Sean keeps it: everything fits, the colours are still swatches, the width is in the pen menu.
      await js(`document.getElementById('pane').style.setProperty('--video-w','380px')`);
      await pause(500);
      state = await bars();
      report.pane380 = state;
      check(state.width <= 400, 'The pane took the 380 pixel width: ' + state.width);
      fits(state, 'in a 380 pixel pane');
      check(state.order.join() === 'pen,pen-kinds,eraser,select,swatches,undo,ink,bring-menu',
        'A 380 pixel pane shows pen, eraser, select, colours, undo, Insert and options: ' + state.order);
      check(!state.widthSelect && !state.presets && !state.paper, 'Width, presets and paper leave a 380 pixel bar');
      colour = await tap('Purple');
      check(colour.pressed === 'true' && colour.colour.toLowerCase() === '#8e44ad',
        'A swatch is tapped in a 380 pixel pane: ' + JSON.stringify(colour));
      await shot('dark-pane-380');
      await shot('dark-bar-380', true);
      const narrowMenu = await openPenMenu();
      check(narrowMenu.kinds.length === 4 && narrowMenu.widths.length >= 7 && narrowMenu.presets && narrowMenu.inside,
        'In a 380 pixel pane the pen menu holds kinds, widths and presets, whole inside the window: ' + JSON.stringify(narrowMenu));
      await shot('dark-pen-menu-380', 'menu');
      await click('.float-menu [data-pen-width="5"]');
      await pause(200);
      check(await js(`localStorage.getItem('notemind.penWidth')`) === '5', 'In a 380 pixel pane the width is chosen in the pen menu');
      await click('.float-menu [data-bar=pen-presets]');
      await pause(350);
      check(await js(`!!document.querySelector('.float-menu.sub [data-bar=tool-preset-save]')`),
        'In a 380 pixel pane the presets open from the pen menu');
      await shot('dark-presets-menu-380', 'menu');
      await escape();
      await escape();
      await click('[data-bar=pane-menu]');
      await pause(350);
      await click('.float-menu [data-bar=pane-paper]');
      await pause(350);
      check(await js(`!!document.querySelector('.float-menu.sub [data-bar=paper-lines]')
        &&!!document.querySelector('.float-menu.sub [data-paper-colour=cream]')`),
        'In a 380 pixel pane the paper is chosen in the options menu');
      await shot('dark-paper-menu-380', 'menu');
      await escape();
      await escape();

      // Every width from there up: nothing overflows, the colours stay, and a wide bar has the width, presets and paper on it.
      report.sweep = [];
      for (const width of [380, 396, 411, 412, 428, 435, 436, 442, 471, 472, 496, 497, 540, 600, 687, 688, 720, 760]) {
        await js(`document.getElementById('pane').style.setProperty('--video-w','${width}px')`);
        await pause(250);
        state = await bars();
        report.sweep.push({asked: width, width: state.width, overflow: state.overflow, standard: state.standard, custom: state.custom,
          swatch: state.swatchSize, widthSelect: state.widthSelect, presets: state.presets, paper: state.paper});
        check(state.overflow <= 0 && state.standard === 6 && state.custom && !state.colourMenu,
          `A ${state.width} pixel bar fits with every colour: ` + JSON.stringify(report.sweep.at(-1)));
      }
      const widest = report.sweep.at(-1);
      if (widest.width >= 690) {
        check(widest.widthSelect && widest.presets && widest.paper,
          'A wide bar has the width, presets and paper on it: ' + JSON.stringify(widest));
        await shot('dark-bar-wide', true);
      }
      await js(`document.getElementById('pane').style.removeProperty('--video-w')`);
      await pause(300);

      // A dense sheet is painted by the raster worker: a highlight there is under the ink too.
      await js(`(()=>{const host=document.querySelector('[data-tablet=host]'),
        key=Object.getOwnPropertyNames(host).find(name=>name.startsWith('__reactFiber'));let fiber=host[key];
        while(fiber&&!fiber.memoizedProps?.page?.strokes)fiber=fiber.return;const page=fiber.memoizedProps.page;
        page.replace(Object.freeze([...page.strokes,...Array.from({length:2600},(_,at)=>({colorHex:'#1C1C1E',width:2,
          points:[{x:.1+at%65*.012,y:.86+Math.floor(at/65)*.003},{x:.105+at%65*.012,y:.861+Math.floor(at/65)*.003}]}))]));
        fiber.memoizedProps.onEdited(page)})()`);
      await pause(1500);
      await choose('pen');
      await tap('Black');
      await write(Array.from({length: 30}, (_, at) => [.2 + at * .02, .2]));
      await choose('highlighter');
      await tap('Green');
      const dense = (await strokes()).length;
      await write(Array.from({length: 30}, (_, at) => [.15 + at * .024, .2]));
      await pause(900);
      all = await strokes();
      const sheetHeight = await js(`document.querySelector('[data-tablet=surface]').getBoundingClientRect().height`);
      const denseInk = await inkAt(.5, .2), denseBand = await inkAt(.5, .2 + 6 / sheetHeight);
      report.dense = {strokes: all.length, first: all[0].colorHex, denseInk, denseBand};
      check(all.length === dense + 1 && all.length > 2600 && luminance(all[0].colorHex) > .7 && all[0].pressures === null,
        'On a dense sheet a highlight is the first stroke: ' + JSON.stringify(report.dense));
      check(denseInk[3] > 200 && denseInk[0] < 90 && denseInk[1] < 90,
        'On a dense sheet pen writing shows on top of the highlight: ' + denseInk);
      check(denseBand[3] > 200 && denseBand[1] > 200, 'On a dense sheet the highlight shows beside the writing: ' + denseBand);
      await shot('dark-dense-highlight', true);
      await choose('pen');
      nativeTheme.themeSource = 'light';
      await pause(700);
      await shot('light-sheet');
      await shot('light-bar-default', true);
      await openPenMenu();
      await shot('light-pen-menu', 'menu');
      await escape();
      nativeTheme.themeSource = 'dark';
      w.setContentSize(1000, 700);
      await pause(900);
      state = await bars();
      report.narrow = state;
      check(state.rows.length === 2, 'Still two bars in a narrow window');
      await shot('dark-narrow');
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.error = error.stack;
      await shot('failure').catch(() => {});
    }
    fs.writeFileSync('test-results/tablet-two-bars.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  });
});
require(path.join(process.env.NOTEMIND_TEST_APP || path.resolve('src'), 'main.cjs'));
setTimeout(() => app.exit(1), 120000).unref();
