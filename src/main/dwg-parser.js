'use strict';

/**
 * DWG 解析器（基于 LibreDWG WASM）
 * - 输出与 DXF 解析器完全一致的数据结构，渲染层零改动
 * - WASM 实例懒加载并复用（10MB wasm 只初始化一次）
 * - 支持 LINE/CIRCLE/ARC/ELLIPSE/LWPOLYLINE/POLYLINE(2D,3D)/POINT/TEXT/MTEXT/
 *   INSERT(块展开)/SPLINE/SOLID/3DFACE/DIMENSION/HATCH/RAY/XLINE/MLINE/LEADER
 * - 线型与线宽按实体的 lineType / lineweight 还原（BYLAYER 回落到图层）
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { aciHex } = require('./dxf-parser');
const { dashFor, lwFactor, clipInfinite, hatchLines, patternByName } = require('./cad-geom');

let libPromise = null;
let _wasmDir = '';

// wasm 目录由 dwg.js init() 注入（开发态 vendor/，打包态 resources/libredwg/wasm）
function initWasmDir(d) {
  if (d && d !== _wasmDir) { _wasmDir = d; libPromise = null; }
}

function wasmDir() {
  let d = _wasmDir || path.join(__dirname, '../../vendor/libredwg-web/wasm');
  try {
    if (!require('fs').existsSync(path.join(d, 'libredwg-web.wasm'))) {
      const alt = d.replace('app.asar', 'app.asar.unpacked');
      if (require('fs').existsSync(path.join(alt, 'libredwg-web.wasm'))) d = alt;
    }
  } catch (e) { /* ignore */ }
  return d;
}

function getLib() {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    const dir = wasmDir();
    let mod = null;

    // 1) 优先从真实磁盘路径加载（打包环境 / 开发环境都适用）。
    // 用 pathToFileURL 而不是手拼 'file:///'：安装目录常含空格
    // （如 C:\Program Files\RatViewer），未编码的空格会让 ESM import 抛 Invalid URL。
    try {
      const esm = pathToFileURL(path.join(path.dirname(dir), 'dist/libredwg-web.js')).href;
      mod = await import(esm);
    } catch (e) { /* ignore */ }

    // 2) 开发环境：直接走包名（ESM 构建入口）
    if (!mod || !mod.LibreDwg) {
      try { mod = await import('@mlightcad/libredwg-web'); } catch (e) { /* ignore */ }
    }
    if (!mod || !mod.LibreDwg) throw new Error('无法加载 LibreDWG 解析引擎');

    const LibreDwg = mod.LibreDwg;
    const Dwg_File_Type = mod.Dwg_File_Type || { DWG: 0, DXF: 1 };
    let inst;
    try { inst = await LibreDwg.create(dir); }
    catch (e) { inst = await LibreDwg.create(); }
    return { inst, DWG: Dwg_File_Type.DWG };
  })();
  return libPromise;
}

/* ---------- 颜色 ---------- */
function trueColorHex(c) {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  const v = c >>> 0;
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ---------- 矩阵 ---------- */
const IDENTITY = [1, 0, 0, 1, 0, 0];
function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ];
}
const tx = (m, x, y) => m[0] * x + m[2] * y + m[4];
const ty = (m, x, y) => m[1] * x + m[3] * y + m[5];
function scaleOf(m) {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return det > 1e-12 ? Math.sqrt(det) : 1;
}
const rotOf = (m) => Math.atan2(m[1], m[0]);

function num(v, d) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function cleanText(s) {
  return String(s == null ? '' : s)
    // MTEXT 的 \P 是硬回车：先按它切行，再逐行清格式码，否则换行会被当格式码删掉
    .split(/\\P/)
    .map((ln) => ln
      .replace(/\\[A-Za-z0-9.|+*^~\\(){}\-]+;?/g, '')   // MTEXT 格式码
      .replace(/%%[cC]/g, 'Ø')                          // 直径
      .replace(/%%[dD]/g, '°')                          // 度
      .replace(/%%[pP]/g, '±')                          // 正负
      .replace(/%%%/g, '%')
      .replace(/[{}]/g, '')
      .replace(/\r/g, '')
      .trim())
    .filter(Boolean)
    .join('\n');
}

