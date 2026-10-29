'use strict';

/**
 * CAD 通用几何工具（DXF / DWG 两条解析链共用）
 *
 * 这里只放「与文件格式无关」的纯计算：
 *   - 线型名 → SVG 虚线样式
 *   - AutoCAD 线宽（1/100 mm）→ 相对线宽系数
 *   - 图案填充 → 线段集合（射线法求交，even-odd 规则）
 *   - 射线/构造线 → 裁剪到视图范围内的线段
 *
 * 之所以独立成模块：dxf-parser 与 dwg-parser 各自维护一套相同的算法迟早会
 * 漂移（1.0.2 里两份 bulge 细分就出现过细微差异），共用一份便于回归。
 */

/* ============================ 线型 ============================ */

// 相对长度单位：实际使用时乘以「1 个线宽基元」，而不是图纸单位。
// 原因：DWG/DXF 的 LTYPE 定义是绝对长度（0.5 图形单位），同一份图纸若以米为
// 单位绘制，0.5 的虚线段只有亚像素 —— 整张图看起来全是实线。按跨度取相对值
// 才能保证任何比例尺下虚线都看得见。
const DASH_TABLE = [
  // 顺序敏感：先匹配更具体的名字
  [/PHANTOM/i, [14, 3, 2, 3, 2, 3]],
  [/DASHDOT|DASH[-_ ]?DOT/i, [9, 3, 0.8, 3]],
  [/DIVIDE/i, [9, 3, 0.8, 3, 0.8, 3]],
  [/CENTER/i, [13, 3, 2.5, 3]],
  [/HIDDEN|HIDDEN2|(^|_)HID($|_)/i, [4, 2]],
  [/DASH/i, [7, 3]],
  [/DOT|(^|_)DOT($|_)/i, [0.8, 1.6]],
  [/BORDER/i, [10, 3]],
];

// ACAD_ISO02W100 这类国际标准线型：编号决定形态，W 后是线宽
const ISO_TABLE = {
  '02': [7, 3], '03': [9, 3, 0.8, 3], '04': [0.8, 1.6],
  '06': [7, 3], '07': [9, 3, 0.8, 3], '08': [9, 3, 0.8, 3, 0.8, 3],
  '09': [9, 3, 0.8, 3], '10': [0.8, 1.6], '11': [7, 3], '12': [0.8, 1.6],
};

/**
 * 线型名 → 虚线数组（相对单位）。返回 null 表示实线。
 * BYLAYER / BYBLOCK / 空 / CONTINUOUS / SOLID 都按实线处理。
 */
function dashFor(name) {
  const s = String(name || '').trim();
  if (!s || /^(BYLAYER|BYBLOCK|CONTINUOUS|SOLID|$)/i.test(s)) return null;
  const iso = /ACAD_ISO(\d\d)/i.exec(s);
  if (iso) return ISO_TABLE[iso[1]] || [7, 3];
  for (let i = 0; i < DASH_TABLE.length; i++) {
    if (DASH_TABLE[i][0].test(s)) return DASH_TABLE[i][1];
  }
  // 认不出的自定义线型：给一个轻虚线，总比当成实线更接近原意
  return [6, 3];
}

/**
 * AutoCAD 线宽（1/100 mm）→ 相对系数。
 * 特殊值：-1 BYLAYER / -2 BYBLOCK / -3 DEFAULT / 29 为标准 0.25mm，都返回 1。
 * 用平方根压缩：0.5mm→1.41、0.7mm→1.67，不会出现粗 8 倍的柱子。
 */
function lwFactor(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n === 29 || n === 25) return 1;
  if (n > 211) return 1;
  return Math.max(0.55, Math.min(2.6, Math.sqrt(n / 25)));
}

/* ============================ 射线 / 构造线 ============================ */

