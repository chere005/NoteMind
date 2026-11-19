const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./helpers/tablet-surface.cjs');
const {mirrorRowPlace} = load('src/tablet/renderer/SelectionMirror.tsx');
const bridge = load('src/tablet/renderer/padMirrorInput.ts');

test('full-size mirror actions cover their small pixel copy and stay inside narrow panes', () => {
	for (const side of ['below', 'above', 'inside']) {
		for (const top of [0, 170, 294]) {
			const anchor = {left:70, top, width:90, height:6, side, stage:{width:300, height:300}};
			const row = {width:260, height:36}, place = mirrorRowPlace(anchor, row);
			assert.ok(place.left >= 0 && place.left + row.width <= 300);
			assert.ok(place.top >= 0 && place.top + row.height <= 300);
			assert.ok(place.top <= anchor.top && place.top + row.height >= anchor.top + anchor.height);
		}
	}
});

test('copy and paste from the page mirror reach its drawing owner without taking over text fields', () => {
	const events = [];
	class Element {
		constructor(field = false) {this.field = field;}
		matches() {return false;}
		closest(selector) {
			if (selector === '.tablet-pane') return {};
			return selector.startsWith('input,') && this.field ? this : null;
		}
		dispatchEvent(event) {events.push(event); event.preventDefault(); return false;}
	}
	class KeyboardEvent {
		constructor(type, options) {Object.assign(this, {type, ...options});}
		preventDefault() {this.defaultPrevented = true;}
	}
	const document = {visibilityState:'visible', body:new Element(), documentElement:new Element(), activeElement:new Element()};
	const view = {closed:false, document, HTMLElement:Element, KeyboardEvent, MouseEvent:KeyboardEvent};
	const stop = bridge.registerPadMirrorInput(view, run => run());
	try {
		for (const key of ['c', 'v']) {
			assert.equal(bridge.forwardPadMirrorKey({type:'keydown', key, metaKey:true}), true);
			assert.equal(events.at(-1).key, key);
		}
		document.activeElement = new Element(true);
		assert.equal(bridge.forwardPadMirrorKey({type:'keydown', key:'v', metaKey:true}), false);
		assert.equal(events.length, 2);
	} finally {stop();}
});
