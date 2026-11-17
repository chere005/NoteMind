// Camera settings travel as bounded sheet metadata; PNG bytes use the same
// immutable pack references as drawing backgrounds, in their own namespace.
const number = value => typeof value === 'number' && Number.isFinite(value);
const point = value => value && number(value.x) && number(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
const rect = value => value == null || (point(value) && number(value.width) && number(value.height) && value.width >= 0 && value.height >= 0 && value.x + value.width <= 1.001 && value.y + value.height <= 1.001);
const quad = value => value == null || ['topLeft','topRight','bottomLeft','bottomRight'].every(key => point(value[key]));
const PAPER = Object.freeze({kind:'blank',spacing:'medium',colour:'white'});
function cameraMetadata(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || raw.aspect !== undefined && !['free','1',String(4/3),String(16/9)].includes(raw.aspect) || raw.rotation !== undefined && ![0,90,180,270].includes(raw.rotation) || raw.device !== undefined && typeof raw.device !== 'string' || !rect(raw.box) || !rect(raw.zoom) || !quad(raw.corners)) throw Error('Invalid saved camera page settings.');
  const inkRotation=raw.inkRotation??raw.rotation??0,inkAspect=raw.inkAspect??(raw.aspect==null||raw.aspect==='free'?'free':Number(raw.aspect));
  if(![0,90,180,270].includes(inkRotation)||inkAspect!=='free'&&(!number(inkAspect)||inkAspect<.1||inkAspect>10))throw Error('Invalid camera ink reference frame.');
  const {name,strokes,picture,...camera} = raw;
  return {name,aspect:1,paper:{...PAPER},camera:{...camera,inkRotation,inkAspect,aspect:raw.aspect ?? 'free',rotation:raw.rotation ?? 0,device:raw.device ?? '',box:raw.box ?? null,corners:raw.corners ?? null,zoom:raw.zoom ?? null}};
}
function cameraPage(sheet) {
  if (!sheet?.camera) throw Error('Saved camera page metadata is missing.');
  const raw = {...sheet.camera,name:sheet.name};
  cameraMetadata(raw);
  return {...raw,picture:sheet.backdrop ?? null,strokes:sheet.strokes};
}
module.exports = {cameraMetadata,cameraPage,PAPER};
