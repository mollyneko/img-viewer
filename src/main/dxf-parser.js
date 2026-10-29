'use strict';

/**
 * 高性能 DXF 解析器
 * - 纯 JS、零依赖
 * - 单次线性扫描，分组码直读，无正则
 * - 输出几何体为类型化数组（Float32Array），可零拷贝转移给渲染进程
 * - 支持：LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE+VERTEX / ELLIPSE / POINT /
 *   TEXT / MTEXT / INSERT(块展开) / HATCH / SOLID / 3DFACE / RAY / XLINE /
 *   MLINE / LEADER / SPLINE
 * - 按 6(线型) / 370(线宽) 组码还原虚线样式与相对线宽
 */

const { dashFor, lwFactor, clipInfinite, hatchLines, patternByName } = require('./cad-geom');

/* ============================ 颜色（AutoCAD ACI） ============================ */

function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const ACI_TABLE = (function () {
  const t = new Uint8Array(256 * 3);
  const set = (i, r, g, b) => { t[i * 3] = r; t[i * 3 + 1] = g; t[i * 3 + 2] = b; };
  const base = [
    [0, 0, 0],       // 0  BYBLOCK
    [255, 0, 0],     // 1
    [255, 255, 0],   // 2
    [0, 255, 0],     // 3
    [0, 255, 255],   // 4
    [0, 0, 255],     // 5
    [255, 0, 255],   // 6
    [255, 255, 255], // 7
    [128, 128, 128], // 8
    [192, 192, 192]  // 9
  ];
  for (let i = 0; i < base.length; i++) set(i, base[i][0], base[i][1], base[i][2]);
  // 10..249：按 6 个色相带 × 40 生成，每带 10 组明度/饱和度变化
  for (let i = 10; i <= 249; i++) {
    const n = i - 10;
    const band = Math.floor(n / 40);
    const sub = Math.floor((n % 40) / 4);
    const hue = band * 60 + (sub % 5) * 6;
    let s = 1, v = 1;
    switch (sub) {
      case 1: s = 0.6; v = 1.0; break;
      case 2: s = 1.0; v = 0.78; break;
      case 3: s = 1.0; v = 0.55; break;
      case 4: s = 0.45; v = 0.85; break;
      case 5: s = 1.0; v = 1.0; break;
      case 6: s = 0.75; v = 0.95; break;
      case 7: s = 1.0; v = 0.88; break;
      case 8: s = 1.0; v = 0.66; break;
      case 9: s = 0.5; v = 0.62; break;
      default: s = 1.0; v = 1.0;
    }
    const c = hsv2rgb(hue, s, v);
    set(i, c[0], c[1], c[2]);
  }
  // 250..255：灰阶
  const grays = [51, 85, 125, 170, 212, 255];
  for (let i = 0; i < grays.length; i++) set(250 + i, grays[i], grays[i], grays[i]);
  return t;
})();

function aciRgb(idx) {
  if (!Number.isFinite(idx) || idx < 0 || idx > 255) idx = 7;
  return [ACI_TABLE[idx * 3], ACI_TABLE[idx * 3 + 1], ACI_TABLE[idx * 3 + 2]];
}

function aciHex(idx) {
  const c = aciRgb(idx);
  return '#' + ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1);
}

/* ============================ 编码识别 ============================ */

function decodeBuffer(buf) {
  let enc = 'utf-8';
  try {
    // BOM 优先：UTF-16（LE/BE）或 UTF-8。AutoCAD 2007+ 可把 DXF 存成 UTF-16，
    // 这类文件若按 UTF-8 解出是乱码，后续按行扫描的比较会全部失败 → 解析作废。
    // 这里先按 BOM 解码，命中就直接返回（末尾的 BOM 字符由 parseDxf 自行剥离）。
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(buf);
    }
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(buf);
    }
    const head = buf.slice(0, 8192).toString('latin1');
    const idx = head.indexOf('$DWGCODEPAGE');
    if (idx >= 0) {
      const seg = head.slice(idx, idx + 200).split(/\r?\n/).map(s => s.trim());
      const p = seg.indexOf('3');
      const cp = p >= 0 ? (seg[p + 1] || '').toUpperCase() : '';
      if (cp.indexOf('GB') >= 0 || cp.indexOf('936') >= 0) enc = 'gb18030';
      else if (cp.indexOf('BIG5') >= 0 || cp.indexOf('950') >= 0) enc = 'big5';
      else if (cp.indexOf('1252') >= 0 || cp === 'ANSI_1252') enc = 'windows-1252';
      else if (cp.indexOf('1251') >= 0) enc = 'windows-1251';
      else if (cp.indexOf('932') >= 0) enc = 'shift_jis';
      else if (cp.indexOf('949') >= 0) enc = 'euc-kr';
    }
    // UTF-8 BOM
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) enc = 'utf-8';
    return new TextDecoder(enc, { fatal: false }).decode(buf);
  } catch (e) {
    return buf.toString('utf8');
  }
}

/* ============================ 矩阵工具 ============================ */

// [a,b,c,d,e,f]: x' = a*x + c*y + e ; y' = b*x + d*y + f
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

