// Frozen two-pass numerical authority:74805f9 src/ocr/pipeline.ts SHA256 d26f538e89ea142225d6131d92acb28c1992f4fd952b7def4bfc06705ceabd9c
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  DEFAULT_TUNING: () => DEFAULT_TUNING,
  cutStrip: () => cutStrip,
  detectorInput: () => detectorInput,
  detectorSize: () => detectorSize,
  sampleQuad: () => sampleQuad
});
module.exports = __toCommonJS(stdin_exports);
const DEFAULT_TUNING = {
  maxSide: 1600,
  minSide: 640,
  threshold: 0.3,
  boxThreshold: 0.5,
  unclip: 1.6,
  minConfidence: 0.5
};
function sampler(image) {
  const { width, height, data } = image;
  const px = (x, y, c) => {
    const o = (y * width + x) * 4;
    const a = data[o + 3] / 255;
    return data[o + c] * a + 255 * (1 - a);
  };
  return (x, y, out) => {
    const fx = Math.min(width - 1, Math.max(0, x - 0.5)), fy = Math.min(height - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 3; c += 1) {
      const top = px(x0, y0, c) * (1 - ax) + px(x1, y0, c) * ax;
      const bottom = px(x0, y1, c) * (1 - ax) + px(x1, y1, c) * ax;
      out[c] = top * (1 - ay) + bottom * ay;
    }
  };
}
function sampleQuad(image, origin, u, v, outW, outH, release) {
  const take = sampler(image);
  const spanU = Math.hypot(u.x, u.y) / outW, spanV = Math.hypot(v.x, v.y) / outH;
  const k = Math.max(1, Math.min(4, Math.ceil(Math.max(spanU, spanV))));
  const out = new Float32Array(outW * outH * 3);
  const rgb = new Float32Array(3);
  try {
    for (let j = 0; j < outH; j += 1) {
      for (let i = 0; i < outW; i += 1) {
        let r = 0, g = 0, b = 0;
        for (let sj = 0; sj < k; sj += 1) {
          for (let si = 0; si < k; si += 1) {
            const s = (i + (si + 0.5) / k) / outW, t = (j + (sj + 0.5) / k) / outH;
            take(origin.x + u.x * s + v.x * t, origin.y + u.y * s + v.y * t, rgb);
            r += rgb[0];
            g += rgb[1];
            b += rgb[2];
          }
        }
        const o = (j * outW + i) * 3, n = k * k;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
      }
    }
    return out;
  } finally {
    release?.(rgb);
  }
}
function detectorSize(width, height, tuning = DEFAULT_TUNING) {
  let scale = 1;
  if (Math.max(width, height) > tuning.maxSide) scale = tuning.maxSide / Math.max(width, height);
  else if (Math.min(width, height) < tuning.minSide) {
    scale = Math.min(tuning.minSide / Math.min(width, height), tuning.maxSide / Math.max(width, height));
  }
  const round = (side) => Math.max(32, Math.round(side * scale / 32) * 32);
  return { width: round(width), height: round(height) };
}
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
function detectorInput(image, size, release) {
  const rgb = sampleQuad(image, { x: 0, y: 0 }, { x: image.width, y: 0 }, { x: 0, y: image.height }, size.width, size.height, release);
  try {
    const plane = size.width * size.height;
    const out = new Float32Array(plane * 3);
    for (let p = 0; p < plane; p += 1) {
      for (let c = 0; c < 3; c += 1) {
        const value = rgb[p * 3 + (2 - c)] / 255;
        out[c * plane + p] = (value - MEAN[c]) / STD[c];
      }
    }
    return out;
  } finally {
    release?.(rgb);
  }
}
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 3200;
function cutStrip(image, box, release) {
  let u = box.u, v = box.v, hw = box.halfWidth, hh = box.halfHeight;
  if (hh * 2 >= hw * 2 * 1.5) {
    const nu = v, nv = { x: -u.x, y: -u.y };
    u = nu;
    v = nv;
    [hw, hh] = [hh, hw];
  }
  const along = { x: u.x * hw * 2, y: u.y * hw * 2 }, across = { x: v.x * hh * 2, y: v.y * hh * 2 };
  const origin = { x: box.center.x - u.x * hw - v.x * hh, y: box.center.y - u.y * hw - v.y * hh };
  const width = Math.max(1, Math.min(REC_MAX_WIDTH, Math.ceil(REC_HEIGHT * hw / Math.max(1e-6, hh))));
  const padded = Math.max(REC_MIN_WIDTH, width);
  const rgb = sampleQuad(image, origin, along, across, width, REC_HEIGHT, release);
  try {
    const plane = padded * REC_HEIGHT;
    const data = new Float32Array(plane * 3);
    for (let y = 0; y < REC_HEIGHT; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 3;
        for (let c = 0; c < 3; c += 1) data[c * plane + y * padded + x] = rgb[o + (2 - c)] / 127.5 - 1;
      }
    }
    return { data, width, padded, origin, along, across };
  } finally {
    release?.(rgb);
  }
}
