import { fingerprint, hashText, removeSuffix, strokeFingerprint, strokeAppend, primeStrokeFingerprints, decodedSheet } from '../../stroke-signature.js'
export { primeStrokeFingerprints }
// Cache by immutable stroke-array identity, so Undo also reuses previous hashes.
type Cached = { name: string; aspect: number; extent: string; backdrop: string | null; backdropHash: string | null; paper: string; suffix: string; signature: string }
const arrays = new WeakMap<object, Cached>()
const backgrounds = new WeakMap<object, { data: string | null; hash: string | null }>()
export function primeBackdropFingerprint(page, hash) {
  if (hash !== null && (typeof hash !== 'string' || !/^[a-f0-9]{16}$/.test(hash))) throw Error('Invalid drawing background fingerprint.')
  backgrounds.set(page, { data: page.backdrop || null, hash })
}
export function primeSheetSource(source,page){const cached=decodedSheet(source);if(cached?.backdropHash!==undefined)primeBackdropFingerprint(page,cached.backdropHash)}
export const isHydratedSheet=source=>decodedSheet(source)?.validated===true
export function sheetSignature(sheet, fallbackPaper = {}) {
  const page = sheet.page, paper = JSON.stringify(sheet.paper || fallbackPaper), backdrop = page.backdrop || null, cached = arrays.get(page.strokes)
  const extent = page.extent && (page.extent.x !== 0 || page.extent.y !== 0 || page.extent.width !== 1 || page.extent.height !== 1) ? JSON.stringify(page.extent) : ''
  if (cached && cached.name === sheet.name && cached.aspect === page.aspect && cached.extent === extent && cached.backdrop === backdrop && cached.paper === paper) return cached.signature
  let prior = cached, previous = page.strokes, added = [], count = 0
  // Usually one link. A missed render may include several committed strokes.
  while ((!prior || prior.name !== sheet.name || prior.aspect !== page.aspect) && count++ < 1024) {
    const link = strokeAppend(previous)
    if (!link) { prior = null;break }
    added.push(link.stroke);previous = link.previous;prior = arrays.get(previous)
  }
  const background = backgrounds.get(page)
  const backdropHash = prior?.backdrop === backdrop ? prior.backdropHash : background?.data === backdrop ? background.hash : backdrop ? fingerprint(backdrop) : null
  backgrounds.set(page, { data: backdrop, hash: backdropHash })
  const suffix = '],' + JSON.stringify([backdropHash, paper, ...(extent ? [extent] : [])]).slice(1)
  let hash: string
  if (prior && prior.name === sheet.name && prior.aspect === page.aspect) {
    hash = removeSuffix(prior.signature.slice(4), prior.suffix)
    for (let i = added.length - 1, length = previous.length; i >= 0; i--, length++) hash = hashText((length ? ',' : '') + JSON.stringify(strokeFingerprint(added[i])), hash)
    hash = hashText(suffix, hash)
  } else hash = fingerprint([sheet.name, page.aspect, page.strokes.map(strokeFingerprint), backdropHash, paper, ...(extent ? [extent] : [])])
  const signature = 'nm2:' + hash
  arrays.set(page.strokes, { name: sheet.name, aspect: page.aspect, extent, backdrop, backdropHash, paper, suffix, signature })
  return signature
}
export function savedSignature(saved, sheet, fallbackPaper = {}) {
  if (typeof saved !== 'string') return null
  if (saved.startsWith('nm2:')) return saved
  const legacy = JSON.stringify({ name: sheet.name, aspect: sheet.page.aspect, strokes: sheet.page.strokes, backdrop: sheet.page.backdrop || null, paper: sheet.paper || fallbackPaper })
  return saved === legacy ? sheetSignature(sheet, fallbackPaper) : null
}