/**
 * 把一条无限长直线（RAY 为半无限，XLINE 为双向）裁剪到给定范围。
 * @param {number} bx,by 基点  @param {number} dx,dy 单位方向
 * @param {{minX,minY,maxX,maxY}} box 目标范围
 * @param {boolean} both 双向（XLINE）
 * @returns {number[]} [x1,y1,x2,y2] 或空数组
 */
function clipInfinite(bx, by, dx, dy, box, both) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-12)) return [];
  const ux = dx / len, uy = dy / len;
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) || 1;
  // 起点退到范围之外，再往前跑 2 倍对角线，保证必然穿过整个范围
  const back = both ? diag : 0;
  const x1 = bx - ux * back, y1 = by - uy * back;
  const x2 = bx + ux * (back + diag), y2 = by + uy * (back + diag);
  return [x1, y1, x2, y2];
}

/* ============================ 图案填充 ============================ */

// 常见图案的兜底参数（图案名 → 45° 斜线间距，单位：图形单位）。
// 只有解析不到图案定义时才用，真实图纸优先用文件里的定义线。
const PATTERN_FALLBACK = {
  ANSI31: 3.0, ANSI32: 3.0, ANSI33: 2.0, ANSI34: 2.0, ANSI35: 3.0, ANSI37: 1.5,
  ANSI38: 2.0, 'ACAD_ISO03W100': 3.0, 'ACAD_ISO04W100': 2.0,
  SOLID: 0, AR_CONC: 4.0, AR_BRICK: 5.0, AR_SAND: 1.2, EARTH: 5.0, GRASS: 4.0,
  LINE: 3.0, STEEL: 2.5, CONCRETE: 4.0, DOTS: 3.0, BRICK: 5.0, HONEY: 3.0,
  NET: 3.0, CROSS: 3.0, ANGLE: 4.0, TRIANG: 4.0, PLAST: 2.0, INSUL: 3.0,
};

/**
 * 图案填充求交：把若干条平行线投到多边形上，按 even-odd 取「交替段」。
 * 用 even-odd 而不是 nonzero，是因为 HATCH 的岛（island）依赖这个语义。
 *
 * @param {Float32Array[]} loops 闭合边界环（扁平坐标 [x,y,...]，无需重复首点）
 * @param {{angle:number, ox:number, oy:number, bx?:number, by?:number}} def
 *        图案定义：线角度、相邻线偏移向量（垂直方向）、基点
 * @param {{maxLines?:number, minSpacing?:number}} opts
 * @returns {number[]} 扁平线段数组 [x1,y1,x2,y2,...]
 */
