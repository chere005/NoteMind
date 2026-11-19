function selectionMode(event, press) {
  if (event.altKey) return 'remove';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  if (event.shiftKey || press?.additive) return 'add';
  return 'replace';
}
function selectionRectangle(start, end) {
  if (Math.abs(start.px.x - end.px.x) < 4 || Math.abs(start.px.y - end.px.y) < 4) return null;
  const a = start.point, b = end.point, width = Math.abs(a.x - b.x), height = Math.abs(a.y - b.y);
  if (!width || !height) return null;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height };
}
module.exports = { selectionMode, selectionRectangle };
