const {clipboardHTML, readClipboardInk, MAX_CLIPBOARD_BYTES} = require('./drawing-clipboard.cjs');
const {imageSize} = require('image-size');
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

function checkImage(bytes) {
	const size = imageSize(bytes);
	if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) ||
		size.width < 1 || size.height < 1 || size.width * size.height > MAX_IMAGE_PIXELS) {
		throw Error('The clipboard picture exceeds the 16 Mi pixel image limit.');
	}
}

function drawingClipboard({clipboard, ClipboardItem, nativeImage}) {
	async function copy({png, ink = null, region = null}) {
		if (typeof png !== 'string' || png.length > 32 * 1024 * 1024) throw Error('The picture is too large.');
		const html = clipboardHTML(ink, region);
		const input = Buffer.from(png, 'base64');
		checkImage(input);
		const image = nativeImage.createFromBuffer(input);
		if (image.isEmpty()) throw Error('Could not copy the drawing.');
		const bytes = image.toPNG();
		if (ClipboardItem) {
			return clipboard.write([new ClipboardItem({
				'image/png': new Blob([bytes], {type: 'image/png'}),
				...(html ? {'text/html': html} : {}),
			})]);
		}
		return clipboard.write({image, ...(html ? {html} : {})});
	}

	async function read() {
		if (ClipboardItem) {
			const items = await clipboard.read();
			for (const item of items) {
				if (!item.types.includes('text/html')) continue;
				const blob = await item.getType('text/html');
				if (blob.size > MAX_CLIPBOARD_BYTES + 1024) continue;
				const ink = readClipboardInk(await blob.text());
				if (ink?.strokes.length) return {ink};
			}
			for (const item of items) {
				const type = item.types.find(type => /^image\/(png|jpeg|webp|gif|bmp)$/.test(type));
				if (!type) continue;
				const blob = await item.getType(type);
				if (blob.size > 32 * 1024 * 1024) throw Error('The pasted picture is too large.');
				const bytes = Buffer.from(await blob.arrayBuffer());
				checkImage(bytes);
				return {image: 'data:' + type + ';base64,' + bytes.toString('base64')};
			}
			return null;
		}
		const ink = readClipboardInk(clipboard.readHTML());
		if (ink?.strokes.length) return {ink};
		const image = clipboard.readImage();
		if (image.isEmpty()) return null;
		checkImage(image.toPNG());
		return {image: image.toDataURL()};
	}
	return {copy, read};
}

module.exports = {drawingClipboard};