/* ============================ 主解析 ============================ */

function parseDxf(text, fileName) {
  const t0 = Date.now();

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n|\r|\n/);
  const n = lines.length;

  // DXF 的行是「组码 / 值」成对出现，组码是整数。AutoCAD、ODA、BricsCAD 等
  // 主流写入器会把组码右对齐到 3 列（"  0"、" 70"），而下面的扫描全程用
  // '0' 精确比较组码 —— 带前导空格就一个都匹配不上，整份图纸渲染成空白。
  // 实测 113 个真实 DXF 样本全部空白，去掉组码行首尾空白后 58 个立刻恢复
  // （其余是 HATCH/RAY/XLINE 等未实现的图元，与本问题无关）。
  // 只处理以空白开头的行，避免误伤文本值里本身就有前导空格的字符串。
  for (let k = 0; k + 1 < n; k += 2) {
    const s = lines[k];
    if (s.length > 1) {
      const c0 = s.charCodeAt(0);
      if (c0 === 32 || c0 === 9) lines[k] = s.trim();
    }
  }

  let i = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const upd = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  /* ---- 图层 ---- */
  const layerList = [];
  const layerMap = new Map();
  function getLayer(name) {
    let L = layerMap.get(name);
    if (!L) {
      L = {
        name, colorIndex: 7, visible: true, count: 0, index: layerList.length,
        lineType: '', lineWeight: 29,
      };
      layerMap.set(name, L);
      layerList.push(L);
    }
    return L;
  }
  getLayer('0');

  /* ---- 绘制桶（按 图层+颜色+线型+线宽 分组，渲染时可整桶批量描边） ---- */
  const bucketList = [];
  const bucketMap = new Map();
  function getBucket(layerIdx, colorIdx, dashKey, lwf) {
    const key = layerIdx + '|' + colorIdx + '|' + dashKey + '|' + lwf;
    let B = bucketMap.get(key);
    if (!B) {
      B = {
        layer: layerIdx,
        color: aciHex(colorIdx),
        dash: dashKey || null,   // SVG stroke-dasharray（相对线宽单位，见 dwg.js）
        lw: lwf,                 // 相对线宽系数
        segs: [],      // Float32 对：[x1,y1,x2,y2,...]  （LINE）
        circles: [],   // [cx,cy,r]
        arcs: [],      // [cx,cy,r,a0,a1]
        polys: [],     // [Float32Array(x,y,...)]  连续折线/曲线
        polyClosed: [],// Uint8 配对
        points: [],    // [x,y]
        texts: [],     // {x,y,h,rot,s}
        fills: [],     // {p:Float32Array 闭合环, a:不透明度}
        count: 0
      };
      bucketMap.set(key, B);
      bucketList.push(B);
    }
    return B;
  }

  // 线型 / 线宽解析：实体值优先，BYLAYER/BYBLOCK 回落到块参照或图层
  function styleOf(g, layer, ctx) {
    let lt = String(g['6'] || '').trim();
    if (!lt || /^BYLAYER$/i.test(lt) || /^BYBLOCK$/i.test(lt)) {
      lt = (ctx && ctx.lt) || layer.lineType || '';
    }
    const dash = dashFor(lt);
    let lw = parseInt(g['370'], 10);
    if (!Number.isFinite(lw) || lw < 0) {
      lw = (ctx && ctx.lw != null) ? ctx.lw : layer.lineWeight;
    }
    return { dash, lw, key: dash ? dash.join(',') : '', lt };
  }
  /* ---- 读取一组属性，直到下一个组码 0 ---- */
  // 92/93 也要累积：HATCH 的每条边界路径各有一组（路径类型标志 + 顶点/边数），
  // 只有拿到全部才能把「外轮廓 + 岛」拆成多个独立环 —— 否则岛屿会被连成一圈蝴蝶结。
  // 10~13 / 20~23 都是点坐标：SOLID / TRACE 用到第三、四个角（12,22 / 13,23），
  // 漏登记就会被当成标量字符串，而 g[code][0] 取到的是字符串首字符（"27.9..." → '2'）。
  const REPEAT = { '10': 1, '20': 1, '30': 1, '11': 1, '21': 1, '31': 1, '12': 1, '22': 1, '13': 1, '23': 1, '42': 1, '92': 1, '93': 1 };
  function readGroups(type) {
    const g = Object.create(null);
    // HATCH 的边界参数是「按边重复」的，必须按出现顺序还原；其余实体不需要，
    // 只给 HATCH 留一份扁平序列（[code, value, code, value, ...]），体量可忽略。
    const seq = type === 'HATCH' ? [] : null;
    while (i + 1 < n) {
      const c = lines[i];
      if (c === '0') break;
      const v = lines[i + 1];
      i += 2;
      if (seq) seq.push(c, v);
      if (REPEAT[c]) {
        const f = parseFloat(v);
        if (g[c]) g[c].push(f); else g[c] = [f];
      } else {
        g[c] = v;
      }
    }
    if (seq) g.__seq = seq;
    return g;
  }

  /* ----  bulge 弧段 tessellation ---- */
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
    // 垂直方向（+90°）
    const cx = (x1 + x2) / 2 + (-uy) * h;
    const cy = (y1 + y2) / 2 + (ux) * h;
    const a0 = Math.atan2(y1 - cy, x1 - cx);
    const steps = Math.min(96, Math.max(3, Math.ceil(Math.abs(theta) / 0.30)));
    const rr = Math.abs(r);
    for (let s2 = 1; s2 < steps; s2++) {
      const a = a0 + theta * (s2 / steps);
      pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
  }

  /* ---- 变换点 ---- */
  function tx(m, x, y) { return m[0] * x + m[2] * y + m[4]; }
  function ty(m, x, y) { return m[1] * x + m[3] * y + m[5]; }
  function scaleOf(m) {
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    return det > 1e-12 ? Math.sqrt(det) : 1;
  }
  function rotOf(m) { return Math.atan2(m[1], m[0]); }

  /* ---- 实体处理 ---- */
  const blocks = new Map();
  let totalEntities = 0;
  // 射线/构造线要等所有几何点收完、算出包围盒后才能裁剪，先暂存
  const pendingRays = [];

  // HATCH 边界：按 92(路径类型) / 93(点数) 逐条路径拆环。
  // 兼容两种写法：多段线路径（顶点直存）与直线边路径（每段的起点即顶点）。
  // HATCH 边界必须按「组码出现顺序」解析：10/20 在这一个实体里同时充当
  //   ① AcDbHatch 的标高点（第一组，永远在最前）
  //   ② 边界顶点 / 边路径里各边的关键点（直线的起终点、圆弧的圆心）
  //   ③ 98 之后的种子点
  // 而 40/50/51/72/73 是按边重复出现的参数，用「按码累加的数组」无法还原
  // 它们与边的对应关系（多段线路径和边路径还会互相打乱下标）。所以只对 HATCH
  // 额外保留一份有序组码，逐条路径、逐条边地重建环。
  function loopFromPolyline(o) {
    const pts = [];
    const n = o.length;
    for (let k = 0; k < n; k++) {
      pts.push(o[k].x, o[k].y);
      if (n > 1 && Math.abs(o[k].b) > 1e-9) {
        const j = (k + 1) % n;
        pushBulge(pts, o[k].x, o[k].y, o[j].x, o[j].y, o[k].b);
      }
    }
    return pts;
  }

  function arcInto(pts, cx, cy, r, a0, a1, ccw) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) return false;
    let d0 = Number.isFinite(a0) ? a0 : 0;
    let d1 = Number.isFinite(a1) ? a1 : d0 + 360;
    if (Math.abs(d1 - d0) < 1e-9) d1 = d0 + 360;          // 起止相同 = 整圆
    if (ccw === false || ccw === 0) { while (d1 >= d0) d1 -= 360; }
    else { while (d1 <= d0) d1 += 360; }
    const sweep = (d1 - d0) * Math.PI / 180;
    const step = Math.min(Math.PI / 9, Math.abs(sweep) / 4);   // 最多 20° 一段
    const nSeg = Math.max(4, Math.ceil(Math.abs(sweep) / step));
    for (let k = 0; k <= nSeg; k++) {
      const a = d0 * Math.PI / 180 + sweep * (k / nSeg);
      pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return true;
  }

  function loopFromEdges(edges) {
    const pts = [];
    for (const e of edges) {
      const t = e.type | 0;
      if (t === 2) {
        // 圆弧边：中心 10/20、半径 40、起止角 50/51、方向 73
        arcInto(pts, e.x, e.y, e.r, e.a0, e.a1, e.ccw);
      } else if (t === 3 && Number.isFinite(e.ex) && Number.isFinite(e.ey)) {
        // 椭圆弧边：中心 10/20、长轴端点 11/21、短长比 40、起止角 50/51
        const ax = e.ex - e.x, ay = e.ey - e.y;
        const R = Math.hypot(ax, ay);
        const r2 = R * (Number.isFinite(e.r) ? e.r : 1);
        const rot = Math.atan2(ay, ax);
        let d0 = Number.isFinite(e.a0) ? e.a0 : 0;
        let d1 = Number.isFinite(e.a1) ? e.a1 : d0 + 360;
        if (Math.abs(d1 - d0) < 1e-9) d1 = d0 + 360;
        if (e.ccw === 0) { while (d1 >= d0) d1 -= 360; } else { while (d1 <= d0) d1 += 360; }
        const sweep = (d1 - d0) * Math.PI / 180;
        const nSeg = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
        for (let k = 0; k <= nSeg; k++) {
          const a = d0 * Math.PI / 180 + sweep * (k / nSeg);
          const px = R * Math.cos(a), py = r2 * Math.sin(a);
          pts.push(e.x + px * Math.cos(rot) - py * Math.sin(rot),
            e.y + px * Math.sin(rot) + py * Math.cos(rot));
        }
      } else {
        // 直线边（以及无法细分的样条边）：起点 → 终点。相邻边的终点会与下一
        // 条边的起点重合，所以这里只补终点，起点由前一条边带来。
        if (Number.isFinite(e.x) && Number.isFinite(e.y)) pts.push(e.x, e.y);
        if (Number.isFinite(e.ex) && Number.isFinite(e.ey)) pts.push(e.ex, e.ey);
      }
    }
    return pts;
  }

  function hatchLoopsFromSeq(seq) {
    const paths = [];
    let cur = null, edge = null;
    for (let i = 0; i < seq.length; i += 2) {
      const code = seq[i], v = seq[i + 1];
      const nv = parseFloat(v);
      if (code === '92') {
        cur = { flag: parseInt(v, 10) | 0, objs: [], edges: [] };
        paths.push(cur); edge = null;
        continue;
      }
      if (!cur) continue;                       // 还在标高/公共头里
      if (code === '75' || code === '76' || code === '98') { cur = null; edge = null; continue; }
      if (code === '72') {
        if (cur.flag & 2) continue;              // 多段线路径：72 只是 hasBulge 标记
        edge = { type: parseInt(v, 10) | 0 };
        cur.edges.push(edge);
        continue;
      }
      if (edge) {
        switch (code) {
          case '10': edge.x = nv; break;
          case '20': edge.y = nv; break;
          case '11': edge.ex = nv; break;
          case '21': edge.ey = nv; break;
          case '40': edge.r = nv; break;
          case '50': edge.a0 = nv; break;
          case '51': edge.a1 = nv; break;
          case '73': edge.ccw = nv; break;
          default: break;
        }
        continue;
      }
      switch (code) {
        case '10': cur.objs.push({ x: nv, y: 0, b: 0 }); break;
        case '20': if (cur.objs.length) cur.objs[cur.objs.length - 1].y = nv; break;
        case '42': if (cur.objs.length) cur.objs[cur.objs.length - 1].b = nv; break;
        default: break;
      }
    }
    const loops = [];
    for (const p of paths) {
      let pts = null;
      if ((p.flag & 2) && p.objs.length) pts = loopFromPolyline(p.objs);
      else if (p.edges.length) pts = loopFromEdges(p.edges);
      else if (p.objs.length >= 3) pts = loopFromPolyline(p.objs);
      if (pts && pts.length >= 6) loops.push(pts);
    }
    return loops;
  }

  // 没有有序组码时的兜底：按 92/93 拆环，顶点只取 10/20 的有效区间。
  function hatchLoopsFromDict(g) {
    const xs = g['10'] || [];
    const ys = g['20'] || [];
    const n0 = Math.min(xs.length, ys.length);
    if (n0 < 3) return [];

    const flags = g['92'] || null;
    const counts = g['93'] || null;
    let total = 0;
    if (Array.isArray(counts)) {
      for (let p = 0; p < counts.length; p++) total += Math.max(0, Math.round(Number(counts[p]) || 0));
    }
    const seeds = Math.max(0, Math.round(Number(g['98']) || 0));
    const cut = n0 - seeds;
    let start = (total && cut === total) ? 0 : 1;
    let n = cut - start;
    if (n < 3) { start = 0; n = cut; }
    if (n < 3) return [];

    const chunks = [];
    if (Array.isArray(flags) && Array.isArray(counts) && flags.length === counts.length) {
      let at = 0;
      for (let p = 0; p < counts.length; p++) {
        const c = Math.max(0, Math.round(Number(counts[p]) || 0));
        if (!c) break;
        chunks.push({ start: start + at, count: c });
        at += c;
      }
      if (at !== n) chunks.length = 0;
    }
    if (!chunks.length) chunks.push({ start, count: n });

    const out = [];
    for (const c of chunks) {
      if (c.count < 3 || c.start + c.count > n0) continue;
      const pts = [];
      for (let k = 0; k < c.count; k++) pts.push(xs[c.start + k], ys[c.start + k]);
      out.push(pts);
    }
    return out;
  }

  function hatchLoops(g, m) {
    const seq = g.__seq;
    let raw = seq ? hatchLoopsFromSeq(seq) : null;
    if (!raw || !raw.length) raw = hatchLoopsFromDict(g);
    const loops = [];
    for (const src of raw) {
      const pts = new Float32Array(src.length);
      for (let k = 0; k < src.length; k += 2) {
        const X = tx(m, src[k], src[k + 1]), Y = ty(m, src[k], src[k + 1]);
        pts[k] = X; pts[k + 1] = Y;
        upd(X, Y);
      }
      loops.push(pts);
    }
    return loops;
  }

  // 图案定义线：78 之后按 (53 角度, 43/44 基点, 45/46 偏移, 79+49* 虚线) 重复。
  // 组码字典会把每一条都覆盖掉，只有按顺序读才能拿到多方向图案（ANSI32/33、NET…）。
  function hatchDefsFromSeq(seq) {
    let at = -1, nDef = 0;
    for (let i = 0; i < seq.length; i += 2) {
      const c = seq[i];
      if (c === '98') break;                  // 种子点在图案定义之后，别越过去
      if (c === '78') { nDef = parseInt(seq[i + 1], 10) | 0; at = i + 2; break; }
    }
    if (nDef <= 0 || at < 0) return [];
    const defs = [];
    let cur = null, dashes = 0;
    for (let i = at; i + 1 < seq.length && defs.length < 8; i += 2) {
      const c = seq[i], v = seq[i + 1];
      if (c === '98' || c === '75' || c === '47') break;
      if (c === '53') {
        cur = { angle: (parseFloat(v) || 0) * Math.PI / 180, bx: 0, by: 0, ox: 0, oy: 0, dash: null };
        defs.push(cur); dashes = 0;
        continue;
      }
      if (!cur) continue;
      if (c === '43') cur.bx = parseFloat(v) || 0;
      else if (c === '44') cur.by = parseFloat(v) || 0;
      else if (c === '45') cur.ox = parseFloat(v) || 0;
      else if (c === '46') cur.oy = parseFloat(v) || 0;
      else if (c === '79') { dashes = parseInt(v, 10) | 0; if (dashes > 0) cur.dash = []; }
      else if (c === '49' && cur.dash && cur.dash.length < dashes) cur.dash.push(parseFloat(v) || 0);
    }
    return defs.filter((d) => Math.hypot(d.ox, d.oy) > 1e-9);
  }

  // 样条：对控制点做 Catmull-Rom 采样。DXF 里的 SPLINE 不带可用的 NURBS 权重时，
  // 这比「直接连折线」自然得多，也不会像 NURBS 那样在病态节点下炸开。
  function catmullRom(pts, out, closed) {
    const n = pts.length / 2;
    if (n < 3) { for (let i = 0; i < pts.length; i++) out.push(pts[i]); return; }
    const at = (i) => {
      if (closed) return ((i % n) + n) % n;
      return Math.min(n - 1, Math.max(0, i));
    };
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1) * 2, p1 = at(i) * 2, p2 = at(i + 1) * 2, p3 = at(i + 2) * 2;
      for (let s = 0; s < 8; s++) {
        const t = s / 8, t2 = t * t, t3 = t2 * t;
        for (let c = 0; c < 2; c++) {
          out.push(0.5 * ((2 * pts[p1 + c]) + (-pts[p0 + c] + pts[p2 + c]) * t
            + (2 * pts[p0 + c] - 5 * pts[p1 + c] + 4 * pts[p2 + c] - pts[p3 + c]) * t2
            + (-pts[p0 + c] + 3 * pts[p1 + c] - 3 * pts[p2 + c] + pts[p3 + c]) * t3));
        }
      }
    }
    const last = (closed ? 0 : (n - 1)) * 2;
    out.push(pts[last], pts[last + 1]);
  }

  function handleEntity(type, g, ctx) {
    if (!g) return;
    const m = ctx.m;
    const layerName = ((g['8'] || '0').trim()) || '0';
    const layer = getLayer(layerName);

    let ci = parseInt(g['62'], 10);
    if (!Number.isFinite(ci) || ci === 256 || ci === 0) ci = layer.colorIndex;
    if (ci < 0) ci = 0;
    if (ci > 255) ci = 255;

    const st = styleOf(g, layer, ctx);
    const B = getBucket(layer.index, ci, st.key, lwFactor(st.lw));
    const sc = scaleOf(m);
    const ro = rotOf(m);

    switch (type) {
      case 'LINE': {
        const x1 = g['10'] ? g['10'][0] : 0;
        const y1 = g['20'] ? g['20'][0] : 0;
        const x2 = g['11'] ? g['11'][0] : 0;
        const y2 = g['21'] ? g['21'][0] : 0;
        const X1 = tx(m, x1, y1), Y1 = ty(m, x1, y1);
        const X2 = tx(m, x2, y2), Y2 = ty(m, x2, y2);
        B.segs.push(X1, Y1, X2, Y2);
        upd(X1, Y1); upd(X2, Y2);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'CIRCLE': {
        const cx = g['10'] ? g['10'][0] : 0;
        const cy = g['20'] ? g['20'][0] : 0;
        const r = (parseFloat(g['40']) || 0) * sc;
        const X = tx(m, cx, cy), Y = ty(m, cx, cy);
        B.circles.push(X, Y, r);
        upd(X - r, Y - r); upd(X + r, Y + r);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'ARC': {
        const cx = g['10'] ? g['10'][0] : 0;
        const cy = g['20'] ? g['20'][0] : 0;
        const r = (parseFloat(g['40']) || 0) * sc;
        const a0 = (parseFloat(g['50']) || 0) * Math.PI / 180 + ro;
        const a1 = (parseFloat(g['51']) || 0) * Math.PI / 180 + ro;
        const X = tx(m, cx, cy), Y = ty(m, cx, cy);
        B.arcs.push(X, Y, r, a0, a1);
        upd(X - r, Y - r); upd(X + r, Y + r);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'LWPOLYLINE': {
        const xs = g['10'], ys = g['20'];
        if (!xs || !ys) break;
        const cnt = Math.min(xs.length, ys.length);
        if (cnt < 2) break;
        const flag = parseInt(g['70'], 10) || 0;
        const closed = (flag & 1) !== 0;
        const bulges = g['42'] || null;
        const pts = [];
        for (let k = 0; k < cnt; k++) {
          const X = tx(m, xs[k], ys[k]), Y = ty(m, xs[k], ys[k]);
          if (k > 0 && bulges) pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, bulges[k - 1]);
          pts.push(X, Y);
          upd(X, Y);
        }
        if (closed && cnt > 2) {
          const X = pts[0], Y = pts[1];
          if (bulges) pushBulge(pts, pts[pts.length - 2], pts[pts.length - 1], X, Y, bulges[cnt - 1]);
          pts.push(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(closed ? 1 : 0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'ELLIPSE': {
        const cx = g['10'] ? g['10'][0] : 0;
        const cy = g['20'] ? g['20'][0] : 0;
        const mx = g['11'] ? g['11'][0] : 1;
        const my = g['21'] ? g['21'][0] : 0;
        const ratio = parseFloat(g['40']) || 1;
        const CX = tx(m, cx, cy), CY = ty(m, cx, cy);
        // 主轴向量参与变换（近似：按整体缩放）
        const a = Math.hypot(mx, my) * sc;
        const b = a * ratio;
        const ang = Math.atan2(my, mx) + ro;
        let p0 = parseFloat(g['41']), p1 = parseFloat(g['42']);
        if (!Number.isFinite(p0) || !Number.isFinite(p1)) { p0 = 0; p1 = Math.PI * 2; }
        let sweep = p1 - p0;
        while (sweep <= 0) sweep += Math.PI * 2;
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
      case 'POINT': {
        const x = g['10'] ? g['10'][0] : 0;
        const y = g['20'] ? g['20'][0] : 0;
        const X = tx(m, x, y), Y = ty(m, x, y);
        B.points.push(X, Y); upd(X, Y);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const x = g['10'] ? g['10'][0] : 0;
        const y = g['20'] ? g['20'][0] : 0;
        const X = tx(m, x, y), Y = ty(m, x, y);
        let s = g['1'] || g['3'] || '';
        if (Array.isArray(s)) s = s.join('');
        // \P 是 MTEXT 的硬回车：先转成 \n 再清格式码，否则换行会被当格式码吃掉
        s = String(s).split(/\\P/).map((ln) => ln
          .replace(/\\[A-Za-z0-9.|]+;?/g, '')
          .replace(/[{}]/g, '')
          .trim()).filter(Boolean).join('\n');
        s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%');
        if (s) {
          const h = (parseFloat(g['40']) || 2.5) * sc;
          const rot = (parseFloat(g['50']) || 0) * Math.PI / 180 + ro;
          B.texts.push({ x: X, y: Y, h, rot, s });
          upd(X, Y);
        }
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'INSERT': {
        const name = (g['2'] || '').trim();
        const blk = blocks.get(name);
        if (!blk) break;
        const ix = g['10'] ? g['10'][0] : 0;
        const iy = g['20'] ? g['20'][0] : 0;
        let sx = parseFloat(g['41']); if (!Number.isFinite(sx) || sx === 0) sx = 1;
        let sy = parseFloat(g['42']); if (!Number.isFinite(sy) || sy === 0) sy = sx;
        const rot = (parseFloat(g['50']) || 0) * Math.PI / 180;
        const cs = Math.cos(rot), sn = Math.sin(rot);

        let M = [1, 0, 0, 1, ix, iy];                 // T(ins)
        M = mul(M, [cs, sn, -sn, cs, 0, 0]);          // R
        M = mul(M, [sx, 0, 0, sy, 0, 0]);             // S
        M = mul(M, [1, 0, 0, 1, -blk.base[0], -blk.base[1]]); // T(-base)
        const child = { m: mul(m, M), depth: (ctx.depth || 0) + 1, lt: st.lt, lw: st.lw };
        if (child.depth > 8) break;
        for (let k = 0; k < blk.ents.length; k++) {
          const e = blk.ents[k];
          handleEntity(e.type, e.g === undefined ? null : e.g, child);
        }
        break;
      }

      /* ---- 填充类 ---- */
      case 'SOLID':
      case 'TRACE': {
        // DXF 的角点顺序是 1-2-4-3（第三、四个点在对角线上互换），
        // 按 1-2-3-4 连会得到蝴蝶结。只有三个角时按三角形处理。
        const pairs = [['10', '20'], ['11', '21'], ['13', '23'], ['12', '22']];
        const pts = [];
        for (const [kx, ky] of pairs) {
          if (!g[kx] || !g[ky]) continue;
          const X = tx(m, g[kx][0], g[ky][0]);
          const Y = ty(m, g[kx][0], g[ky][0]);
          pts.push(X, Y); upd(X, Y);
        }
        if (pts.length >= 6) {
          B.fills.push({ p: new Float32Array(pts), a: 0.9 });
          B.count++; totalEntities++; layer.count++;
        }
        break;
      }
      case 'HATCH': {
        const loops = hatchLoops(g, m);
        if (!loops.length) break;
        const solid = (parseInt(g['70'], 10) || 0) & 1;
        if (solid) {
          for (const lp of loops) B.fills.push({ p: lp, a: 0.9 });
        } else {
          const name = String(g['2'] || '').trim();
          const scale = parseFloat(g['41']);
          let defs = g.__seq ? hatchDefsFromSeq(g.__seq) : [];
          if (!defs.length) {
            // 没有有序组码时：单条定义线还能从字典里拼出来，多条只能按图案名兜底
            const nDef = parseInt(g['78'], 10);
            const a = parseFloat(g['53']);
            const ox = parseFloat(g['45']), oy = parseFloat(g['46']);
            if (nDef === 1 && Number.isFinite(a) && Number.isFinite(ox) && Number.isFinite(oy)) {
              defs = [{
                angle: a * Math.PI / 180, ox, oy,
                bx: parseFloat(g['43']) || 0, by: parseFloat(g['44']) || 0,
              }];
            } else {
              defs = [patternByName(name, Number.isFinite(scale) ? scale : 1)];
            }
          }
          const segs = [];
          // 每条定义线单独扫一遍；多方向图案（ANSI32/33、NET…）靠这一步成形
          const budget = { maxLines: defs.length > 1 ? Math.max(140, Math.floor(1200 / defs.length)) : 900 };
          for (const d of defs) {
            const s = hatchLines(loops, d, budget);
            for (let k = 0; k < s.length; k++) segs.push(s[k]);
          }
          if (segs.length) {
            for (let k = 0; k < segs.length; k++) B.segs.push(segs[k]);
            // 填充线本身不算「实体」，包围盒已由边界环贡献
          } else {
            // 图案太密/定义异常 → 退化成淡色填充，至少能看出区域
            for (const lp of loops) B.fills.push({ p: lp, a: 0.14 });
          }
        }
        B.count++; totalEntities++; layer.count++;
        break;
      }

      /* ---- 构造类 ---- */
      case 'RAY':
      case 'XLINE': {
        const bx = g['10'] ? g['10'][0] : 0;
        const by = g['20'] ? g['20'][0] : 0;
        const dx = g['11'] ? g['11'][0] : 1;
        const dy = g['21'] ? g['21'][0] : 0;
        const X = tx(m, bx, by), Y = ty(m, bx, by);
        // 方向只受旋转/缩放影响，不吃平移
        const DX = m[0] * dx + m[2] * dy;
        const DY = m[1] * dx + m[3] * dy;
        pendingRays.push({ B, X, Y, DX, DY, both: type === 'XLINE', layer });
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'MLINE': {
        // 每条平行线的实际偏移量散落在顶点数据里，且随斜接角变化；
        // 这里按「中心线」画一条折线 —— 位置绝对正确，只是少了几条平行线。
        const xs = g['11'] || [], ys = g['21'] || [];
        const cnt = Math.min(xs.length, ys.length);
        if (cnt < 2) break;
        const pts = [];
        for (let k = 0; k < cnt; k++) {
          const X = tx(m, xs[k], ys[k]), Y = ty(m, xs[k], ys[k]);
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'LEADER': {
        const xs = g['10'] || [], ys = g['20'] || [];
        const cnt = Math.min(xs.length, ys.length);
        if (cnt < 2) break;
        const pts = [];
        for (let k = 0; k < cnt; k++) {
          const X = tx(m, xs[k], ys[k]), Y = ty(m, xs[k], ys[k]);
          pts.push(X, Y); upd(X, Y);
        }
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      case 'SPLINE': {
        const fx = g['11'] || [], fy = g['21'] || [];
        const cx2 = g['10'] || [], cy2 = g['20'] || [];
        const useFit = fx.length >= 2 && fy.length >= 2;
        const xs = useFit ? fx : cx2;
        const ys = useFit ? fy : cy2;
        const cnt = Math.min(xs.length, ys.length);
        if (cnt < 2) break;
        const raw = [];
        for (let k = 0; k < cnt; k++) raw.push(tx(m, xs[k], ys[k]), ty(m, xs[k], ys[k]));
        const pts = [];
        if (cnt === 2) { pts.push(raw[0], raw[1], raw[2], raw[3]); }
        else catmullRom(raw, pts, false);
        for (let k = 0; k < pts.length; k += 2) upd(pts[k], pts[k + 1]);
        B.polys.push(new Float32Array(pts));
        B.polyClosed.push(0);
        B.count++; totalEntities++; layer.count++;
        break;
      }
      default:
        break;
    }
  }

  /* ---- POLYLINE 状态机 ---- */
  let poly = null;
  function flushPoly() {
    if (!poly) return;
    const pts = poly.pts;
    if (pts.length >= 4) {
      const B = poly.bucket;
      B.polys.push(new Float32Array(pts));
      B.polyClosed.push(poly.closed ? 1 : 0);
      B.count++; totalEntities++; poly.layer.count++;
    }
    poly = null;
  }

  /* ---- 读取一个实体 ---- */
  function readEntity() {
    while (i + 1 < n) {
      const c = lines[i];
      if (c !== '0') { i += 2; continue; }
      const type = lines[i + 1].trim();
      i += 2;
      if (type === 'ENDSEC' || type === 'ENDBLK' || type === 'SEQEND' || type === 'EOF') {
        return { type, g: null };
      }
      const g = readGroups(type);
      return { type, g };
    }
    return null;
  }

  /* ---- 段扫描 ---- */
  function parseTables() {
    while (true) {
      const e = readEntity();
      if (!e || e.type === 'ENDSEC' || e.type === 'EOF') return;
      if (e.type === 'LAYER' && e.g) {
        const name = (e.g['2'] || '').trim();
        if (name) {
          const L = getLayer(name);
          const c66 = parseInt(e.g['62'], 10);
          if (Number.isFinite(c66)) {
            if (c66 < 0) { L.visible = false; L.colorIndex = Math.min(255, -c66); }
            else { L.colorIndex = Math.min(255, c66); L.visible = true; }
          }
          const lt = (e.g['6'] || '').trim();
          if (lt) L.lineType = lt;
          const lw = parseInt(e.g['370'], 10);
          if (Number.isFinite(lw)) L.lineWeight = lw;
        }
      }
    }
  }

  function parseBlocks() {
    while (true) {
      const e = readEntity();
      if (!e || e.type === 'ENDSEC' || e.type === 'EOF') return;
      if (e.type === 'BLOCK' && e.g) {
        const name = (e.g['2'] || '').trim();
        const bx = e.g['10'] ? e.g['10'][0] : 0;
        const by = e.g['20'] ? e.g['20'][0] : 0;
        const ents = [];
        while (true) {
          const ce = readEntity();
          if (!ce) break;
          if (ce.type === 'ENDBLK' || ce.type === 'ENDSEC' || ce.type === 'EOF') break;
          if (ce.g) ents.push(ce);
        }
        if (name) blocks.set(name, { base: [bx, by], ents });
      }
    }
  }

  function parseEntities() {
    const root = { m: IDENTITY, depth: 0 };
    while (true) {
      const e = readEntity();
      if (!e || e.type === 'ENDSEC' || e.type === 'EOF') break;

      if (e.type === 'POLYLINE') {
        flushPoly();
        if (e.g) {
          const ln = ((e.g['8'] || '0').trim()) || '0';
          const layer = getLayer(ln);
          let ci = parseInt(e.g['62'], 10);
          if (!Number.isFinite(ci) || ci === 256 || ci === 0) ci = layer.colorIndex;
          if (ci < 0) ci = 0; if (ci > 255) ci = 255;
          const flag = parseInt(e.g['70'], 10) || 0;
          poly = { bucket: getBucket(layer.index, ci), layer, pts: [], closed: (flag & 1) !== 0, last: null, prevBulge: 0 };
        }
        continue;
      }
      if (e.type === 'VERTEX') {
        if (poly && e.g && e.g['10'] && e.g['20']) {
          const X = e.g['10'][0], Y = e.g['20'][0];
          const bg = e.g['42'] ? e.g['42'][0] : 0;
          if (poly.last) pushBulge(poly.pts, poly.last[0], poly.last[1], X, Y, poly.prevBulge);
          poly.pts.push(X, Y); upd(X, Y);
          poly.last = [X, Y];
          poly.prevBulge = bg;
        }
        continue;
      }
      if (e.type === 'SEQEND') { flushPoly(); continue; }

      handleEntity(e.type, e.g, root);
    }
    flushPoly();
  }

  /* ---- 主循环 ---- */
  while (i + 1 < n) {
    if (lines[i] !== '0') { i += 2; continue; }
    const name = lines[i + 1].trim();
    if (name === 'SECTION') {
      i += 2;
      let secName = '';
      if (i + 1 < n && lines[i].trim() === '2') { secName = lines[i + 1].trim(); i += 2; }
      if (secName === 'ENTITIES') parseEntities();
      else if (secName === 'BLOCKS') parseBlocks();
      else if (secName === 'TABLES') parseTables();
      else {
        // 跳过未知段（含 HEADER）
        while (i + 1 < n) {
          if (lines[i] === '0' && lines[i + 1].trim() === 'ENDSEC') { i += 2; break; }
          i += 2;
        }
      }
      continue;
    }
    if (name === 'EOF') break;
    i += 2;
  }

  /* ---- 射线 / 构造线：等包围盒定型后再裁剪 ---- */
  if (pendingRays.length) {
    const box = { minX, minY, maxX, maxY };
    if (!Number.isFinite(box.minX)) { box.minX = 0; box.minY = 0; box.maxX = 100; box.maxY = 100; }
    for (const r of pendingRays) {
      const seg = clipInfinite(r.X, r.Y, r.DX, r.DY, box, r.both);
      if (seg.length < 4) continue;
      r.B.segs.push(seg[0], seg[1], seg[2], seg[3]);
      upd(seg[0], seg[1]); upd(seg[2], seg[3]);
    }
  }

  /* ---- 整理输出：数组 → 类型化数组 ---- */
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

  const layers = layerList.map(L => ({
    name: L.name,
    color: aciHex(L.colorIndex),
    visible: L.visible,
    count: L.count
  }));

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) { minX = minY = 0; maxX = maxY = 100; }

  return {
    ok: true,
    fileName: fileName || '',
    bounds: { minX, minY, maxX, maxY },
    layers,
    buckets,
    stats: {
      entities: totalEntities,
      layers: layers.length,
      buckets: buckets.length,
      ms: Date.now() - t0,
      chars: text.length
    }
  };
}

module.exports = { parseDxf, decodeBuffer, aciHex, aciRgb };
