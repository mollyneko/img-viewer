'use strict';

// 极简 baseline TIFF 解码器（零依赖）
//
// 为什么需要它：Chromium 自己不会解码 TIFF，而原来的降级链路是「挖内嵌 JPEG
// 预览」—— 可现实中绝大多数 TIFF（扫描件、Photoshop 存的未压缩/LZW TIFF）
// 里面根本没有内嵌 JPEG。实测 3 种压缩（未压缩 / LZW / JPEG-in-TIFF）全部
// 拿不到预览，也就是 .tif/.tiff 等于打不开。这里补上真正的解码。
//
// 支持范围（覆盖主流场景）：
//   压缩：1 未压缩 / 5 LZW / 8、32946 Deflate / 32773 PackBits
//   位深：8 位（灰、RGB、RGBA、调色板、CMYK），16 位（取高字节）
//   布局：chunky（PlanarConfiguration=1），多 strip
//   预测器：Predictor=2（水平差分，8 位）
// 不支持的（返回 null，让上层按「无预览」处理，不崩）：
//   JPEG 压缩(7)、CCITT 传真(2/3/4)、分平面存储(2)、tiled(322)、BigTIFF、16 位预测器
//
// 输出统一为 24 位 BMP —— 主进程 nativeImage 能直接读，Chromium 也能直接显示。

const fsp = require('node:fs/promises');
const zlib = require('node:zlib');

const MAX_PIXELS = 80 * 1024 * 1024;   // 80MP 以上不接（BMP 会占 240MB+）

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

// ---------------------------------------------------------------- 基础读取

function makeReader(buf, le) {
  return {
    u16: (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)),
    u32: (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)),
  };
}

// 读一个 IFD 条目；count*size <= 4 时值内联，否则值是偏移
function readEntry(buf, off, le, r) {
  const tag = r.u16(off);
  const type = r.u16(off + 2);
  const count = r.u32(off + 4);
  const size = TYPE_SIZE[type];
  if (!size) return null;
  const total = size * count;
  if (total > 64 * 1024 * 1024) return null;
  const at = total <= 4 ? off + 8 : r.u32(off + 8);
  if (at + total > buf.length) return null;

  const vals = [];
  for (let i = 0; i < count; i++) {
    const p = at + i * size;
    switch (type) {
      case 1: case 7: vals.push(buf[p]); break;
      case 6: vals.push(buf.readInt8(p)); break;
      case 3: vals.push(le ? buf.readUInt16LE(p) : buf.readUInt16BE(p)); break;
      case 8: vals.push(le ? buf.readInt16LE(p) : buf.readInt16BE(p)); break;
      case 4: vals.push(le ? buf.readUInt32LE(p) : buf.readUInt32BE(p)); break;
      case 9: vals.push(le ? buf.readInt32LE(p) : buf.readInt32BE(p)); break;
      case 5: vals.push(le ? buf.readUInt32LE(p) : buf.readUInt32BE(p)); break;
      default: vals.push(0);
    }
  }
  return { tag, type, count, vals };
}

function readIfd(buf, off, le) {
  const r = makeReader(buf, le);
  if (off + 2 > buf.length) return null;
  const n = r.u16(off);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const at = off + 2 + i * 12;
    if (at + 12 > buf.length) break;
    const e = readEntry(buf, at, le, r);
    if (e) tags.set(e.tag, e);
  }
  const next = off + 2 + n * 12 + 4 <= buf.length ? r.u32(off + 2 + n * 12) : 0;
  return { tags, next };
}

const one = (t, d = 0) => (t && t.vals.length ? t.vals[0] : d);
const many = (t) => (t ? t.vals : []);

// ---------------------------------------------------------------- 解压

