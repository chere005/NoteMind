const number = n => typeof n === 'number' && Number.isFinite(n);
const coordinate = n => number(n) && Number.isFinite(n * 10000);
const stroke = s => !!s && typeof s === 'object' && typeof s.colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(s.colorHex) && coordinate(s.width) && s.width > 0 && Array.isArray(s.points) && s.points.every(p => p && coordinate(p.x) && coordinate(p.y)) && (s.pressures == null || (Array.isArray(s.pressures) && s.pressures.length === s.points.length && s.pressures.every(number)));
const extent = r => r == null || ([r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(coordinate) && r.x<=0 && r.y<=0 && r.width>=1 && r.height>=1 && r.x+r.width>=1 && r.y+r.height>=1);
export const validSheets = data => Array.isArray(data) && data.length > 0 && data.every(item => item && typeof item.name === 'string' && number(item.aspect) && item.aspect >= .1 && item.aspect <= 10 && extent(item.extent) && (item.paper==null || (['blank','dots','lines','grid','isometric','cornell'].includes(item.paper.kind)&&['small','medium','large'].includes(item.paper.spacing)&&['white','cream','dark'].includes(item.paper.colour))) && (item.backdrop==null || (typeof item.backdrop==='string' && /^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(item.backdrop))) && Array.isArray(item.strokes) && item.strokes.every(stroke));
import {scheduler} from '../../sheet-signature-work.cjs';
export async function validSheetsAsync(data,options={}){
 if(!Array.isArray(data)||!data.length)return false;const pace=scheduler(options);pace.check();
 for(const item of data){if(!item||!validSheets([{...item,backdrop:null,strokes:[]}])||!Array.isArray(item.strokes))return false;
  if(item.backdrop!=null){if(typeof item.backdrop!=='string')return false;const start=/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,/i.exec(item.backdrop);if(!start||start[0].length===item.backdrop.length)return false;for(let at=start[0].length;at<item.backdrop.length;at+=65536){const part=item.backdrop.slice(at,at+65536);if(!/^[a-z0-9+/=\r\n]+$/i.test(part))return false;const pause=pace.step(part.length);if(pause)await pause;}}
  for(const ink of item.strokes){if(!ink||typeof ink!=='object'||typeof ink.colorHex!=='string'||!/^#[0-9a-f]{6}$/i.test(ink.colorHex)||!coordinate(ink.width)||ink.width<=0||!Array.isArray(ink.points)||ink.pressures!=null&&(!Array.isArray(ink.pressures)||ink.pressures.length!==ink.points.length))return false;
   for(const p of ink.points){if(!p||!coordinate(p.x)||!coordinate(p.y))return false;const pause=pace.step();if(pause)await pause;}if(ink.pressures!=null)for(const value of ink.pressures){if(!number(value))return false;const pause=pace.step();if(pause)await pause;}const pause=pace.step();if(pause)await pause;
  }
 }pace.check();return true;
}
const point=p=>p&&number(p.x)&&number(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const rect=r=>r==null||(point(r)&&number(r.width)&&number(r.height)&&r.width>=0&&r.height>=0&&r.x+r.width<=1.001&&r.y+r.height<=1.001);
const quad=q=>q==null||['topLeft','topRight','bottomLeft','bottomRight'].every(k=>point(q[k]));
export const validCameraPages = data => Array.isArray(data) && data.length > 0 && data.every(item => item && typeof item.name === 'string' && rect(item.box)&&rect(item.zoom)&&quad(item.corners) && (item.picture === null || (typeof item.picture === 'string' && item.picture.startsWith('data:image/png;base64,'))) && Array.isArray(item.strokes) && item.strokes.every(stroke) && (item.rotation === undefined || [0,90,180,270].includes(item.rotation)) && (item.device === undefined || typeof item.device === 'string') && (item.aspect===undefined || ['free','1',String(4/3),String(16/9)].includes(item.aspect)));

