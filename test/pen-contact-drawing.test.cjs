const { test } = require('node:test');
const assert = require('node:assert/strict');
const { surfaceHarness, pageModule } = require('./helpers/tablet-surface.cjs');

const hover = {present: true, range: true, tip: false, lower: false, upper: false, contactPosition: true};
const drawing = () => surfaceHarness({passivePen: true, size: {width: 600, height: 800}, page: new pageModule.TabletPage(.75)});

function begin(h, x, y, buttons, pressure=.7) {
	h.setNativeButtons({...hover, tip: true, lower: !!(buttons & 2), upper: !!(buttons & 4)});
	h.contact(x, y, {start: true, buttons, pressure});
}

async function finish(h) {
	h.setNativeButtons(hover);
	await h.handle.current.flush();
	await new Promise(resolve => setImmediate(resolve));
	h.render();
}

test('the drawing surface accepts plain tip, Lower erase and Upper pick and drag from Wacom reports alone', async t => {
	const h = drawing();
	t.after(() => h.unmount());
	begin(h, 120, 160, 1, .25);
	h.pointer('pointerdown', 130, 170, 1, 'pen', 7);
	h.contact(180, 220, {buttons: 1, pressure: .75});
	await finish(h);
	assert.equal(h.page.strokes.length, 1);
	const first = h.page.strokes[0];
	assert.deepEqual([...first.pressures], [.25,.75]);
	begin(h, 420, 580, 1);
	h.contact(480, 620, {buttons: 1});
	await finish(h);
	const second=h.page.strokes[1];

	begin(h, 120, 160, 5);
	await finish(h);
	assert.deepEqual([...h.handle.current.selectedStrokes()], [first]);
	h.handle.current.clearInkSelection();
	h.render();
	begin(h, 90, 120, 5);
	h.contact(210, 265, {buttons: 5});
	await finish(h);
	assert.deepEqual([...h.handle.current.selectedStrokes()], [first]);
	assert.deepEqual([...h.page.strokes], [first, second]);
	h.handle.current.clearInkSelection();
	h.render();

	begin(h, 120, 160, 3);
	await finish(h);
	assert.deepEqual([...h.page.strokes], [second]);
	await h.handle.current.undo();
	assert.deepEqual([...h.page.strokes], [first, second]);
	await h.handle.current.redo();
	assert.deepEqual([...h.page.strokes], [second]);
	assert.equal(h.tools.eraser, false);
	assert.equal(h.tools.select, false);
});

test('driver coordinates remain usable when Wacom reports buttons only or the driver starts first', async t => {
	const h = drawing();
	t.after(() => h.unmount());
	h.setNativeButtons({...hover, tip: true});
	h.pointer('pointerdown', 70, 180, 1, 'pen', 7);
	h.contact(405, 670, {start: true, buttons: 1});
	h.pointer('pointermove', 150, 220, 1, 'pen', 7);
	h.setNativeButtons(hover);
	h.pointer('pointerup', 170, 250, 0, 'pen', 7);
	await h.handle.current.flush();
	assert.equal(h.page.strokes.length, 1);
	assert.ok(h.page.strokes[0].points.every(({x}) => x < .3));
	const first=h.page.strokes[0];

	h.setNativeButtons({...hover, upper: true, tip: true});
	h.pointer('pointerdown', 70, 180, 5, 'pen', 7);
	h.setNativeButtons(hover);
	h.pointer('pointerup', 70, 180, 0, 'pen', 7);
	await finish(h);
	assert.deepEqual([...h.handle.current.selectedStrokes()], [first]);
	assert.deepEqual([...h.page.strokes], [first]);
});
