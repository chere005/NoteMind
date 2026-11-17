import { fingerprint, hashText, removeSuffix, strokeFingerprint, strokeAppend, primeStrokeFingerprints, decodedSheet, hashWriter, knownStrokeFingerprint, primeStrokeFingerprint } from '../../stroke-signature.js'
import {scheduler,hashJsonAsync,hashTextAsync,equalsJsonAsync} from '../../sheet-signature-work.cjs'
export { primeStrokeFingerprints }
export async function primeStrokeFingerprintsAsync(ink:any[],hashes:any[],options:any={}){if(!Array.isArray(hashes)||hashes.length!==ink.length)throw Error('Invalid drawing fingerprints.');const pace=scheduler(options);for(let i=0;i<hashes.length;i++){if(typeof hashes[i]!=='string'||!/^[a-f0-9]{16}$/.test(hashes[i]))throw Error('Invalid drawing fingerprints.');const pending=pace.step();if(pending)await pending;}pace.check();for(let i=0;i<ink.length;i++){primeStrokeFingerprint(ink[i],hashes[i]);const pending=pace.step();if(pending)await pending;}pace.check();}
// Cache by immutable stroke-array identity, so Undo also reuses previous hashes.
type Cached = { name: string; aspect: number; extent: string; backdropHash: string | null; paper: string; suffix: string; signature: string }
const arrays = new WeakMap<object, Cached>()
const prefixes=new WeakMap<object,Map<string,string>>(),bindings=new WeakMap<object,()=>any>()
const prefixKey=(name:any,aspect:number)=>JSON.stringify([name,aspect])
function primePrefix(strokes:any[],name:any,aspect:number,value:string){let entries=prefixes.get(strokes);if(!entries)prefixes.set(strokes,entries=new Map());const key=prefixKey(name,aspect);entries.delete(key);entries.set(key,value);while(entries.size>4)entries.delete(entries.keys().next().value)}
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
  const background = backgrounds.get(page),backdropHash=background?.data===backdrop?background.hash:backdrop?fingerprint(backdrop):null
  backgrounds.set(page, { data: backdrop, hash: backdropHash })
  if (cached && cached.name === sheet.name && cached.aspect === page.aspect && cached.extent === extent && cached.backdropHash === backdropHash && cached.paper === paper) return cached.signature
  let prior = cached, previous = page.strokes, added = [], count = 0
  // Usually one link. A missed render may include several committed strokes.
  while ((!prior || prior.name !== sheet.name || prior.aspect !== page.aspect) && count++ < 1024) {
    const link = strokeAppend(previous)
    if (!link) { prior = null;break }
    added.push(link.stroke);previous = link.previous;prior = arrays.get(previous)
  }
  const suffix = '],' + JSON.stringify([backdropHash, paper, ...(extent ? [extent] : [])]).slice(1)
  let hash: string
  const preparedPrefix=prefixes.get(page.strokes)?.get(prefixKey(sheet.name,page.aspect))
  if(preparedPrefix)hash=hashText(suffix,preparedPrefix)
  else if (prior && prior.name === sheet.name && prior.aspect === page.aspect) {
    hash = removeSuffix(prior.signature.slice(4), prior.suffix)
    for (let i = added.length - 1, length = previous.length; i >= 0; i--, length++) hash = hashText((length ? ',' : '') + JSON.stringify(strokeFingerprint(added[i])), hash)
    hash = hashText(suffix, hash)
  } else hash = fingerprint([sheet.name, page.aspect, page.strokes.map(strokeFingerprint), backdropHash, paper, ...(extent ? [extent] : [])])
  primePrefix(page.strokes,sheet.name,page.aspect,removeSuffix(hash,suffix))
  const signature = 'nm2:' + hash
  arrays.set(page.strokes, { name: sheet.name, aspect: page.aspect, extent, backdropHash, paper, suffix, signature })
  return signature
}
export function savedSignature(saved, sheet, fallbackPaper = {}) {
  if (typeof saved !== 'string') return null
  if (saved.startsWith('nm2:')) return saved
  const legacy = JSON.stringify({ name: sheet.name, aspect: sheet.page.aspect, strokes: sheet.page.strokes, backdrop: sheet.page.backdrop || null, paper: sheet.paper || fallbackPaper })
  return saved === legacy ? sheetSignature(sheet, fallbackPaper) : null
}
export async function savedSignatureAsync(saved:any,sheet:any,options:any={},fallbackPaper:any={}){
 if(typeof saved!=='string')return null;if(saved.startsWith('nm2:'))return saved;
 const page=sheet.page,legacy={name:sheet.name,aspect:page.aspect,strokes:page.strokes,backdrop:page.backdrop||null,paper:sheet.paper||fallbackPaper};
 return await equalsJsonAsync(legacy,saved,options)?(await prepareSheetSignature(sheet,options,fallbackPaper)).signature:null;
}

