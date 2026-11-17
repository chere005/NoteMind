function selectionMode(event, press) {
  if (event.altKey) return 'remove';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  if (event.shiftKey || press?.additive) return 'add';
  return 'replace';
}
// Keep the complete path shape while bounding both React and query input size.
function appendLasso(points, point, max = 2048) {
  const last = points[points.length - 1];
  if (last && last.x === point.x && last.y === point.y) return;
  if (points.length >= max) {
    let write = 1;
    for (let at = 2; at < points.length; at += 2) points[write++] = points[at];
    points.length = write;
  }
  points.push({ x: point.x, y: point.y });
}
module.exports = { selectionMode, appendLasso };
