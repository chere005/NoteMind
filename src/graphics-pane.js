(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoteMindGraphics = api;
})(typeof window === 'undefined' ? this : window, function () {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const coordinate = n => finite(n) && Number.isFinite(n*10000);
  const validExtent = r => r && [r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(coordinate) && r.x<=0 && r.y<=0 && r.width>=1 && r.height>=1 && r.x+r.width>=1 && r.y+r.height>=1;
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  const bounds = new WeakMap();
  const selected = (s, b) => {
    let box = globalThis.NoteMindStrokeBounds?.strokeBox(s)||bounds.get(s);
    if (!box || box.count !== s.points.length) { box = {count:s.points.length,x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};for(const p of s.points){box.x=Math.min(box.x,p.x);box.y=Math.min(box.y,p.y);box.right=Math.max(box.right,p.x);box.bottom=Math.max(box.bottom,p.y);}bounds.set(s,box); }
    return box.count>0 && box.x>=b.x && box.y>=b.y && box.right<=b.x+b.width && box.bottom<=b.y+b.height;
  };
  function validate(sheet) {
    if (!sheet || !finite(sheet.aspect) || sheet.aspect < .1 || sheet.aspect > 10 || !Array.isArray(sheet.strokes)) throw Error('Invalid graphics pane.');
    if (sheet.extent != null && !validExtent(sheet.extent)) throw Error('Invalid graphics paper extent.');
    if (sheet.backdrop != null && (typeof sheet.backdrop !== 'string' || !/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(sheet.backdrop))) throw Error('Invalid graphics background.');
    let points = 0;
    for (const s of sheet.strokes) {
      if (!s || !/^#[0-9a-f]{6}$/i.test(s.colorHex) || !coordinate(s.width) || s.width <= 0 || !Array.isArray(s.points) || !s.points.every(p => p && coordinate(p.x) && coordinate(p.y)) || (s.pressures != null && (!Array.isArray(s.pressures) || s.pressures.length !== s.points.length || !s.pressures.every(finite)))) throw Error('Invalid graphics stroke.');
      points += s.points.length;
      if (points > 2000000) throw Error('This graphics pane has too many points.');
    }
    return sheet;
  }
  function encode(sheet) {
    validate(sheet);
    return JSON.stringify({ format: 'notemind-graphics', version: 1, name: sheet.name || 'Drawing', aspect: sheet.aspect,
      paper: sheet.paper, backdrop: sheet.backdrop || null, extent: sheet.extent,
      strokes: sheet.strokes.map(s => [s.colorHex, s.width, s.points.flatMap(p => [p.x, p.y]), ...(s.pressures ? [s.pressures] : [])]) });
  }
  function decode(raw) {
    if (typeof raw !== 'string' && (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer)) {
      if (isBinary(raw)) return readBinary(raw,true);
      raw = textOf(bytesOf(raw));
    }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (data?.format == null) return validate(data);
    if (data.format !== 'notemind-graphics' || data.version !== 1 || !Array.isArray(data.strokes)) throw Error('Unsupported graphics pane.');
    const strokes = data.strokes.map(row => {
      if (!Array.isArray(row) || !Array.isArray(row[2]) || row[2].length % 2) throw Error('Invalid graphics points.');
      const points = [];
      for (let i = 0; i < row[2].length; i += 2) points.push({ x: row[2][i], y: row[2][i + 1] });
      return { colorHex: row[0], width: row[1], points, ...(row[3] ? { pressures: row[3] } : {}) };
    });
    return validate({ name: data.name || 'Drawing', aspect: data.aspect, paper: data.paper, backdrop: data.backdrop || null, strokes, ...(data.extent ? { extent: data.extent } : {}) });
  }
  const BINARY_MAGIC = 'NMGFX2\r\n', MAX_BINARY_BYTES = 150*1024*1024, MAX_METADATA_BYTES = 70*1024*1024, MAX_POINTS = 2000000;
  let yieldChannel;const yieldWaiters=[];
  function yieldTask(){return new Promise(resolve=>{if(typeof setImmediate==='function'){setImmediate(resolve);return;}if(typeof MessageChannel==='function'){if(!yieldChannel){yieldChannel=new MessageChannel();yieldChannel.port1.onmessage=()=>yieldWaiters.shift()?.();}yieldWaiters.push(resolve);yieldChannel.port2.postMessage(0);}else setTimeout(resolve,0);});}
  const bytesOf = value => value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer,value.byteOffset,value.byteLength) : (()=>{throw Error('Invalid binary graphics data.');})();
  const utf8 = text => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : new Uint8Array(Buffer.from(text,'utf8'));
  const textOf = bytes => typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8',{fatal:true}).decode(bytes) : Buffer.from(bytes).toString('utf8');
  function isBinary(value) {
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return false;
    const bytes=bytesOf(value);return bytes.length>=BINARY_MAGIC.length&&[...BINARY_MAGIC].every((char,index)=>bytes[index]===char.charCodeAt(0));
  }
  function binaryMeta(sheet) {
    const metadata={name:sheet.name||'Drawing',aspect:sheet.aspect,paper:sheet.paper,backdrop:sheet.backdrop||null,extent:sheet.extent};
    if(typeof metadata.name!=='string')throw Error('Invalid graphics name.');
    validate({...metadata,strokes:[]});return metadata;
  }
  // Exact Float64 coordinates/pressure, with one small header per stroke. Preview pixels
  // can be bounded independently; the editable source never rounds or drops points.
  function encodeBytes(sheet) {
    validate(sheet);if(sheet.strokes.length>MAX_POINTS)throw Error('This graphics pane has too many strokes.');
    const metadata=utf8(JSON.stringify(binaryMeta(sheet)));if(metadata.length>MAX_METADATA_BYTES)throw Error('The graphics background is too large.');
    let points=0,length=24+metadata.length;
    for(const stroke of sheet.strokes){points+=stroke.points.length;length+=16+stroke.points.length*(stroke.pressures?24:16);}
    if(length>MAX_BINARY_BYTES)throw Error('This graphics pane is too large.');
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);for(let i=0;i<BINARY_MAGIC.length;i++)bytes[i]=BINARY_MAGIC.charCodeAt(i);
    view.setUint32(8,metadata.length,true);view.setUint32(12,sheet.strokes.length,true);view.setUint32(16,points,true);view.setUint32(20,length,true);bytes.set(metadata,24);let at=24+metadata.length;
    for(const stroke of sheet.strokes){const colour=parseInt(stroke.colorHex.slice(1),16);let flags=stroke.pressures?1:0;for(let i=0;i<6;i++){const code=stroke.colorHex.charCodeAt(i+1);if(code>=65&&code<=70)flags|=1<<(i+1);}bytes[at]=colour>>>16;bytes[at+1]=(colour>>>8)&255;bytes[at+2]=colour&255;bytes[at+3]=flags;view.setFloat64(at+4,stroke.width,true);view.setUint32(at+12,stroke.points.length,true);at+=16;
      for(let i=0;i<stroke.points.length;i++){view.setFloat64(at,stroke.points[i].x,true);view.setFloat64(at+8,stroke.points[i].y,true);at+=16;if(stroke.pressures){view.setFloat64(at,stroke.pressures[i],true);at+=8;}}
    }return bytes;
  }
  async function encodeBytesAsync(sheet,{yieldControl=yieldTask,signal}={}) {
    const pause=async()=>{if(signal?.aborted){const error=Error('Drawing export cancelled.');error.name='AbortError';throw error;}await yieldControl();if(signal?.aborted){const error=Error('Drawing export cancelled.');error.name='AbortError';throw error;}};
    await pause();
    if(!sheet||!Array.isArray(sheet.strokes)||sheet.strokes.length>MAX_POINTS)throw Error('Invalid graphics pane.');
    const meta=binaryMeta({...sheet,backdrop:null}),backdrop=sheet.backdrop==null?null:sheet.backdrop;
    // Base64 backdrops are ASCII. Escape/encode their bounded chunks rather than
    // JSON.stringify'ing a potentially 67 MB string on the input thread.
    const prefix=utf8(JSON.stringify({name:meta.name,aspect:meta.aspect,paper:meta.paper}).slice(0,-1)+',"backdrop":'),suffix=utf8(meta.extent===undefined?'}':',"extent":'+JSON.stringify(meta.extent)+'}'),parts=[prefix];let metadataLength=prefix.length+suffix.length;
    if(backdrop!==null){if(typeof backdrop!=='string'||!/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,/i.test(backdrop))throw Error('Invalid graphics background.');const start=backdrop.indexOf(',')+1;if(start===backdrop.length)throw Error('Invalid graphics background.');parts.push(utf8('"'));metadataLength+=2;
      for(let at=0;at<backdrop.length;at+=65536){const piece=backdrop.slice(at,at+65536);if(at+65536>start&&!/^[a-z0-9+/=\r\n]+$/i.test(piece.slice(Math.max(0,start-at))))throw Error('Invalid graphics background.');const encoded=utf8(JSON.stringify(piece).slice(1,-1));parts.push(encoded);metadataLength+=encoded.length;if(metadataLength>MAX_METADATA_BYTES)throw Error('The graphics background is too large.');await pause();}parts.push(utf8('"'));
    }else{parts.push(utf8('null'));metadataLength+=4;}parts.push(suffix);
    if(metadataLength>MAX_METADATA_BYTES)throw Error('The graphics background is too large.');
    let points=0,length=24+metadataLength,work=0;
    for(const stroke of sheet.strokes){if(!stroke||!/^#[0-9a-f]{6}$/i.test(stroke.colorHex)||!coordinate(stroke.width)||stroke.width<=0||!Array.isArray(stroke.points)||(stroke.pressures!=null&&(!Array.isArray(stroke.pressures)||stroke.pressures.length!==stroke.points.length)))throw Error('Invalid graphics stroke.');points+=stroke.points.length;length+=16+stroke.points.length*(stroke.pressures?24:16);if(points>MAX_POINTS)throw Error('This graphics pane has too many points.');if(length>MAX_BINARY_BYTES)throw Error('This graphics pane is too large.');if(++work%8192===0)await pause();}
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);for(let i=0;i<BINARY_MAGIC.length;i++)bytes[i]=BINARY_MAGIC.charCodeAt(i);view.setUint32(8,metadataLength,true);view.setUint32(12,sheet.strokes.length,true);view.setUint32(16,points,true);view.setUint32(20,length,true);let at=24;for(const part of parts){bytes.set(part,at);at+=part.length;}
    for(const stroke of sheet.strokes){const colour=parseInt(stroke.colorHex.slice(1),16);let flags=stroke.pressures?1:0;for(let i=0;i<6;i++){const code=stroke.colorHex.charCodeAt(i+1);if(code>=65&&code<=70)flags|=1<<(i+1);}bytes[at]=colour>>>16;bytes[at+1]=(colour>>>8)&255;bytes[at+2]=colour&255;bytes[at+3]=flags;view.setFloat64(at+4,stroke.width,true);view.setUint32(at+12,stroke.points.length,true);at+=16;
      for(let i=0;i<stroke.points.length;i++){const point=stroke.points[i];if(!point||!coordinate(point.x)||!coordinate(point.y)||(stroke.pressures&&!finite(stroke.pressures[i])))throw Error('Invalid graphics point.');view.setFloat64(at,point.x,true);view.setFloat64(at+8,point.y,true);at+=16;if(stroke.pressures){view.setFloat64(at,stroke.pressures[i],true);at+=8;}if(++work%8192===0)await pause();}if(++work%8192===0)await pause();
    }await pause();return bytes;
  }
  function readBinary(value,materialize) {
    const bytes=bytesOf(value);if(!isBinary(bytes)||bytes.length<24||bytes.length>MAX_BINARY_BYTES)throw Error('Invalid binary graphics data.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),metadataLength=view.getUint32(8,true),strokeCount=view.getUint32(12,true),pointCount=view.getUint32(16,true);
    if(view.getUint32(20,true)!==bytes.length||metadataLength>MAX_METADATA_BYTES||metadataLength>bytes.length-24||strokeCount>MAX_POINTS||pointCount>MAX_POINTS)throw Error('Invalid binary graphics size.');
    const metadata=JSON.parse(textOf(bytes.subarray(24,24+metadataLength)));if(!metadata||typeof metadata!=='object'||typeof metadata.name!=='string')throw Error('Invalid binary graphics metadata.');binaryMeta(metadata);
    let at=24+metadataLength,seen=0;const strokes=materialize?[]:null;
    for(let index=0;index<strokeCount;index++){
      if(at+16>bytes.length)throw Error('Truncated binary graphics stroke.');
      const flags=bytes[at+3],hasPressure=flags&1,width=view.getFloat64(at+4,true),count=view.getUint32(at+12,true);let colour;
      if(materialize){const hex=[bytes[at],bytes[at+1],bytes[at+2]].map(v=>v.toString(16).padStart(2,'0')).join('');colour='#'+[...hex].map((c,i)=>flags&(1<<(i+1))?c.toUpperCase():c).join('');}at+=16;
      if(flags>127||!coordinate(width)||width<=0||count>pointCount-seen||at+count*(hasPressure?24:16)>bytes.length)throw Error('Invalid binary graphics stroke.');
      seen+=count;const points=materialize?[]:null,pressures=materialize&&hasPressure?[]:null;
      for(let point=0;point<count;point++){
        const x=view.getFloat64(at,true),y=view.getFloat64(at+8,true);at+=16;if(!coordinate(x)||!coordinate(y))throw Error('Invalid binary graphics point.');if(points)points.push({x,y});
        if(hasPressure){const pressure=view.getFloat64(at,true);at+=8;if(!finite(pressure))throw Error('Invalid binary graphics pressure.');if(pressures)pressures.push(pressure);}
      }
      if(strokes)strokes.push({colorHex:colour,width,points,...(pressures?{pressures}:{})});
    }
    if(seen!==pointCount||at!==bytes.length)throw Error('Invalid binary graphics length.');return materialize?{...metadata,strokes}:true;
  }
  const validateBinary = bytes => readBinary(bytes,false);
  function bytesBase64(bytes) {
    if(typeof bytes.toBase64==='function')return bytes.toBase64();
    if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    const parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));
  }
  function encodeBase64(sheet) {
    let points=0;for(const stroke of sheet.strokes)points+=stroke.points.length;
    return bytesBase64(points>=10000?encodeBytes(sheet):utf8(encode(sheet)));
  }
  function decodeBase64(data) {
    let bytes;if(typeof Uint8Array.fromBase64==='function')bytes=Uint8Array.fromBase64(data);else if(typeof Buffer!=='undefined')bytes=new Uint8Array(Buffer.from(data,'base64'));else{const raw=atob(data);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));}
    return decode(bytes);
  }
  const asyncPause = async options => {if(options.signal?.aborted){const error=Error('Drawing load cancelled.');error.name='AbortError';throw error;}await (options.yieldControl||yieldTask)();if(options.signal?.aborted){const error=Error('Drawing load cancelled.');error.name='AbortError';throw error;}};
  async function decodeAsync(raw,options={}) {
    await asyncPause(options);let bytes=typeof raw==='string'?utf8(raw):bytesOf(raw),extra=null,hashes=options.prepared||null;
    const exporter=globalThis.NoteMindDrawingExport,normalizer=options.normalize||exporter?.normalize,releasePrivate=options.owned===true&&!options.prepared&&!options.normalize?exporter?.releaseNormalizedPacket:null;let privatePacket=null;
    try {
    const header=isBinary(bytes)&&bytes.length>=24?new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength):null;
    if(!options.prepared&&(!header||header.getUint32(8,true)>65536||(!options.onStroke&&header.getUint32(16,true)>=50000))&&normalizer){const packet=await normalizer(bytes,{signal:options.signal,owned:options.owned===true});if(releasePrivate)privatePacket=packet;bytes=bytesOf(packet.bytes);extra=packet.metadata;hashes=packet;}
    if(!isBinary(bytes))return decode(bytes);
    if(bytes.length<24||bytes.length>MAX_BINARY_BYTES)throw Error('Invalid binary graphics data.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),metadataLength=view.getUint32(8,true),strokeCount=view.getUint32(12,true),pointCount=view.getUint32(16,true);
    if(view.getUint32(20,true)!==bytes.length||metadataLength>MAX_METADATA_BYTES||metadataLength>bytes.length-24||strokeCount>MAX_POINTS||pointCount>MAX_POINTS)throw Error('Invalid binary graphics size.');
    const metadata=JSON.parse(textOf(bytes.subarray(24,24+metadataLength)));if(!metadata||typeof metadata!=='object'||typeof metadata.name!=='string')throw Error('Invalid binary graphics metadata.');binaryMeta(metadata);
    const idle=options.allocationYield===false?null:options.allocationYield||(typeof window!=='undefined'&&typeof requestIdleCallback==='function'&&pointCount>=50000?()=>new Promise(resolve=>requestIdleCallback(()=>resolve(),{timeout:32})):null);let allocationChunks=0;const decodePause=async()=>{await asyncPause(options);if(idle&&++allocationChunks%4===0){await idle();if(options.signal?.aborted){const error=Error('Drawing load cancelled.');error.name='AbortError';throw error;}}};
    const strokes=new Array(strokeCount),colours=new Map(),inkBounds={count:0,x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};let at=24+metadataLength,seen=0,work=0;const hashView=hashes?.hashBytes?new DataView(hashes.hashBytes.buffer,hashes.hashBytes.byteOffset,hashes.hashBytes.byteLength):null;if(hashView&&hashView.byteLength!==strokeCount*8)throw Error('Invalid drawing fingerprints.');
    for(let index=0;index<strokeCount;index++){
      if(at+16>bytes.length)throw Error('Truncated binary graphics stroke.');const flags=bytes[at+3],hasPressure=flags&1,width=view.getFloat64(at+4,true),count=view.getUint32(at+12,true),rgb=bytes[at]*65536+bytes[at+1]*256+bytes[at+2],colourKey=rgb*64+(flags>>>1);let colour=colours.get(colourKey);if(colour===undefined){const hex=rgb.toString(16).padStart(6,'0');colour='#'+[...hex].map((c,i)=>flags&(1<<(i+1))?c.toUpperCase():c).join('');if(colours.size<256)colours.set(colourKey,colour);}at+=16;
      if(flags>127||!coordinate(width)||width<=0||count>pointCount-seen||at+count*(hasPressure?24:16)>bytes.length)throw Error('Invalid binary graphics stroke.');seen+=count;const reuse=hasPressure?options.pressuresForStroke?.(index,count):null;if(reuse!=null&&(!Array.isArray(reuse)||reuse.length!==count))throw Error('Invalid shared drawing pressure.');const points=new Array(count),pressures=hasPressure?(reuse||new Array(count)):null;
      const box={x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};for(let point=0;point<count;point++){const x=view.getFloat64(at,true),y=view.getFloat64(at+8,true);at+=16;if(!coordinate(x)||!coordinate(y))throw Error('Invalid binary graphics point.');points[point]={x,y};box.x=Math.min(box.x,x);box.y=Math.min(box.y,y);box.right=Math.max(box.right,x);box.bottom=Math.max(box.bottom,y);if(hasPressure){const pressure=view.getFloat64(at,true);at+=8;if(!finite(pressure))throw Error('Invalid binary graphics pressure.');if(reuse){if(!Object.is(pressure,reuse[point]))throw Error('Invalid shared drawing pressure.');}else pressures[point]=pressure;}if(++work%8192===0)await decodePause();}
      if(count){inkBounds.count+=count;inkBounds.x=Math.min(inkBounds.x,box.x);inkBounds.y=Math.min(inkBounds.y,box.y);inkBounds.right=Math.max(inkBounds.right,box.right);inkBounds.bottom=Math.max(inkBounds.bottom,box.bottom);}const stroke={colorHex:colour,width,points,...(pressures?{pressures}:{})};globalThis.NoteMindDrawingHistory?.primeStroke(stroke);globalThis.NoteMindStrokeBounds?.primeStrokeBox(stroke,box);const signatures=globalThis.NoteMindStrokeSignatures;if(hashView&&signatures?.primeStrokeFingerprintWords)signatures.primeStrokeFingerprintWords(stroke,hashView.getUint32(index*8,true),hashView.getUint32(index*8+4,true));else{const hash=hashView?hashView.getUint32(index*8,true).toString(16).padStart(8,'0')+hashView.getUint32(index*8+4,true).toString(16).padStart(8,'0'):hashes?.strokeHashes?.[index];if(hash)signatures?.primeStrokeFingerprint(stroke,hash);}options.onStroke?.(stroke,index);strokes[index]=stroke;if(++work%8192===0)await decodePause();
    }
    if(seen!==pointCount||at!==bytes.length||hashes?.strokeHashes&&hashes.strokeHashes.length!==strokeCount)throw Error('Invalid binary graphics length.');let backdrop=extra?.backdrop??metadata.backdrop;if(hashes?.backdropBytes){backdrop='';const data=bytesOf(hashes.backdropBytes),decode=new TextDecoder('utf-8',{fatal:true});for(let offset=0;offset<data.length;offset+=65536){backdrop+=decode.decode(data.subarray(offset,offset+65536));await asyncPause(options);}}await asyncPause(options);globalThis.NoteMindStrokeBounds?.primeInkBox(strokes,inkBounds);if(!options.onStroke&&!options.pressuresForStroke)globalThis.NoteMindDrawingHistory?.primeDecodedArray?.(strokes);const sheet={...metadata,...extra,backdrop,strokes};globalThis.NoteMindStrokeSignatures?.primeDecodedSheet(sheet,{validated:true,backdropHash:hashes?.backdropHash});return sheet;
    } finally { if(privatePacket)releasePrivate(privatePacket); }
  }
  async function decodeBase64Async(data,options={}) {
    if(typeof data!=='string'||!data.length||data.length>Math.ceil(MAX_BINARY_BYTES/3)*4)throw Error('Invalid encoded graphics data.');const bytes=new Uint8Array(Math.floor(data.length/4)*3+3);let offset=0,carry='';
    for(let at=0;at<data.length;at+=65536){const text=data.slice(at,at+65536);if(!/^[a-z0-9+/=\r\n]+$/i.test(text))throw Error('Invalid encoded graphics data.');carry+=text.replace(/[\r\n]/g,'');const length=at+65536<data.length?carry.length-carry.length%4:carry.length,piece=carry.slice(0,length);carry=carry.slice(length);if(piece){let chunk;if(typeof Uint8Array.fromBase64==='function')chunk=Uint8Array.fromBase64(piece);else if(typeof Buffer!=='undefined')chunk=Buffer.from(piece,'base64');else chunk=Uint8Array.from(atob(piece),c=>c.charCodeAt(0));bytes.set(chunk,offset);offset+=chunk.length;}await asyncPause(options);}
    return decodeAsync(bytes.subarray(0,offset),{...options,owned:true});
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
  async function cropAsync(sheet,box,{signal,yieldControl=yieldTask}={}){
    if(!box)return sheet; // Worker input is already validated and immutable.
    if(!(box.width>0&&box.height>0))throw Error('Select an area of the sheet.');
    const strokes=[];let work=0;const pause=async()=>{if(signal?.aborted)throw Error('Drawing export cancelled.');await yieldControl();if(signal?.aborted)throw Error('Drawing export cancelled.');},normalize=p=>({x:(p.x-box.x)/box.width,y:(p.y-box.y)/box.height});
    for(const s of sheet.strokes){
      if(selected(s,box)){const points=[];for(const point of s.points){points.push(normalize(point));if(++work%8192===0)await pause();}strokes.push({...s,width:s.width/box.width,points});}
      else{let points=[],pressures=[];const flush=()=>{if(points.length)strokes.push({colorHex:s.colorHex,width:s.width/box.width,points,...(s.pressures?{pressures}:{})});points=[];pressures=[];};
        for(let i=1;i<s.points.length;i++){
          const a=s.points[i-1],b=s.points[i],dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1,clipped=false;
          for(const [p,q]of [[-dx,a.x-box.x],[dx,box.x+box.width-a.x],[-dy,a.y-box.y],[dy,box.y+box.height-a.y]]){if(p===0){if(q<0)clipped=true;continue;}const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);}
          if(clipped||lo>hi)flush();else{const point=t=>normalize({x:a.x+dx*t,y:a.y+dy*t}),start=point(lo),end=point(hi),last=points[points.length-1];if(last&&(Math.abs(last.x-start.x)>1e-9||Math.abs(last.y-start.y)>1e-9))flush();const pressure=t=>s.pressures[i-1]+(s.pressures[i]-s.pressures[i-1])*t;if(!points.length){points.push(start);if(s.pressures)pressures.push(pressure(lo));}points.push(end);if(s.pressures)pressures.push(pressure(hi));if(hi<1)flush();}
          if(++work%8192===0)await pause();
        }flush();
      }
      if(++work%8192===0)await pause();
    }return {...sheet,aspect:sheet.aspect*box.width/box.height,backdrop:null,strokes};
  }
  return { encode, decode, validate, transform, crop, cropAsync, selected, BINARY_MAGIC, MAX_BINARY_BYTES, isBinary, validateBinary, encodeBytes, encodeBytesAsync, bytesBase64, encodeBase64, decodeBase64, decodeAsync, decodeBase64Async, yieldTask };
});