// TIFF 版 LZW：MSB 对齐、9→12 位、提前一位加宽（early change）
function lzwDecode(src, expected) {
  const out = Buffer.allocUnsafe(expected);
  let outPos = 0;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let dictSize = 258;
  let bits = 9;
  let old = -1;
  let first = 0;

  let bitBuf = 0;
  let bitCnt = 0;
  let pos = 0;

  const reset = () => {
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; }
    dictSize = 258;
    bits = 9;
    old = -1;
  };
  const readCode = () => {
    while (bitCnt < bits) {
      if (pos >= src.length) return -1;
      bitBuf = ((bitBuf << 8) | src[pos++]) >>> 0;
      bitCnt += 8;
    }
    const shift = bitCnt - bits;
    const code = (bitBuf >>> shift) & ((1 << bits) - 1);
    bitCnt = shift;
    bitBuf &= (1 << shift) - 1;
    return code;
  };

  reset();
  let code = readCode();
  if (code === 256) { reset(); code = readCode(); }
  if (code < 0) return out.subarray(0, outPos);
  out[outPos++] = code;
  first = code;
  old = code;

  while (true) {
    code = readCode();
    if (code < 0 || code === 257) break;
    if (code === 256) {
      reset();
      code = readCode();
      if (code < 0 || code === 257) break;
      out[outPos++] = code;
      first = code;
      old = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= dictSize) {
      stack[sp++] = first;
      code = old;
    }
    while (code > 255) {
      if (sp >= 4096) return out.subarray(0, outPos);   // 数据损坏，止损
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    while (sp > 0) {
      if (outPos >= expected) return out;
      out[outPos++] = stack[--sp];
    }
    if (dictSize < 4096) {
      prefix[dictSize] = old;
      suffix[dictSize] = first;
      dictSize++;
      if (dictSize === (1 << bits) - 1 && bits < 12) bits++;
    }
    old = inCode;
  }
  return out.subarray(0, outPos);
}

function packBitsDecode(src, expected) {
  const out = Buffer.allocUnsafe(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const n = src.readInt8(i++);
    if (n >= 0) {
      const len = n + 1;
      for (let k = 0; k < len && o < expected; k++) out[o++] = src[i + k] || 0;
      i += len;
    } else if (n !== -128) {
      const len = 1 - n;
      const v = src[i++] || 0;
      for (let k = 0; k < len && o < expected; k++) out[o++] = v;
    }
  }
  return out.subarray(0, o);
}

function inflate(src, expected) {
  let raw;
  try {
    raw = zlib.inflateSync(src);
  } catch {
    try { raw = zlib.inflateRawSync(src); } catch { return null; }
  }
  return raw.length === expected ? raw : raw.subarray(0, Math.min(raw.length, expected));
}

// ---------------------------------------------------------------- 像素组装

function applyPredictor2(buf, rowBytes, rows, spp) {
  for (let y = 0; y < rows; y++) {
    const base = y * rowBytes;
    for (let x = spp; x < rowBytes; x++) {
      buf[base + x] = (buf[base + x] + buf[base + x - spp]) & 0xff;
    }
  }
}

function toRgb24(raw, w, h, spp, bits, photometric, colorMap, le) {
  const out = Buffer.allocUnsafe(w * h * 3);
  // 16 位 → 8 位取高字节：小端存 [低, 高]，大端存 [高, 低]
  const hi = bits === 16 ? (le ? 1 : 0) : 0;
  const stride = bits === 16 ? 2 : 1;
  const at = (idx) => (bits === 16 ? raw[idx * stride + hi] : raw[idx]);

  for (let p = 0, i = 0; p < w * h; p++, i += spp) {
    let r;
    let g;
    let b;
    if (photometric === 3) {                       // 调色板
      const idx = at(i);
      const n = colorMap.length / 3;
      r = (colorMap[idx] || 0) >> 8;
      g = (colorMap[n + idx] || 0) >> 8;
      b = (colorMap[2 * n + idx] || 0) >> 8;
    } else if (spp >= 3) {
      if (photometric === 5) {                     // CMYK
        const c = at(i);
        const m = at(i + 1);
        const y = at(i + 2);
        const k = at(i + 3);
        r = ((255 - c) * (255 - k) / 255) | 0;
        g = ((255 - m) * (255 - k) / 255) | 0;
        b = ((255 - y) * (255 - k) / 255) | 0;
      } else {
        r = at(i); g = at(i + 1); b = at(i + 2);
      }
    } else {                                       // 灰度
      const v = at(i);
      const gv = photometric === 0 ? 255 - v : v;  // 0 = WhiteIsZero
      r = g = b = gv;
    }
    out[p * 3] = r;
    out[p * 3 + 1] = g;
    out[p * 3 + 2] = b;
  }
  return out;
}

function toBmp(rgb, w, h) {
  const rowBytes = w * 3;
  const pad = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + pad;
  const pixels = stride * h;
  const out = Buffer.alloc(54 + pixels);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);        // 正高度 = 自下而上
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(pixels, 34);
  out.writeUInt32LE(2835, 38);
  out.writeUInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const src = y * rowBytes;
    const dst = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      out[dst + x * 3] = rgb[src + x * 3 + 2];     // BMP 是 BGR
      out[dst + x * 3 + 1] = rgb[src + x * 3 + 1];
      out[dst + x * 3 + 2] = rgb[src + x * 3];
    }
  }
  return out;
}

