const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const graphics = require('../src/graphics-pane.js');
const {clipboardHTML, readClipboardInk, inkPlacement, copyInk, pasteInk} = require('../src/drawing-clipboard.cjs');
const {drawingClipboard} = require('../src/drawing-clipboard-native.cjs');
const {load} = require('./helpers/tablet-surface.cjs');
const {TabletPage} = load('src/tablet/renderer/tabletPage.ts', {setImmediate, setTimeout, MessageChannel, performance});

const stroke = () => ({colorHex:'#123456', width:3, points:[{x:0, y:0}, {x:1, y:1}], pressures:[.2, .9]});
const sheet = () => ({aspect:2, strokes:[stroke()], backdrop:null});
const view = {x:0, y:0, width:1, height:1};

test('copied editable strokes round trip alongside an ordinary image, including pressure', () => {
	const input = sheet();
	const html = clipboardHTML(graphics.encodeBase64(input));
	const output = readClipboardInk('<html><body>' + html + '</body></html>');
	assert.deepEqual(output.strokes, input.strokes);
	assert.equal(output.aspect, 2);
	assert.equal(readClipboardInk('<p>ordinary text</p>'), null);
	assert.equal(readClipboardInk('<meta name="notemind-ink" content="AAAA">'), null);
	assert.throws(() => clipboardHTML(graphics.encodeBase64({...input, backdrop:'data:image/png;base64,AAAA'})));
});

test('pasted ink keeps its physical proportions on portrait, landscape, and zoomed sheets', () => {
	for (const targetAspect of [.5, 1, 2]) {
		for (const viewport of [view, {x:-.2, y:.5, width:.4, height:.3}]) {
			const area = inkPlacement(2, targetAspect, viewport);
			assert.ok(Math.abs(area.width * targetAspect / area.height - 2) < 1e-10);
			assert.ok(area.width <= viewport.width * .8 + 1e-10);
			assert.ok(area.height <= viewport.height * .8 + 1e-10);
			assert.ok(Math.abs(area.x + area.width / 2 - viewport.x - viewport.width / 2) < 1e-10);
		}
	}
});

test('pasting strokes is one undoable edit and does not change existing or copied geometry', async () => {
	const page = new TabletPage(.5), original = stroke(), input = sheet();
	await page.loadGeometryAsync([original]);
	const before = page.strokes;
	assert.equal(await pasteInk(page, input, view), true);
	assert.equal(page.strokes.length, 2);
	assert.equal(page.strokes[0], original);
	assert.notEqual(page.strokes[1], input.strokes[0]);
	assert.notEqual(page.strokes[1].points, input.strokes[0].points);
	assert.equal(page.strokes[1].pressures[1], .9);
	assert.equal(input.strokes[0].points[0].x, 0);
	assert.equal(await page.undoAsync(), true);
	assert.equal(page.strokes, before);
	assert.equal(await page.redoAsync(), true);
	assert.equal(page.strokes.length, 2);
	await page.disposeAsync();
});

test('a pen stroke committed during paste is retained, and a closed page receives no paste', async () => {
	const page = new TabletPage(1), concurrent = stroke();
	const replace = page.replaceAsync.bind(page);
	let injected = false;
	page.replaceAsync = async (...args) => {
		if (!injected) { injected = true; page.add(concurrent); return false; }
		return replace(...args);
	};
	assert.equal(await pasteInk(page, sheet(), view), true);
	assert.equal(page.strokes[0], concurrent);
	assert.equal(page.strokes.length, 2);
	assert.equal(await pasteInk(page, sheet(), view, {valid:() => false}), false);
	assert.equal(page.strokes.length, 2);
	await page.disposeAsync();
});