/* ---------- bulge 弧段细分 ---------- */
function pushBulge(pts, x1, y1, x2, y2, bulge) {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return;
  const dx = x2 - x1, dy = y2 - y1;
  const c = Math.hypot(dx, dy);
  if (c < 1e-12) return;
  const theta = 4 * Math.atan(bulge);
  const s = Math.sin(theta / 2);
  if (Math.abs(s) < 1e-12) return;
  const r = c / (2 * s);
  const h = r * Math.cos(theta / 2);
  const ux = dx / c, uy = dy / c;
  const cx = (x1 + x2) / 2 - uy * h;
  const cy = (y1 + y2) / 2 + ux * h;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const steps = Math.min(96, Math.max(3, Math.ceil(Math.abs(theta) / 0.30)));
  const rr = Math.abs(r);
  for (let k = 1; k < steps; k++) {
    const a = a0 + theta * (k / steps);
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
}

/* ---------- NURBS 采样（三次 B 样条近似） ---------- */
function tessellateSpline(cp, knots, degree, out) {
  const n = cp.length;
  if (n < 2) return;
  if (n === 2) { out.push(cp[0].x, cp[0].y, cp[1].x, cp[1].y); return; }
  const d = Math.max(1, Math.min(degree || 3, n - 1));
  // 均匀节点近似（对绝大多数工程图纸足够，且性能好）
  const segs = Math.min(160, Math.max(12, n * 8));
  const m = n + d + 1;
  const U = (knots && knots.length === m) ? knots : (() => {
    const k = new Array(m);
    for (let i = 0; i < m; i++) k[i] = i - d;
    return k;
  })();
  const basis = (i, t) => {
    if (t >= U[i] && t < U[i + 1]) return 1;
    return 0;
  };
  const deBoor = (t) => {
    let k = d;
    while (k < n && !(t >= U[k] && t < U[k + 1])) k++;
    if (k >= n) k = n - 1;
    const tmp = [];
    for (let j = 0; j <= d; j++) tmp.push({ x: cp[k - d + j].x, y: cp[k - d + j].y });
    for (let r = 1; r <= d; r++) {
      for (let j = d; j >= r; j--) {
        const i = k - d + j;
        const denom = U[i + d + 1 - r] - U[i];
        const a = denom === 0 ? 0 : (t - U[i]) / denom;
        tmp[j].x = (1 - a) * tmp[j - 1].x + a * tmp[j].x;
        tmp[j].y = (1 - a) * tmp[j - 1].y + a * tmp[j].y;
      }
    }
    return tmp[d];
  };
  const t0 = U[d], t1 = U[n];
  for (let s = 0; s <= segs; s++) {
    const t = t0 + (t1 - t0) * (s / segs);
    const p = deBoor(t);
    out.push(p.x, p.y);
  }
}

/* ============================ 主解析 ============================ */

async function parseDwg(buffer, fileName) {
  const t0 = Date.now();
  const { inst, DWG } = await getLib();

  let ptr = null;
  let db = null;
  try {
    ptr = inst.dwg_read_data(buffer, DWG);
    if (!ptr) throw new Error('DWG 读取失败：文件损坏、受密码保护或版本不受支持');
    db = inst.convert(ptr);
  } finally {
    try { if (ptr) inst.dwg_free(ptr); } catch (e) { /* ignore */ }
  }
  if (!db) throw new Error('DWG 转换失败：无法构建图形数据库');

  const out = convertDatabase(db, fileName);
  out.stats.wasmMs = Date.now() - t0 - out.stats.ms;
  return out;
}

/* ============================ 库 → 内部几何 ============================ */
/* 单独抽出，便于用合成数据做单元测试（无需真实 DWG 文件） */
function convertDatabase(db, fileName) {
  const t0 = Date.now();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const upd = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  /* ---- 图层表 ---- */
  const layerList = [];
  const layerMap = new Map();
  function getLayer(name) {
    let L = layerMap.get(name);
    if (!L) {
      L = {
        name, colorIndex: 7, color: '#ffffff', visible: true, count: 0,
        index: layerList.length, lineType: '', lineWeight: 29,
      };
      layerMap.set(name, L);
      layerList.push(L);
    }
    return L;
  }
  getLayer('0');

  const layerTable = (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];
  for (let i = 0; i < layerTable.length; i++) {
    const e = layerTable[i];
    if (!e || !e.name) continue;
    const L = getLayer(String(e.name));
    const ci = num(e.colorIndex, NaN);
    if (Number.isFinite(ci) && ci >= 0 && ci <= 255) { L.colorIndex = ci; L.color = aciHex(ci); }
    else if (e.color != null) { L.color = trueColorHex(e.color) || L.color; }
    L.visible = !(e.off === true || e.frozen === true);
    if (e.lineType) L.lineType = String(e.lineType);
    const lw = num(e.lineweight, NaN);
    if (Number.isFinite(lw)) L.lineWeight = lw;
  }

  /* ---- 绘制桶 ---- */
  const bucketList = [];
  const bucketMap = new Map();
  function getBucket(layerIdx, colorHex, dashKey, lwf) {
    const key = layerIdx + '|' + colorHex + '|' + dashKey + '|' + lwf;
    let B = bucketMap.get(key);
    if (!B) {
      B = {
        layer: layerIdx, color: colorHex,
        dash: dashKey || null, lw: lwf,
        segs: [], circles: [], arcs: [], polys: [], polyClosed: [], points: [], texts: [],
        fills: [],
        count: 0
      };
      bucketMap.set(key, B);
      bucketList.push(B);
    }
    return B;
  }

  /* ---- 块表 ---- */
  const blocks = new Map();
  const blockTable = (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
  for (let i = 0; i < blockTable.length; i++) {
    const b = blockTable[i];
    if (!b || !b.name) continue;
    const base = b.basePoint || { x: 0, y: 0 };
    blocks.set(String(b.name), { base: [num(base.x, 0), num(base.y, 0)], ents: b.entities || [] });
  }

  let totalEntities = 0;
  // 射线/构造线：需要整张图的包围盒才能裁剪，先记账
  const pendingRays = [];

  function colorOf(ent, layer) {
    const ci = num(ent.colorIndex, 256);
    if (Number.isFinite(ci) && ci > 0 && ci < 256) return aciHex(ci);
    const tc = trueColorHex(ent.color);
    if (tc) return tc;
    return layer.color;
  }

  // 线型/线宽：实体值优先（BYLAYER/BYBLOCK/空 → 回落到块参照或图层）
  function styleOf(ent, layer, ctx) {
    let lt = String(ent.lineType || '').trim();
    if (!lt || /^(BYLAYER|BYBLOCK)$/i.test(lt)) lt = (ctx && ctx.lt) || layer.lineType || '';
    const dash = dashFor(lt);
    let lw = num(ent.lineweight, -1);
    if (!(lw > 0)) lw = (ctx && ctx.lw != null) ? ctx.lw : layer.lineWeight;
    return { dash, lw, key: dash ? dash.join(',') : '', lt };
  }

  // HATCH 边界环：多段线路径直接用顶点；边路径逐条边采样（直线 / 圆弧 / 椭圆）
  function hatchLoops(ent, m, sc, ro) {
    const out = [];
    const paths = ent.boundaryPaths || [];
    const push = (ring, x, y) => {
      const X = tx(m, x, y), Y = ty(m, x, y);
      ring.push(X, Y); upd(X, Y);
    };
    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      if (!p) continue;
      const ring = [];
      if ((num(p.boundaryPathTypeFlag, 0) & 2) && Array.isArray(p.vertices)) {
        for (const v of p.vertices) {
          if (!v) continue;
          push(ring, num(v.x, 0), num(v.y, 0));
        }
      } else if (Array.isArray(p.edges)) {
        for (const e of p.edges) {
          if (!e) continue;
          const t = num(e.type, 1);
          if (t === 1) {
            const s = e.start || {};
            push(ring, num(s.x, 0), num(s.y, 0));
          } else if (t === 2 || t === 3) {
            const c = e.center || {};
            const CX = tx(m, num(c.x, 0), num(c.y, 0));
            const CY = ty(m, num(c.x, 0), num(c.y, 0));
            let a = num(e.startAngle, 0), b = num(e.endAngle, Math.PI * 2);
            const ccw = e.isCCW !== false;
            let sweep = b - a;
            if (ccw) { while (sweep <= 0) sweep += Math.PI * 2; }
            else { while (sweep >= 0) sweep -= Math.PI * 2; }
            const steps = Math.min(72, Math.max(4, Math.ceil(Math.abs(sweep) / 0.25)));
            if (t === 2) {
              const r = num(e.radius, 0) * sc;
              for (let k = 0; k <= steps; k++) {
                const ang = a + sweep * (k / steps) + ro;
                ring.push(CX + r * Math.cos(ang), CY + r * Math.sin(ang));
              }
            } else {
              // 椭圆：end 是主轴端点，lengthOfMinorAxis 是短长轴比
              const mp = e.end || {};
              const A = Math.hypot(num(mp.x, 1), num(mp.y, 0)) * sc;
              const Bb = A * num(e.lengthOfMinorAxis, 1);
              const base = Math.atan2(num(mp.y, 0), num(mp.x, 1)) + ro;
              for (let k = 0; k <= steps; k++) {
                const ang = a + sweep * (k / steps);
                const lx = A * Math.cos(ang), ly = Bb * Math.sin(ang);
                ring.push(CX + lx * Math.cos(base) - ly * Math.sin(base),
                  CY + lx * Math.sin(base) + ly * Math.cos(base));
              }
            }
          }
        }
      }
      // 去掉与首点重合的收尾点（填充环由 even-odd 自动闭合）
      const n2 = ring.length;
      if (n2 >= 8
        && Math.abs(ring[n2 - 2] - ring[0]) < 1e-9
        && Math.abs(ring[n2 - 1] - ring[1]) < 1e-9) {
        ring.length = n2 - 2;
      }
      if (ring.length >= 6) out.push(new Float32Array(ring));
    }
    return out;
  }

  // 图案定义：文件里有几条定义线就画几个方向（ANSI37 这类交叉填充才像样）
  function hatchDefs(ent) {
    const lines = ent.definitionLines || [];
    const defs = [];
    for (const l of lines) {
      if (!l || !l.offset) continue;
      const ox = num(l.offset.x, 0), oy = num(l.offset.y, 0);
      if (!(Math.abs(ox) + Math.abs(oy) > 1e-9)) continue;
      defs.push({
        angle: num(l.angle, Math.PI / 4),
        ox, oy,
        bx: l.base ? num(l.base.x, 0) : 0,
        by: l.base ? num(l.base.y, 0) : 0,
      });
      if (defs.length >= 4) break;   // 再多方向只会把画布糊满
    }
    if (!defs.length) {
      const d = patternByName(ent.patternName, num(ent.patternScale, 1));
      d.angle += num(ent.patternAngle, 0);
      defs.push(d);
    }
    return defs;
  }

  function handleEntity(ent, ctx) {
    if (!ent || !ent.type) return;
    const m = ctx.m;
    const layer = getLayer(String(ent.layer || '0') || '0');
    if (ent.isVisible === false) return;
    const st = styleOf(ent, layer, ctx);
    const B = getBucket(layer.index, colorOf(ent, layer), st.key, lwFactor(st.lw));
    const sc = scaleOf(m);
    const ro = rotOf(m);
    const type = String(ent.type).toUpperCase();

    switch (type) {
      case 'LINE': {
        const a = ent.startPoint || {}, b = ent.endPoint || {};
        const X1 = tx(m, num(a.x, 0), num(a.y, 0)), Y1 = ty(m, num(a.x, 0), num(a.y, 0));
        const X2 = tx(m, num(b.x, 0), num(b.y, 0)), Y2 = ty(m, num(b.x, 0), num(b.y, 0));
        B.segs.push(X1, Y1, X2, Y2); upd(X1, Y1); upd(X2, Y2);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'CIRCLE': {
        const c = ent.center || {};
        const r = num(ent.radius, 0) * sc;
        const X = tx(m, num(c.x, 0), num(c.y, 0)), Y = ty(m, num(c.x, 0), num(c.y, 0));
        B.circles.push(X, Y, r); upd(X - r, Y - r); upd(X + r, Y + r);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'ARC': {
        const c = ent.center || {};
        const r = num(ent.radius, 0) * sc;
        const a0 = num(ent.startAngle, 0) + ro;
        const a1 = num(ent.endAngle, 0) + ro;
        const X = tx(m, num(c.x, 0), num(c.y, 0)), Y = ty(m, num(c.x, 0), num(c.y, 0));
        B.arcs.push(X, Y, r, a0, a1); upd(X - r, Y - r); upd(X + r, Y + r);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'LWPOLYLINE': {
        const vs = ent.vertices || [];
        if (vs.length < 2) break;
        const closed = (num(ent.flag, 0) & 1) !== 0;
        const pts = [];
        for (let k = 0; k < vs.length; k++) {
          const v = vs[k] || {};
          const X = tx(m, num(v.x, 0), num(v.y, 0)), Y = ty(m, num(v.x, 0), num(v.y, 0));
          if (k > 0) pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, num(vs[k - 1].bulge, 0));
          pts.push(X, Y); upd(X, Y);
        }
        if (closed && vs.length > 2) {
          const X = pts[0], Y = pts[1];
          pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, num(vs[vs.length - 1].bulge, 0));
          pts.push(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(closed ? 1 : 0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'POLYLINE2D':
      case 'POLYLINE3D':
      case 'POLYLINE': {
        const vs = ent.vertices || [];
        if (vs.length < 2) break;
        const closed = (num(ent.flag, 0) & 1) !== 0;
        const pts = [];
        for (let k = 0; k < vs.length; k++) {
          const v = vs[k] || {};
          const p = v.point || v;
          const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
          if (k > 0) pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, num(vs[k - 1].bulge, 0));
          pts.push(X, Y); upd(X, Y);
        }
        if (closed && vs.length > 2) {
          const X = pts[0], Y = pts[1];
          pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, num(vs[vs.length - 1].bulge, 0));
          pts.push(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(closed ? 1 : 0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'ELLIPSE': {
        const c = ent.center || {};
        const mp = ent.majorAxisEndPoint || { x: 1, y: 0 };
        const CX = tx(m, num(c.x, 0), num(c.y, 0)), CY = ty(m, num(c.x, 0), num(c.y, 0));
        const a = Math.hypot(num(mp.x, 1), num(mp.y, 0)) * sc;
        const b = a * num(ent.axisRatio, 1);
        const ang = Math.atan2(num(mp.y, 0), num(mp.x, 1)) + ro;
        let p0 = num(ent.startAngle, 0), p1 = num(ent.endAngle, Math.PI * 2);
        let sweep = p1 - p0;
        while (sweep <= 0) sweep += Math.PI * 2;
        if (sweep > Math.PI * 2) sweep = Math.PI * 2;
        const steps = Math.min(256, Math.max(12, Math.ceil(sweep / 0.12)));
        const pts = [];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let k = 0; k <= steps; k++) {
          const t = p0 + sweep * (k / steps);
          const lx = a * Math.cos(t), ly = b * Math.sin(t);
          const X = CX + lx * ca - ly * sa;
          const Y = CY + lx * sa + ly * ca;
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(Math.abs(sweep - Math.PI * 2) < 1e-6 ? 1 : 0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'SPLINE': {
        let cp = ent.controlPoints || [];
        if ((!cp || cp.length < 2) && ent.fitPoints && ent.fitPoints.length >= 2) {
          const pts = [];
          for (let k = 0; k < ent.fitPoints.length; k++) {
            const p = ent.fitPoints[k];
            const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
            pts.push(X, Y); upd(X, Y);
          }
          B.polys.push(new Float32Array(pts));
          B.polyClosed.push(0);
          B.count++; totalEntities++; layer.count++;
          break;
        }
        if (!cp || cp.length < 2) break;
        const local = [];
        tessellateSpline(cp, ent.knots, num(ent.degree, 3), local);
        const pts = [];
        for (let k = 0; k < local.length; k += 2) {
          const X = tx(m, local[k], local[k + 1]), Y = ty(m, local[k], local[k + 1]);
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'SOLID': {
        // corner3 / corner4 在对角线上互换（同 DXF 语义），按 1-2-3-4 连会打结
        const cs = [ent.corner1, ent.corner2, ent.corner4, ent.corner3];
        const pts = [];
        for (let k = 0; k < 4; k++) {
          const c = cs[k];
          if (!c) continue;
          const X = tx(m, num(c.x, 0), num(c.y, 0)), Y = ty(m, num(c.x, 0), num(c.y, 0));
          pts.push(X, Y); upd(X, Y);
        }
        if (pts.length < 6) break;
        B.fills.push({ p: new Float32Array(pts), a: 0.9 });
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case '3DFACE': {
        const cs = [ent.corner1, ent.corner2, ent.corner3, ent.corner4];
        const pts = [];
        for (let k = 0; k < 4; k++) {
          const c = cs[k];
          if (!c) continue;
          const X = tx(m, num(c.x, 0), num(c.y, 0)), Y = ty(m, num(c.x, 0), num(c.y, 0));
          pts.push(X, Y); upd(X, Y);
        }
        if (pts.length < 6) break;
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(1);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'POINT': {
        const p = ent.position || {};
        const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
        B.points.push(X, Y); upd(X, Y);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const p = ent.insertionPoint || ent.startPoint || ent.textPoint || {};
        const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
        const s = cleanText(ent.text);
        if (s) {
          const h = num(ent.textHeight, 2.5) * sc;
          const rot = num(ent.rotation, 0) + ro;
          B.texts.push({ x: X, y: Y, h, rot, s });
          upd(X, Y);
        }
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'DIMENSION_ORDINATE':
      case 'DIMENSION_LINEAR':
      case 'DIMENSION_ALIGNED':
      case 'DIMENSION_ANG3PT':
      case 'DIMENSION_ANG2LN':
      case 'DIMENSION_RADIUS':
      case 'DIMENSION_DIAMETER':
      case 'DIMENSION': {
        const p = ent.textPoint || ent.insertionPoint || ent.defPoint || {};
        const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
        const s = cleanText(ent.text);
        if (s) {
          B.texts.push({ x: X, y: Y, h: num(ent.textHeight, 2.5) * sc, rot: num(ent.textRotation, 0) + ro, s });
          upd(X, Y);
        }
        B.count++; totalEntities++; layer.count++;
        break;
      }

      /* ---- 填充 ---- */
      case 'HATCH': {
        const loops = hatchLoops(ent, m, sc, ro);
        if (!loops.length) break;
        const solid = num(ent.solidFill, 0) === 1
          || num(ent.gradientFlag, 0) === 1
          || String(ent.patternName || '').toUpperCase() === 'SOLID';
        if (solid) {
          for (const lp of loops) B.fills.push({ p: lp, a: 0.9 });
        } else {
          const defs = hatchDefs(ent);
          let got = 0;
          for (const def of defs) {
            const segs = hatchLines(loops, def, { maxLines: Math.max(120, Math.floor(900 / defs.length)) });
            for (let k = 0; k < segs.length; k++) B.segs.push(segs[k]);
            got += segs.length;
          }
          if (!got) for (const lp of loops) B.fills.push({ p: lp, a: 0.14 });
        }
        B.count++; totalEntities++; layer.count++;
        break;
      }

      /* ---- 构造类 ---- */
      case 'RAY':
      case 'XLINE': {
        const p = ent.firstPoint || {};
        const d = ent.unitDirection || { x: 1, y: 0 };
        const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
        const DX = m[0] * num(d.x, 1) + m[2] * num(d.y, 0);
        const DY = m[1] * num(d.x, 1) + m[3] * num(d.y, 0);
        pendingRays.push({ B, X, Y, DX, DY, both: type === 'XLINE' });
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'MLINE': {
        // 顶点里存的是每条平行线的斜接偏移（随转角变化），按中心线绘制位置才可靠
        const vs = ent.vertices || [];
        if (vs.length < 2) break;
        const pts = [];
        for (let k = 0; k < vs.length; k++) {
          const p = (vs[k] && (vs[k].vertex || vs[k])) || {};
          const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'LEADER': {
        const vs = ent.vertices || [];
        if (vs.length < 2) break;
        const pts = [];
        for (let k = 0; k < vs.length; k++) {
          const p = vs[k] || {};
          const X = tx(m, num(p.x, 0), num(p.y, 0)), Y = ty(m, num(p.x, 0), num(p.y, 0));
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'ACAD_TABLE': {
        // 表格的单元格内容由块参照展开，转换层只给了行列尺寸 —— 先把表格框线画出来
        const sp = ent.startPoint || {};
        const dir = ent.directionVector || { x: 1, y: 0 };
        const dl = Math.hypot(num(dir.x, 1), num(dir.y, 0)) || 1;
        const ux = num(dir.x, 1) / dl, uy = num(dir.y, 0) / dl;
        const vx = -uy, vy = ux;
        const cols = (ent.columnWidthArr || []).map((v) => num(v, 0));
        const rows = (ent.rowHeightArr || []).map((v) => num(v, 0));
        const W = cols.reduce((a, b) => a + b, 0);
        const H = rows.reduce((a, b) => a + b, 0);
        if (!(W > 0 && H > 0)) break;
        const P = (u, v) => {
          const x = num(sp.x, 0) + ux * u + vx * v;
          const y = num(sp.y, 0) + uy * u + vy * v;
          return [tx(m, x, y), ty(m, x, y)];
        };
        const line = (a, b) => {
          B.segs.push(a[0], a[1], b[0], b[1]);
          upd(a[0], a[1]); upd(b[0], b[1]);
        };
        let u = 0;
        line(P(0, 0), P(0, H));
        for (let c = 0; c < cols.length; c++) { u += cols[c]; line(P(u, 0), P(u, H)); }
        let v = 0;
        line(P(0, 0), P(W, 0));
        for (let r = 0; r < rows.length; r++) { v += rows[r]; line(P(0, v), P(W, v)); }
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'INSERT': {
        const name = String(ent.name || '').trim();
        const blk = blocks.get(name);
        if (!blk) break;
        const ip = ent.insertionPoint || {};
        let sx = num(ent.xScale, 1); if (sx === 0) sx = 1;
        let sy = num(ent.yScale, sx); if (sy === 0) sy = sx;
        const rot = num(ent.rotation, 0);
        const cs = Math.cos(rot), sn = Math.sin(rot);
        let M = [1, 0, 0, 1, num(ip.x, 0), num(ip.y, 0)];
        M = mul(M, [cs, sn, -sn, cs, 0, 0]);
        M = mul(M, [sx, 0, 0, sy, 0, 0]);
        M = mul(M, [1, 0, 0, 1, -blk.base[0], -blk.base[1]]);
        const child = { m: mul(m, M), depth: (ctx.depth || 0) + 1, lt: st.lt, lw: st.lw };
        if (child.depth > 8) break;
        const col = num(ent.columnCount, 1), row = num(ent.rowCount, 1);
        const csp = num(ent.columnSpacing, 0), rsp = num(ent.rowSpacing, 0);
        for (let r = 0; r < row; r++) {
          for (let c = 0; c < col; c++) {
            const off = (r === 0 && c === 0) ? IDENTITY : [1, 0, 0, 1, c * csp, r * rsp];
            const mm = (r === 0 && c === 0) ? child.m : mul(child.m, off);
            const sub = { m: mm, depth: child.depth };
            for (let k = 0; k < blk.ents.length; k++) handleEntity(blk.ents[k], sub);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  /* ---- 遍历模型空间实体 ---- */
  const model = (db.entities || []);
  const root = { m: IDENTITY, depth: 0 };
  for (let i = 0; i < model.length; i++) {
    if (model[i] && model[i].isInPaperSpace) continue;
    handleEntity(model[i], root);
  }

  /* ---- 射线 / 构造线：包围盒定型后再裁剪 ---- */
  if (pendingRays.length) {
    let box = { minX, minY, maxX, maxY };
    if (!Number.isFinite(box.minX)) {
      // 图纸里只有无限长线（没有别的图元可参照）：用基点自己定义一个参考范围
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of pendingRays) {
        if (r.X < x0) x0 = r.X;
        if (r.X > x1) x1 = r.X;
        if (r.Y < y0) y0 = r.Y;
        if (r.Y > y1) y1 = r.Y;
      }
      const pad = Math.max(10, Math.hypot(x1 - x0, y1 - y0) * 0.5);
      box = { minX: x0 - pad, minY: y0 - pad, maxX: x1 + pad, maxY: y1 + pad };
    }
    for (const r of pendingRays) {
      const seg = clipInfinite(r.X, r.Y, r.DX, r.DY, box, r.both);
      if (seg.length < 4) continue;
      r.B.segs.push(seg[0], seg[1], seg[2], seg[3]);
      upd(seg[0], seg[1]); upd(seg[2], seg[3]);
    }
  }

  /* ---- 整理输出 ---- */
  const buckets = [];
  for (let k = 0; k < bucketList.length; k++) {
    const B = bucketList[k];
    if (B.count === 0) continue;
    buckets.push({
      layer: B.layer,
      color: B.color,
      count: B.count,
      dash: B.dash,
      lw: B.lw,
      segs: new Float32Array(B.segs),
      circles: new Float32Array(B.circles),
      arcs: new Float32Array(B.arcs),
      polys: B.polys,
      polyClosed: new Uint8Array(B.polyClosed),
      points: new Float32Array(B.points),
      texts: B.texts,
      fills: B.fills
    });
  }

  const layers = layerList.map(L => ({ name: L.name, color: L.color, visible: L.visible, count: L.count }));

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) { minX = minY = 0; maxX = maxY = 100; }

  return {
    ok: true,
    fileName: fileName || '',
    format: 'DWG',
    bounds: { minX, minY, maxX, maxY },
    layers,
    buckets,
    stats: {
      entities: totalEntities,
      layers: layers.length,
      buckets: buckets.length,
      ms: Date.now() - t0
    }
  };
}

module.exports = { parseDwg, convertDatabase, initWasmDir };
