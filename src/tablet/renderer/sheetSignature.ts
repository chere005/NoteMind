// Cache immutable stroke fingerprints; checking a sheet's dirty state never serializes old ink again.
const strokes = new WeakMap<object, string>()
const pages = new WeakMap<object, { name: string; aspect: number; strokes: object[]; extent: string; backdrop: string | null; backdropHash: string | null; paper: string; signature: string }>()
function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let a = 2166136261, b = 3335557771
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i);a = Math.imul(a ^ code, 16777619);b = Math.imul(b ^ code, 2246822519) }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
export function sheetSignature(sheet, fallbackPaper = {}) {
  const page = sheet.page, paper = JSON.stringify(sheet.paper || fallbackPaper), backdrop = page.backdrop || null, cached = pages.get(page)
  const extent = page.extent && (page.extent.x !== 0 || page.extent.y !== 0 || page.extent.width !== 1 || page.extent.height !== 1) ? JSON.stringify(page.extent) : ''
  if (cached && cached.name === sheet.name && cached.aspect === page.aspect && cached.strokes === page.strokes && cached.extent === extent && cached.backdrop === backdrop && cached.paper === paper) return cached.signature
  const ink = page.strokes.map(stroke => { let hash = strokes.get(stroke);if (!hash) { hash = fingerprint(stroke);strokes.set(stroke, hash) }return hash })
  const backdropHash = cached?.backdrop === backdrop ? cached.backdropHash : backdrop ? fingerprint(backdrop) : null
  const signature = 'nm2:' + fingerprint([sheet.name, page.aspect, ink, backdropHash, paper, ...(extent ? [extent] : [])])
  pages.set(page, { name: sheet.name, aspect: page.aspect, strokes: page.strokes, extent, backdrop, backdropHash, paper, signature })
  return signature
}
export function savedSignature(saved, sheet, fallbackPaper = {}) {
  if (typeof saved !== 'string') return null
  if (saved.startsWith('nm2:')) return saved
  const legacy = JSON.stringify({ name: sheet.name, aspect: sheet.page.aspect, strokes: sheet.page.strokes, backdrop: sheet.page.backdrop || null, paper: sheet.paper || fallbackPaper })
  return saved === legacy ? sheetSignature(sheet, fallbackPaper) : null
}