test('native clipboard writes image and editable ink atomically, preferring ink on paste', async () => {
	let items;
	class ClipboardItem {
		constructor(data) { this.data = data; this.types = Object.keys(data); }
		async getType(type) { const value = this.data[type]; return value instanceof Blob ? value : new Blob([value]); }
	}
	const clipboard = {write:async value => {items = value;}, read:async () => items};
	const png = fs.readFileSync(require.resolve('./fixtures/ocr-english.png'));
	const nativeImage = {createFromBuffer:() => ({isEmpty:() => false, toPNG:() => png})};
	const api = drawingClipboard({clipboard, ClipboardItem, nativeImage});
	await api.copy({png:png.toString('base64'), ink:graphics.encodeBase64(sheet())});
	assert.equal(items.length, 1);
	assert.deepEqual(items[0].types, ['image/png', 'text/html']);
	assert.deepEqual((await api.read()).ink.strokes, sheet().strokes);
	items = [new ClipboardItem({'image/png':new Blob([png], {type:'image/png'})})];
	assert.equal((await api.read()).image, 'data:image/png;base64,' + png.toString('base64'));
	items = [new ClipboardItem({'text/plain':'text'})];
	assert.equal(await api.read(), null);
});

test('close prompts follow the Wacom close button and fall back when the pen window has closed', async () => {
	const line = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8').split('\n')
		.find(line => line.startsWith("ipcMain.handle('close-sheet-choice'"));
	let handler, parent, available = true;
	const owner = {}, padWindow = {}, pad = {isDestroyed:() => !available}, sender = {};
	vm.runInNewContext(line, {
		ipcMain:{handle:(_name, callback) => {handler = callback;}},
		padController:{contents:() => pad},
		BrowserWindow:{fromWebContents:value => value === pad ? padWindow : owner}, win:owner,
		dialog:{showMessageBox:async (target, options) => {
			parent = target;
			assert.deepEqual(Array.from(options.buttons), ['Save', 'Don’t Save', 'Cancel']);
			return {response:1};
		}},
	});
	assert.equal(await handler({sender}, 'Sheet 1', true), 'discard');
	assert.equal(parent, padWindow);
	await handler({sender}, 'Sheet 1', false);
	assert.equal(parent, owner);
	available = false;
	await handler({sender}, 'Sheet 1', true);
	assert.equal(parent, owner);
});


test('copying and pasting a thin stroke keeps its original size and pen width', async () => {
	const original = {colorHex:'#123456', width:3, points:[{x:.3, y:.4}, {x:.5, y:.4}], pressures:[.2, .9]};
	const snapshot = {aspect:1, strokes:[original], region:{x:.28, y:.38, width:.24, height:.04}};
	const copied = await copyInk(snapshot);
	const clip = readClipboardInk(clipboardHTML(copied.ink, copied.region));
	assert.equal(clip.aspect, 1);
	const page = new TabletPage(1);
	await pasteInk(page, clip, view);
	assert.ok(Math.abs(page.strokes[0].points[1].x - page.strokes[0].points[0].x - .2) < 1e-10);
	assert.ok(Math.abs(page.strokes[0].width - 3) < 1e-10);
	assert.equal(page.strokes[0].pressures[1], .9);
	await page.disposeAsync();
});

test('malformed clipboard placement cannot change the receiving drawing', async () => {
	const page = new TabletPage(.5), before = page.strokes;
	for (const region of [{x:Number.MAX_VALUE, y:0, width:1, height:1},
		{x:0, y:0, width:Number.MIN_VALUE, height:1}]) {
		await assert.rejects(pasteInk(page, {...sheet(), clipboardRegion:region}, view), /drawing area/);
		assert.equal(page.strokes, before);
	}
	await page.disposeAsync();
});

test('clipboard image bounds are checked before decoding or opening a sheet', async () => {
	const header = Buffer.alloc(33);
	Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
	header.writeUInt32BE(13, 8);
	header.write('IHDR', 12);
	header.writeUInt32BE(100000, 16);
	header.writeUInt32BE(100000, 20);
	let nativeReads = 0;
	class ClipboardItem {
		constructor(data) {this.types = Object.keys(data); this.data = data;}
		async getType(type) {return this.data[type];}
	}
	const clipboard = {read:async () => [new ClipboardItem({'image/png':new Blob([header])})]};
	const api = drawingClipboard({clipboard, ClipboardItem,
		nativeImage:{createFromBuffer:() => {nativeReads++; throw Error('Unexpected native image decode');}}});
	await assert.rejects(api.read(), /pixel image limit/);
	await assert.rejects(api.copy({png:header.toString('base64')}), /pixel image limit/);
	assert.equal(nativeReads, 0);
});
