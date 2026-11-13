(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoteMindGraphics = api;
})(typeof window === 'undefined' ? this : window, function () {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  const bounds = new WeakMap();
  const selected = (s, b) => {
    let box = bounds.get(s);
    if (!box || box.count !== s.points.length) { box = {count:s.points.length,x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};for(const p of s.points){box.x=Math.min(box.x,p.x);box.y=Math.min(box.y,p.y);box.right=Math.max(box.right,p.x);box.bottom=Math.max(box.bottom,p.y);}bounds.set(s,box); }
    return box.count>0 && box.x>=b.x && box.y>=b.y && box.right<=b.x+b.width && box.bottom<=b.y+b.height;
  };
  function validate(sheet) {
    if (!sheet || !finite(sheet.aspect) || sheet.aspect < .1 || sheet.aspect > 10 || !Array.isArray(sheet.strokes)) throw Error('Invalid graphics pane.');
    if (sheet.backdrop != null && (typeof sheet.backdrop !== 'string' || !/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(sheet.backdrop))) throw Error('Invalid graphics background.');
    let points = 0;
    for (const s of sheet.strokes) {
      if (!s || !/^#[0-9a-f]{6}$/i.test(s.colorHex) || !finite(s.width) || s.width <= 0 || !Array.isArray(s.points) || !s.points.every(p => p && finite(p.x) && finite(p.y)) || (s.pressures != null && (!Array.isArray(s.pressures) || s.pressures.length !== s.points.length || !s.pressures.every(finite)))) throw Error('Invalid graphics stroke.');
      points += s.points.length;
      if (points > 2000000) throw Error('This graphics pane has too many points.');
    }
    return sheet;
  }
  function encode(sheet) {
    validate(sheet);
    return JSON.stringify({ format: 'notemind-graphics', version: 1, name: sheet.name || 'Drawing', aspect: sheet.aspect,
      paper: sheet.paper, backdrop: sheet.backdrop || null,
      strokes: sheet.strokes.map(s => [s.colorHex, s.width, s.points.flatMap(p => [p.x, p.y]), ...(s.pressures ? [s.pressures] : [])]) });
  }
  function decode(raw) {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (data?.format == null) return validate(data);
    if (data.format !== 'notemind-graphics' || data.version !== 1 || !Array.isArray(data.strokes)) throw Error('Unsupported graphics pane.');
    const strokes = data.strokes.map(row => {
      if (!Array.isArray(row) || !Array.isArray(row[2]) || row[2].length % 2) throw Error('Invalid graphics points.');
      const points = [];
      for (let i = 0; i < row[2].length; i += 2) points.push({ x: row[2][i], y: row[2][i + 1] });
      return { colorHex: row[0], width: row[1], points, ...(row[3] ? { pressures: row[3] } : {}) };
    });
    return validate({ name: data.name || 'Drawing', aspect: data.aspect, paper: data.paper, backdrop: data.backdrop || null, strokes });
  }
  function transform(strokes, from, to) {
    if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0)) return strokes;
    const sx = to.width / from.width, sy = to.height / from.height;
    return strokes.map(s => selected(s, from) ? { ...s, width: s.width * sx, points: s.points.map(p => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy })) } : s);
  }
  // Crop complete selected strokes to pane coordinates. Preview-only backgrounds are supplied by the caller.
  function crop(sheet, box) {
    validate(sheet);
    if (!box) return { ...sheet, strokes: sheet.strokes.map(s => ({ ...s, points: s.points.map(p => ({ ...p })) })) };
    if (!(box.width > 0 && box.height > 0)) throw Error('Select an area of the sheet.');
    const strokes = [];
    const normalize = p => ({ x: (p.x - box.x) / box.width, y: (p.y - box.y) / box.height });
    for (const s of sheet.strokes) {
      if (selected(s, box)) { strokes.push({ ...s, width: s.width / box.width, points: s.points.map(normalize) }); continue; }
      let points = [], pressures = [];
      const flush = () => { if (points.length) strokes.push({ colorHex: s.colorHex, width: s.width / box.width, points, ...(s.pressures ? { pressures } : {}) }); points = []; pressures = []; };
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1], b = s.points[i], dx = b.x - a.x, dy = b.y - a.y;
        let lo = 0, hi = 1, clipped = false;
        for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]]) {
          if (p === 0) { if (q < 0) clipped = true; continue; }
          const r = q / p;
          if (p < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
        }
        if (clipped || lo > hi) { flush(); continue; }
        const point = t => normalize({ x: a.x + dx * t, y: a.y + dy * t });
        const start = point(lo), end = point(hi), last = points[points.length - 1];
        if (last && (Math.abs(last.x - start.x) > 1e-9 || Math.abs(last.y - start.y) > 1e-9)) flush();
        const pressure = t => s.pressures[i - 1] + (s.pressures[i] - s.pressures[i - 1]) * t;
        if (!points.length) { points.push(start); if (s.pressures) pressures.push(pressure(lo)); }
        points.push(end); if (s.pressures) pressures.push(pressure(hi));
        if (hi < 1) flush();
      }
      flush();
    }
    return { ...sheet, aspect: sheet.aspect * box.width / box.height, backdrop: null, strokes };
  }
  return { encode, decode, validate, transform, crop, selected };
});
