/** Keep strokes unless all of their points are inside the selection. */
export function outsideSelection(strokes, box) {
 return strokes.filter(stroke => !(stroke.points.length > 0 && stroke.points.every(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height)));
}