// ---------------------------------------------------------------- 主入口

function decodeBuffer(buf) {
  if (buf.length < 8) return null;
  const sig = buf.toString('latin1', 0, 2);
  let le;
  if (sig === 'II') le = true;
  else if (sig === 'MM') le = false;
  else return null;

  const r = makeReader(buf, le);
  const magic = r.u16(2);
  if (magic === 43) return null;                   // BigTIFF 暂不支持
  if (magic !== 42) return null;

  const ifd0 = readIfd(buf, r.u32(4), le);
  if (!ifd0) return null;
  const t = ifd0.tags;

  let w = one(t.get(256));
  let h = one(t.get(257));
  if (!w || !h || w * h > MAX_PIXELS) {
    // 有些文件只在 IFD1 里有尺寸（罕见），再试一次
    if (ifd0.next) {
      const i1 = readIfd(buf, ifd0.next, le);
      if (i1) { w = w || one(i1.tags.get(256)); h = h || one(i1.tags.get(257)); }
    }
    if (!w || !h || w * h > MAX_PIXELS) return null;
  }

  const bpsArr = many(t.get(258));
  const bits = bpsArr.length ? bpsArr[0] : 1;
  if (bits !== 8 && bits !== 16) return null;      // 1/2/4 位（传真、老扫描）不接
  if (bpsArr.some((v) => v !== bits)) return null;

  const compression = one(t.get(259), 1);
  const photometric = one(t.get(262), 2);
  const spp = one(t.get(277), 1);
  const planar = one(t.get(284), 1);
  const predictor = one(t.get(317), 1);
  const rowsPerStrip = one(t.get(278), h) || h;
  const stripOffsets = many(t.get(273));
  const stripCounts = many(t.get(279));
  const colorMap = many(t.get(320));

  if (planar !== 1) return null;                   // 分平面存储暂不支持
  if (!stripOffsets.length) return null;
  if (compression === 7) return null;              // JPEG-in-TIFF：交给内嵌预览扫描
  if (compression !== 1 && compression !== 5 && compression !== 8 &&
      compression !== 32946 && compression !== 32773) return null;
  if (predictor === 2 && bits !== 8) return null;

  const bytesPerSample = bits / 8;
  const rowBytes = w * spp * bytesPerSample;
  const raw = Buffer.allocUnsafe(rowBytes * h);
  let written = 0;

  for (let s = 0; s < stripOffsets.length; s++) {
    const off = stripOffsets[s];
    const len = stripCounts[s] != null ? stripCounts[s] : (stripOffsets[s + 1] != null ? stripOffsets[s + 1] - off : buf.length - off);
    if (off >= buf.length || len <= 0) continue;
    const end = Math.min(buf.length, off + len);
    const src = buf.subarray(off, end);
    const rows = Math.min(rowsPerStrip, h - Math.floor(written / rowBytes));
    if (rows <= 0) break;
    const need = rows * rowBytes;

    let chunk;
    if (compression === 1) chunk = src.subarray(0, Math.min(src.length, need));
    else if (compression === 5) chunk = lzwDecode(src, need);
    else if (compression === 32773) chunk = packBitsDecode(src, need);
    else chunk = inflate(src, need);

    if (!chunk || !chunk.length) continue;
    if (predictor === 2) applyPredictor2(chunk, rowBytes, rows, spp);

    const take = Math.min(chunk.length, raw.length - written);
    chunk.copy(raw, written, 0, take);
    written += take;
    if (written >= raw.length) break;
  }

  if (written < rowBytes * Math.min(h, 1)) return null;

  const rgb = toRgb24(raw, w, h, spp, bits, photometric, colorMap, le);
  return { buffer: toBmp(rgb, w, h), width: w, height: h, mime: 'image/bmp' };
}

async function read(file) {
  try {
    const st = await fsp.stat(file);
    if (st.size > 512 * 1024 * 1024) return null;
    const buf = await fsp.readFile(file);
    const out = decodeBuffer(buf);
    if (!out) return null;
    return { ...out, source: 'TIFF 解码' };
  } catch {
    return null;
  }
}

module.exports = { read, decodeBuffer, lzwDecode };
