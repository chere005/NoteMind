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

/** Plain writing, as the driver delivers it while the display reports the tip. */
async function write(h, from, to) {
	h.setNativeButtons({...hover, tip: true});
	h.pointer('pointerdown', from[0], from[1], 1, 'pen', 7);
	h.contact(from[0], from[1], {start: true, buttons: 1});
	h.pointer('pointermove', to[0], to[1], 1, 'pen', 7);
	h.contact(to[0], to[1], {buttons: 1});
	h.setNativeButtons(hover);
	h.pointer('pointerup', to[0], to[1], 0, 'pen', 7);
	await finish(h);
}

test('plain writing is the driver\'s; Lower erase and Upper pick and drag come from Wacom reports alone', async t => {
	const h = drawing();
	t.after(() => h.unmount());
	// The display's report of a plain touch places nothing: it is the driver's stroke.
	begin(h, 300, 300, 1);
	h.contact(320, 320, {buttons: 1});
	await finish(h);
	assert.equal(h.page.strokes.length, 0);
	await write(h, [120, 160], [180, 220]);
	assert.equal(h.page.strokes.length, 1);
	const first = h.page.strokes[0];
	await write(h, [420, 580], [480, 620]);
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

test('a display that reports buttons only leaves the driver\'s coordinates in use', async t => {
	const h = drawing();
	t.after(() => h.unmount());
	const buttonsOnly = {...hover, contactPosition: undefined};
	h.setNativeButtons({...buttonsOnly, tip: true});
	h.pointer('pointerdown', 70, 180, 1, 'pen', 7);
	h.pointer('pointermove', 150, 220, 1, 'pen', 7);
	h.setNativeButtons(buttonsOnly);
	h.pointer('pointerup', 170, 250, 0, 'pen', 7);
	await h.handle.current.flush();
	assert.equal(h.page.strokes.length, 1);
	assert.ok(h.page.strokes[0].points.every(({x}) => x < .3));
	const first=h.page.strokes[0];

	h.setNativeButtons({...buttonsOnly, upper: true, tip: true});
	h.pointer('pointerdown', 70, 180, 5, 'pen', 7);
	h.setNativeButtons(buttonsOnly);
	h.pointer('pointerup', 70, 180, 0, 'pen', 7);
	await finish(h);
	assert.deepEqual([...h.handle.current.selectedStrokes()], [first]);
	assert.deepEqual([...h.page.strokes], [first]);
});

test('a touch with a side button held is the display\'s even when the driver\'s event arrives first, frozen where the button went down', async t => {
	const h = drawing();
	t.after(() => h.unmount());
	await write(h, [405, 670], [450, 700]);
	assert.equal(h.page.strokes.length, 1);
	// Pan/Scroll on the top button: the driver reports the touch at the pointer it froze, first; the display's drag is the selection.
	h.setNativeButtons({...hover, upper: true, tip: true});
	h.pointer('pointerdown', 70, 180, 5, 'pen', 7);
	h.contact(380, 640, {start: true, buttons: 5});
	h.pointer('pointermove', 70, 180, 5, 'pen', 7);
	h.contact(500, 760, {buttons: 5});
	await finish(h);
	h.pointer('pointerup', 70, 180, 0, 'pen', 7);
	assert.deepEqual([...h.handle.current.selectedStrokes()], [h.page.strokes[0]]);
	h.handle.current.clearInkSelection();
	h.render();
	// Right Click on the bottom button: the driver's press with pressure while the pen only hovers deletes nothing and draws nothing.
	h.setNativeButtons({...hover, lower: true});
	h.pointer('pointerdown', 420, 680, 3, 'pen', 7);
	h.pointer('pointermove', 450, 700, 3, 'pen', 7);
	h.pointer('pointerup', 450, 700, 0, 'pen', 7);
	h.setNativeButtons(hover);
	await finish(h);
	assert.equal(h.page.strokes.length, 1);
});
