const graphics = require('./graphics-pane.js');
const {inkCapacity, capacityError} = require('./ink-mutations.js');

const MAX_CLIPBOARD_BYTES = 16 * 1024 * 1024;
const MARKER = /<meta\s+name="notemind-ink"\s+content="([a-z0-9+/=]+)"\s*\/?\s*>/i;
const REGION = /<meta\s+name="notemind-ink-region"\s+content="([^"]+)"\s*\/?\s*>/i;
const validRegion = region => region && [region.x, region.y, region.width, region.height,
	region.x + region.width, region.y + region.height].every(Number.isFinite) && region.width > 0 && region.height > 0;

function clipboardHTML(ink, region = null) {
	if (!ink) return '';
	if (typeof ink !== 'string' || ink.length > MAX_CLIPBOARD_BYTES) {
		throw Error('The copied drawing is too large for the clipboard.');
	}
	const sheet = graphics.decodeBase64(ink);
	if (sheet.backdrop) throw Error('The stroke clipboard must not contain a background.');
	if (region && !validRegion(region)) throw Error('Invalid copied drawing area.');
	return '<meta name="notemind-ink" content="' + ink + '">' + (region
		? '<meta name="notemind-ink-region" content="' + [region.x, region.y, region.width, region.height].join(',') + '">'
		: '');
}

function readClipboardInk(html) {
	if (typeof html !== 'string' || html.length > MAX_CLIPBOARD_BYTES + 1024) return null;
	const match = MARKER.exec(html);
	if (!match) return null;
	try {
		const sheet = graphics.decodeBase64(match[1]);
		const area = REGION.exec(html)?.[1].split(',').map(Number);
		if (area?.length === 4) {
			const [x, y, width, height] = area, region = {x, y, width, height};
			if (validRegion(region)) sheet.clipboardRegion = region;
		}
		return sheet.backdrop ? null : sheet;
	} catch {
		return null;
	}
}

// Keep the drawing's physical proportions when moving between differently shaped sheets.
function inkPlacement(sourceAspect, targetAspect, view, originalWidth = 1) {
	const width = Math.min(originalWidth, view.width * .8, view.height * .8 * sourceAspect / targetAspect);
	const height = width * targetAspect / sourceAspect;
	return {x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height};
}

async function copyInk(snapshot) {
	const region = snapshot.region;
	const cropped = await graphics.cropAsync({...snapshot, backdrop:null}, region);
	const strokes = [];
	let work = 0;
	// Keep the original sheet coordinates so thin selections retain their aspect and physical size.
	for (const stroke of cropped.strokes) {
		const points = [];
		for (const point of stroke.points) {
			points.push({x:region.x + point.x * region.width, y:region.y + point.y * region.height});
			if (++work % 8192 === 0) await graphics.yieldTask();
		}
		strokes.push({...stroke, width:stroke.width * region.width, points});
	}
	return {ink:graphics.encodeBase64({aspect:snapshot.aspect, strokes, backdrop:null}), region:{...region}};
}

async function pasteInk(page, sheet, view, {valid = () => true} = {}) {
	graphics.validate(sheet);
	if (!sheet.strokes.length) return false;
	const release = page.retainGeometry?.() || (() => {});
	try {
		const source = sheet.clipboardRegion || {x:0, y:0, width:1, height:1};
		if (!validRegion(source)) throw Error('Invalid pasted drawing area.');
		const area = inkPlacement(sheet.aspect * source.width / source.height, page.aspect, view, source.width);
		const ink = sheet.strokes.map(stroke => ({
			...stroke,
			width: stroke.width * area.width / source.width,
			points: stroke.points.map(point => ({
				x:area.x + (point.x - source.x) * area.width / source.width,
				y:area.y + (point.y - source.y) * area.height / source.height,
			})),
			...(stroke.pressures ? {pressures: stroke.pressures.slice()} : {}),
		}));
		const points = ink.reduce((count, stroke) => count + stroke.points.length, 0);
		while (valid()) {
			const before = page.strokes;
			const capacity = inkCapacity(page);
			if (points > capacity.points || ink.length > capacity.strokes) throw capacityError();
			if (await page.replaceAsync([...before, ...ink], {valid: () => valid() && page.strokes === before})) {
				return true;
			}
			if (page.strokes === before) return false;
		}
		return false;
	} finally {
		release();
	}
}

module.exports = {MAX_CLIPBOARD_BYTES, clipboardHTML, readClipboardInk, inkPlacement, copyInk, pasteInk};