function hatchLines(loops, def, opts) {
  const out = [];
  if (!loops || !loops.length) return out;

  let angle = Number(def && def.angle);
  if (!Number.isFinite(angle)) angle = Math.PI / 4;
  let ox = Number(def && def.ox);
  let oy = Number(def && def.oy);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) { ox = 0; oy = 3; }
  let spacing = Math.hypot(ox, oy);

  const ca = Math.cos(angle), sa = Math.sin(angle);
  // 转到「线水平」的坐标系：u 沿线方向，v 垂直于线
  const U = (x, y) => x * ca + y * sa;
  const V = (x, y) => -x * sa + y * ca;

  // 收集所有边（旋转后）
  const eu = [], ev = [];
  let vmin = Infinity, vmax = -Infinity, umin = Infinity, umax = -Infinity;
  let nPts = 0;
  for (const loop of loops) {
    const n = Math.floor(loop.length / 2);
    if (n < 3) continue;
    nPts += n;
    for (let i = 0; i < n; i++) {
      const x1 = loop[i * 2], y1 = loop[i * 2 + 1];
      const j = (i + 1) % n;
      const x2 = loop[j * 2], y2 = loop[j * 2 + 1];
      const u1 = U(x1, y1), v1 = V(x1, y1);
      const u2 = U(x2, y2), v2 = V(x2, y2);
      if (v1 < vmin) vmin = v1;
      if (v1 > vmax) vmax = v1;
      if (u1 < umin) umin = u1;
      if (u1 > umax) umax = u1;
      eu.push(u1, u2); ev.push(v1, v2);
    }
  }
  if (!nPts || !(vmax > vmin)) return out;

  const bx = Number(def && def.bx) || 0;
  const by = Number(def && def.by) || 0;
  const v0 = V(bx, by);

  const span = Math.max(vmax - vmin, Math.hypot(umax - umin, vmax - vmin));
  const minSpacing = (opts && opts.minSpacing) || span / 260;   // 再密就糊成一块
  const maxLines = (opts && opts.maxLines) || 900;
  if (!(spacing > 0)) spacing = span / 20;
  if (spacing < minSpacing) spacing = minSpacing;

  let k0 = Math.ceil((vmin - v0) / spacing - 1e-9);
  let k1 = Math.floor((vmax - v0) / spacing + 1e-9);
  let step = 1;
  const total = k1 - k0 + 1;
  if (total > maxLines) step = Math.ceil(total / maxLines);

  const edges = eu.length / 2;
  const cross = [];

  // 图案里的虚线序列（79 组码）：点状图案（ANSI37、DOTS）与断续图案靠它成形，
  // 不拆的话会画成一排实线，反而比淡色填充更难看。长度与坐标同单位。
  const dash = Array.isArray(def && def.dash) ? def.dash.map(Math.abs).filter((d) => d > 1e-12) : null;
  const dashSum = dash ? dash.reduce((a, b) => a + b, 0) : 0;
  const useDash = !!(dash && dash.length > 1 && dashSum > 1e-9);
  const segLimit = (opts && opts.segLimit) || 24000;   // 虚线拆太碎就退回实线
  let segCount = 0;

  const pushSpan = (a, b, v) => {
    out.push(a * ca - v * sa, a * sa + v * ca, b * ca - v * sa, b * sa + v * ca);
  };

  const emit = (ua, ub, v) => {
    if (!useDash) { pushSpan(ua, ub, v); return; }
    let pos = ua, idx = 0, guard = 0;
    while (pos < ub - 1e-12 && guard++ < 6000) {
      const d = dash[idx % dash.length];
      const next = Math.min(ub, pos + d);
      if ((idx % 2) === 0 && next - pos > 1e-12) {
        if (segCount >= segLimit) { pushSpan(ua, ub, v); return; }
        segCount++;
        pushSpan(pos, next, v);
      }
      pos = next;
      idx++;
    }
  };

  for (let k = k0; k <= k1; k += step) {
    const v = v0 + k * spacing;
    cross.length = 0;
    for (let e = 0; e < edges; e++) {
      const v1 = ev[e * 2], v2 = ev[e * 2 + 1];
      // 半开区间判定，顶点处不重复计数
      if ((v1 <= v && v2 > v) || (v2 <= v && v1 > v)) {
        const u1 = eu[e * 2], u2 = eu[e * 2 + 1];
        const t = (v - v1) / (v2 - v1);
        cross.push(u1 + (u2 - u1) * t);
      }
    }
    if (cross.length < 2) continue;
    cross.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cross.length; i += 2) {
      const ua = cross[i], ub = cross[i + 1];
      if (ub - ua < 1e-9) continue;
      emit(ua, ub, v);
    }
  }
  return out;
}

/** 图案名 → 兜底定义（角度固定 45°，双线图案只取主方向） */
function patternByName(name, scale) {
  const key = String(name || '').toUpperCase().trim();
  let sp = PATTERN_FALLBACK[key];
  if (!Number.isFinite(sp)) {
    // 未收录：按名字长度给个合理间距，别让填充糊成一整块
    sp = 3.0;
  }
  const s = Number(scale);
  if (Number.isFinite(s) && s > 0 && s < 1000) sp *= s;
  return { angle: Math.PI / 4, ox: 0, oy: sp, bx: 0, by: 0 };
}

module.exports = {
  dashFor,
  lwFactor,
  clipInfinite,
  hatchLines,
  patternByName,
};