export function bindSheetSignaturePage(page:any,getSheet:()=>any){const existed=bindings.has(page);bindings.set(page,getSheet);if(!existed)page.setSignaturePreparer?.((next:any[],options:any)=>preparePage(page,next,options));}
function frame(sheet:any,fallbackPaper:any={}){const page=sheet.page,extent=page.extent&&(page.extent.x!==0||page.extent.y!==0||page.extent.width!==1||page.extent.height!==1)?JSON.stringify(page.extent):'';return{name:sheet.name,aspect:page.aspect,extent,paper:JSON.stringify(sheet.paper||fallbackPaper),backdrop:page.backdrop||null,strokes:page.strokes,page};}
export async function prepareSheetSignature(sheet:any,options:any={},fallbackPaper:any={}){
 const value=frame(sheet,fallbackPaper),pace=scheduler(options);pace.check();let prefix=prefixes.get(value.strokes)?.get(prefixKey(value.name,value.aspect));
 if(!prefix){const writer=hashWriter().write(JSON.stringify([value.name,value.aspect]).slice(0,-1)+',[');for(let i=0;i<value.strokes.length;i++){const stroke=value.strokes[i];let hash=knownStrokeFingerprint(stroke);if(hash===null){hash=await hashJsonAsync(stroke,options);pace.check();primeStrokeFingerprint(stroke,hash);}writer.write((i?',':'')+JSON.stringify(hash));{const pending=pace.step(20);if(pending)await pending;}}prefix=writer.digest();pace.check();primePrefix(value.strokes,value.name,value.aspect,prefix);}
 const known=backgrounds.get(options.owner||value.page),backdropHash=known?.data===value.backdrop?known.hash:value.backdrop?await hashTextAsync(value.backdrop,options):null;pace.check();
 const owner=options.owner||value.page;if((owner.backdrop||null)===value.backdrop)backgrounds.set(owner,{data:value.backdrop,hash:backdropHash});
 const suffix='],'+JSON.stringify([backdropHash,value.paper,...value.extent?[value.extent]:[]]).slice(1);return{signature:'nm2:'+hashText(suffix,prefix),backdropHash};
}
async function preparePage(page:any,next:any[],options:any={}){
 const get=bindings.get(page);if(!get)return null;const sheet=get();if(!sheet)return null;const changes=options.signatureMetadata||{},future={...page,strokes:next,...changes},snapshot=frame({...sheet,page:future}),key=prefixKey(snapshot.name,snapshot.aspect),valid=()=>!options.signal?.aborted&&(options.valid?.()??true);
 const result=await prepareSheetSignature({...sheet,page:future},{...options,valid,owner:page});
 return{valid:()=>{const latest=get();if(!latest||!valid())return false;const current=frame({...latest,page:{...page,strokes:next,...changes}});return key===prefixKey(current.name,current.aspect)&&current.backdrop===snapshot.backdrop;},commit:()=>{if((page.backdrop||null)===snapshot.backdrop)backgrounds.set(page,{data:snapshot.backdrop,hash:result.backdropHash});}};
}
