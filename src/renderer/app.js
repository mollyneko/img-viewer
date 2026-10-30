'use strict';

/* RatViewer — 渲染层
   原则：渲染层只负责显示与交互；所有文件系统、解码、注册表操作都走 window.rat (preload)。*/

const R = window.rat;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// 多语言翻译函数（i18n.js 提供；英文 key 即默认文案）。带容错：i18n 未就绪时原样返回。
const t = (k, p) => (window.RAT_I18N ? window.RAT_I18N.t(k, p) : k);

// 未捕获错误留痕：主进程会把它们写进 userData/logs/rat.log，
// 自检脚本也能通过 window.__ratErrors 读到。（CSP 禁止内联脚本，所以放这里）
window.__ratErrors = [];
const noteError = (kind, msg, where) => {
  window.__ratErrors.push({ kind, msg: String(msg).slice(0, 400), where: String(where || '') });
  console.error('[rat] ' + kind + ': ' + msg + (where ? ' @' + where : ''));
};
window.addEventListener('error', (e) => noteError('error', e.message, (e.filename || '') + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => noteError('rejection', e.reason && e.reason.message ? e.reason.message : e.reason));

// ------------------------------------------------------------------ 工具
const basename = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i >= 0 ? p.slice(i + 1) : p; };
const dirname = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; };
const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; };
// 路径等价比较：斜杠方向归一化 + 忽略大小写。
// 双击打开（Windows 反斜杠）与拖拽进入（D:/... 正斜杠）会给出不同形态的路径，
// 不归一化会导致 requestVector 的 meta.path 比对失败 → 矢量图永远停在「渲染中」。
const normPath = (p) => String(p).replace(/\//g, '\\').toLowerCase();
const samePath = (a, b) => normPath(a) === normPath(b);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmtSize(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PREVIEW_EXT = new Set(['.cdr', '.cmx', '.psd', '.psb', '.tif', '.tiff', '.heic', '.heif',
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng',
  '.orf', '.rw2', '.raf', '.pef', '.srw', '.mrw', '.x3f', '.raw']);
const CAD_EXT = new Set(['.dwg', '.dxf']);
const CDR_EXT = new Set(['.cdr', '.cmx']);
// 矢量格式：缩略图与主画布必须同源同比例（不裁切），否则「预览」和「打开」两个样
const VECTOR_EXT = new Set(['.cdr', '.cmx', '.dwg', '.dxf']);
const NATIVE_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.apng', '.webp', '.gif', '.bmp', '.ico', '.svg', '.avif']);
const NOPLUGIN_EXT = new Set(['.pdf', '.ai', '.eps', '.exr', '.hdr', '.tga', '.jxl', '.dds']);

function badgeOf(ext) {
  if (ext === '.cdr' || ext === '.cmx') return 'cdr';
  if (CAD_EXT.has(ext)) return 'cdr';          // CAD 与 CDR 共用紫色矢量徽标
  if (PREVIEW_EXT.has(ext)) return 'pv';
  return '';
}

// ------------------------------------------------------------------ 状态
const state = {
  files: [],
  index: -1,
  tabs: [],
  meta: null,
  folder: null,
  adj: { b: 0, c: 0, s: 0 },
  view: { z: 1, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 },
  crop: { on: false, ratio: 'free', box: null },
  lens: false,
  playing: false,
  timer: null,
  theme: 'light',
  slideshowInterval: 2600,
  outDir: null,
  batch: [],
  running: false,
  lastOp: t('Ready'),
  // CAD（DWG/DXF）专属状态：内联 SVG、图层、图纸坐标范围、测量/框选
  cad: {
    on: false,
    kind: null,           // null | 'cad' | 'cdr' —— 决定要不要出图层面板
    degraded: false,      // 图纸过大退回 <img> 时为 true
    layers: [],
    groups: new Map(),
    box: null,
    unit: '',             // CDR 的物理单位（mm）；DWG 为空
    page: 0,              // CDR 当前页（从 0 起）
    pages: 1,
    mode: null,           // null | 'measure' | 'win'
    measure: null,        // { a:{x,y}, b:{x,y}|null }
    win: null,
  },
};

const drawCache = new Map();

// ------------------------------------------------------------------ 小提示
let toastTimer = null;
function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function setOp(text) {
  state.lastOp = text;
  $('#sbOp').textContent = text;
}

// ------------------------------------------------------------------ 主题
function applyThemeAttr(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#btnTheme').innerHTML = `<svg class="ic"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg>`;
  $$('#segTheme button').forEach((b) => {
    b.classList.toggle('on', (b.dataset.mode === 'dark') === dark && state.themeMode !== 'system');
  });
  if (state.themeMode === 'system') {
    $$('#segTheme button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'system'));
  }
  buildHistogram(state.histSource);
}

async function setTheme(mode) {
  state.themeMode = mode;
  const r = await R.setTheme(mode);
  applyThemeAttr(!!r.dark);
  // 图纸线条颜色是「烘」在 SVG 里的（缓存也按主题分键），主题变了必须重新取一份，
  // 否则深色主题下还是一片深灰线，等于看不见。
  if (state.cad.on && state.meta && isCadPath(state.meta.path)) {
    requestVector(state.meta.path).catch(() => {});
  }
}

// ------------------------------------------------------------------ 屏幕
function go(name) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'screen-' + name));
  $$('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  $('#app').dataset.screen = name;
  if (name === 'manage') { renderGrid(); renderRecent(); }
  if (name === 'compare') initCompare();
  if (name === 'batch') renderBatchRows();
}

// ------------------------------------------------------------------ 打开发
// 文件夹扫描结果按路径缓存：切换标签时复用，不再每次都重新 scanFolder 整个目录，
// 也避免把当前文件列表整体覆盖掉（多标签「互不干扰」的前提）。
const folderCache = new Map();
async function getFolder(folder) {
  let c = folderCache.get(folder);
  if (!c) {
    const scan = await R.scanFolder(folder);
    c = { folder, files: scan && scan.files ? scan.files : [] };
    folderCache.set(folder, c);
  }
  return c;
}

async function addRecent(folder) {
  try { await R.addRecent(folder); } catch {}
}

async function openPaths(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const first = list[0];
  const ext = extname(first);

  const asDir = await R.scanFolder(first);
  if (asDir && !asDir.error) {
    state.folder = first;
    state.files = asDir.files || [];
    state.index = state.files.length ? 0 : -1;
    folderCache.set(first, { folder: first, files: state.files });
    addRecent(first);
  } else {
    const dir = dirname(first);
    const c = await getFolder(dir);
    state.folder = dir;
    state.files = c.files;
    const i = state.files.findIndex((f) => samePath(f.path, first));
    if (i >= 0) {
      state.index = i;
    } else {
      state.files = [{
        path: first, name: basename(first), ext, dir,
        size: 0, mtime: 0, kind: NATIVE_EXT.has(ext) ? 'native' : 'preview',
      }];
      state.index = 0;
    }
    addRecent(dir);
    addTab(first);
  }

  renderFilm();
  renderGrid();
  if (state.index >= 0) await select(state.index);
  else {
    toast(t('This folder has no supported images'), true);
    renderEmpty();
  }
}

function addTab(p) {
  state.tabs = [p, ...state.tabs.filter((t) => !samePath(t, p))].slice(0, 12);
  renderTabs();
}

function renderTabs() {
  const box = $('#tabs');
  box.innerHTML = '';
  state.tabs.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'tab' + (state.meta && samePath(state.meta.path, p) ? ' on' : '');
    el.title = p;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = basename(p);
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    x.title = t('Close tab');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      state.tabs = state.tabs.filter((t) => !samePath(t, p));
      renderTabs();
    });
    el.append(dot, nm, x);
    el.addEventListener('click', () => openPaths([p]));
    box.appendChild(el);
  });
}

// ------------------------------------------------------------------ 选中/加载
// 连按方向键时会有多个 openImage 同时在飞，谁先回来不确定。
// 用一个自增令牌把「过期的回包」丢掉 —— 否则画面会跳回上一张，
// 而索引/信息面板已经指向新的那张，看起来就是「图和文件名对不上」。
let selectToken = 0;

async function select(i) {
  if (i < 0 || i >= state.files.length) return;
  const f = state.files[i];
  const token = ++selectToken;
  const info = await R.openImage(f.path);
  if (token !== selectToken) return;   // 已经切到别的图了，这次结果作废

  if (!info || !info.ok) {
    state.index = i;
    state.meta = null;
    setCadMode(false);
    const msg = info && info.message ? info.message : t('Cannot open this file');
    // 别让画布退回「把图片拖进来」——那看起来像什么都没打开。
    // 明确写清楚是「这个文件打不开」，并把原因带上。
    renderEmpty(t('This image cannot be opened'), msg);
    toast(msg, true);
    setOp(t('Open failed: {msg}', { msg }));
    renderTabs();
    renderInfo(info);
    return;
  }

  state.index = i;
  state.meta = info;
  // 切换文件时把视图变换与调整重置（避免上一张的姿态串到下一张）
  state.view = { z: 1, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 };
  state.adj = { b: 0, c: 0, s: 0 };
  syncAdjustUI();
  exitCrop(true);
  stopLens();
  // 矢量交互层：DWG/DXF 与「能转成矢量的 CDR/CMX」共用同一套（坐标/测量/框选放大）；
  // 只有内嵌预览、没有矢量引擎的格式保持原来的位图链路。
  const fext = extname(f.path);
  const vecOn = VECTOR_EXT.has(fext) && (info.kind === 'vector' || !!info.vectorPending);
  setCadMode(vecOn, CAD_EXT.has(fext) ? 'cad' : 'cdr');

  const img = $('#stage');
  const t0 = performance.now();
  img.classList.remove('anim');
  img.style.transform = 'none';
  $('#emptyHint').style.display = 'none';

  // 必须先挂回调再赋 src：图片命中缓存时 onload 可能同步触发
  if (info.kind === 'vector') {
    // CDR/CMX/DWG/DXF 没有可用的位图预览，直接等矢量 SVG（毫秒级）
    // 矢量图透明底，直接落在画布底色上；线条颜色由主进程按主题自适应生成
    img.removeAttribute('src');
    $('#emptyHint').style.display = '';
    setEmptyHint(t('Vector rendering…'), t('Converting vector content to SVG'));
    img.onload = () => {
      const ms = Math.round(performance.now() - t0);
      fit();
      $('#perfPill').innerHTML = `${t('Vector')} <b>${ms} ms</b>`;
      buildHistogram(f.path);
    };
    img.onerror = () => {
      setEmptyHint(t('Vector render failed'), t('SVG load failed, please retry'));
    };
    requestVector(f.path);
  } else {
    img.onload = () => {
      const ms = Math.round(performance.now() - t0);
      fit();
      const how = info.kind !== 'preview' ? t('Native decode')
        : (/解码/.test(info.previewSource || '') ? t('Local decode') : t('Embedded preview'));
      $('#perfPill').innerHTML = `${t('Loaded')} <b>${ms} ms</b> · ${how}`;
      buildHistogram(f.path);
    };
    img.onerror = () => {
      renderEmpty();
      toast(t('This image failed to render'), true);
    };
    img.src = R.imageUrl(f.path);
    // 预览只是占位：CDR/CMX 的矢量还在后台转，转好就热替换成矢量
    // （放大不糊、能量尺寸）。右上角徽标可一键切回预览做对比。
    if (info.vectorPending) requestVector(f.path);
  }

  renderInfo(info);
  renderExif(f.path, info.exif);
  renderFilm();
  renderTabs();
  updateStatus();
  // 翻页预取：提前把上一张/下一张（及再外侧两张）的预览/矢量后台准备好，
  // 来回翻看时基本不用等。矢量图预热较重，跳过以免一次 spawn 太多进程。
  prefetchNeighbors(state.index);
  $('#previewPill').style.display = info.kind === 'preview' ? '' : 'none';
  if (info.kind === 'preview') {
    $('#previewPill').textContent = t('Embedded preview · {src}', { src: info.previewSource || '' });
  }
}

// ---- CDR/CMX/DWG/DXF 矢量热替换 ---------------------------------------
// 主进程后台转 SVG；就绪后把画布换成真矢量。
// 若用户已切到别的文件（或 SVG 没生成出来），静默放弃，不影响浏览。
let vectorReqId = 0;
async function requestVector(p, page) {
  const ext = extname(p).toLowerCase();
  if (!VECTOR_EXT.has(ext)) return;
  const id = ++vectorReqId;
  let r = null;
  try {
    r = await R.cdrRender(p, page || 0);
  } catch (e) {
    r = { ok: false, reason: String(e && e.message || e).slice(0, 120) };
  }
  if (id !== vectorReqId) return;                     // 已切走
  if (!r || !r.ok) {
    // 「vector」类文件没有预览可退 —— 明确告诉用户失败原因
    if (state.meta && samePath(state.meta.path, p) && state.meta.kind === 'vector') {
      setEmptyHint(t('Vector render failed'), r && r.reason ? r.reason : t('Unknown reason'));
      toast(t('This file cannot be vectorized: {reason}', { reason: (r && r.reason || t('Unknown reason')) }), true);
    } else if (state.meta && samePath(state.meta.path, p)) {
      // CDR 还能看内嵌预览，提示一句就够，别把画面清掉
      setOp(t('Vector parsing unavailable, still showing embedded preview'));
    }
    return;
  }
  if (!state.meta || !samePath(state.meta.path, p)) return;

  // DWG/DXF 与 CDR/CMX 一律内联 SVG：图层（有的话）、坐标、测量、
  // 框选放大都要落在 DOM 上才做得了；内联失败时函数内部会退成 <img>。
  await showCadVector(p, r);
}

/* ============================================================== CAD 看图 */
// 思路参考 cad.js：把「一张图纸」当成可管理的场景，而不是一张扁平位图。
// 解析结果按图层分组输出成 SVG → 视口负责缩放/平移/框选放大 →
// 右侧图层树可整层开关，光标落在哪儿就报哪儿的图纸坐标，还能拉一条测量线。
// 全部是「读」的能力，不碰其它格式的显示链路。

const isCadPath = (p) => CAD_EXT.has(extname(p));
const MAX_INLINE_SVG = 12 * 1024 * 1024;   // 再大内联会让主线程卡顿，退回 <img>

function setCadMode(on, kind) {
  const yes = !!on;
  state.cad.on = yes;
  state.cad.kind = yes ? (kind || 'cad') : null;
  state.cad.degraded = false;
  document.body.classList.toggle('cad-mode', yes);
  // CDR 的 SVG 是扁平的（librevenge 的导出器没有图层概念），
  // 用 cad-flat 把图层面板整块收起来，别摆一个永远空着的卡片。
  document.body.classList.toggle('cad-flat', yes && state.cad.kind !== 'cad');
  resetCad();
}

function resetCad() {
  state.cad.layers = [];
  state.cad.groups = new Map();
  state.cad.box = null;
  state.cad.unit = '';
  state.cad.page = 0;
  state.cad.pages = 1;
  state.cad.measure = null;
  state.cad.mode = null;
  const st = $('#cadStage');
  st.classList.remove('on', 'anim', 'lens-off');
  st.replaceChildren();
  st.style.width = '';
  st.style.height = '';
  const svg = $('#measureLayer');
  svg.classList.remove('on');
  svg.replaceChildren();
  $('#measureTip').classList.remove('on');
  $('#cadRubber').classList.remove('on');
  $('#cadLayers').innerHTML = '';
  $('#btnMeasure').classList.remove('on');
  $('#btnCadWin').classList.remove('on');
  $('#viewport').classList.remove('cad-cross');
  const pg = $('#pageBar');
  if (pg) pg.style.display = 'none';
}

// 把主进程转好的 SVG 内联进页面。只有内联成 DOM，图层显隐/坐标拾取才有落点。
// DWG/DXF（有图层）与 CDR/CMX（扁平、但有页面几何）走的是同一条路：
// 能内联就内联，内联失败才退成 <img>。
async function showCadVector(p, r) {
  const meta = state.meta;
  const stage = $('#cadStage');
  const t0 = performance.now();

  // 坐标换算要「画布像素」和「图纸范围」同比例。尺寸没拿到（width/height=0）时
  // 画布会退回预览尺寸，两者比例就对不上了 —— 宁可不出坐标，也别给个错数。
  const geoBox = r.box && r.width > 0 && r.height > 0 ? r.box : null;

  const inlineable = !!r.inline || (Array.isArray(r.layers) && r.layers.length > 0);
  let text = null;
  if (inlineable) {
    try {
      const res = await fetch(r.url);
      if (res.ok) text = await res.text();
    } catch (e) {
      noteError('cad', e && e.message ? e.message : e, 'showCadVector');
    }
  }
  if (text && text.length > MAX_INLINE_SVG) text = null;

  let node = null;
  if (text) {
    try {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc && doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
        throw new Error('svg parse');
      }
      root.setAttribute('width', '100%');
      root.setAttribute('height', '100%');
      node = document.importNode(root, true);
    } catch (e) {
      noteError('cad', e && e.message ? e.message : e, 'showCadVector.parse');
      node = null;
    }
  }

  // 兜底：图纸过大 / 内联失败 → 仍然用 <img> 显示，只是没有图层与坐标能力
  if (!node) {
    const img = $('#stage');
    img.onload = () => {
      const ms = Math.round(performance.now() - t0);
      // 这里必须自己收提示：上面的正常分支才收，兜底分支漏了就会「画上去了却一直
      // 显示矢量渲染中」，看起来像卡死。
      $('#emptyHint').style.display = 'none';
      fit();
      $('#perfPill').innerHTML = `${t('Vector')} <b>${ms} ms</b> · ${Math.round(r.width)}×${Math.round(r.height)}`;
      buildHistogram(p);
    };
    img.onerror = () => {
      setEmptyHint(t('Vector render failed'), t('SVG load failed, please retry'));
    };
    img.src = r.url;
    stage.classList.remove('on');
    stage.replaceChildren();
    state.cad.layers = Array.isArray(r.layers) ? r.layers : [];
    state.cad.groups = new Map();
    state.cad.box = geoBox;
    state.cad.unit = r.unit || '';
    state.cad.page = Number(r.page) || 0;
    state.cad.pages = Math.max(1, Number(r.pages) || 1);
    state.cad.degraded = true;
    meta.kind = 'vector';
    meta.previewSource = '';
    meta.previewSize = 0;
    meta.cadBox = geoBox;
    meta.cadUnit = r.unit || '';
    meta.cadPages = state.cad.pages;
    meta.cadLayers = state.cad.layers.length;
    meta.cadEntities = r.entities || 0;
    renderCadLayers();
    renderPageBar();
    // 图层数与图元数要跟着刷新，否则信息面板会停留在解析前的「—」
    renderInfo(meta);
    updateStatus();
    return;
  }

  state.cad.degraded = false;
  // 预览只是过渡态：矢量上屏后信息栏不该继续写「CDR · 预览 / 内嵌预览」
  meta.kind = 'vector';
  meta.previewSource = '';
  meta.previewSize = 0;
  meta.width = Math.round(r.width) || meta.width;
  meta.height = Math.round(r.height) || meta.height;
  state.cad.box = geoBox;
  state.cad.unit = r.unit || '';
  state.cad.page = Number(r.page) || 0;
  state.cad.pages = Math.max(1, Number(r.pages) || 1);
  state.cad.layers = r.layers || [];
  state.cad.measure = null;
  state.cad.mode = null;
  meta.cadBox = geoBox;
  meta.cadUnit = r.unit || '';
  meta.cadPages = state.cad.pages;
  meta.cadLayers = state.cad.layers.length;
  meta.cadEntities = r.entities || 0;

  stage.style.width = meta.width + 'px';
  stage.style.height = meta.height + 'px';
  stage.replaceChildren(node);
  stage.classList.add('on');
  // 位图这层要腾空，否则矢量图透明的地方会透出下面的旧预览（两张图叠在一起）
  $('#stage').removeAttribute('src');
  $('#emptyHint').style.display = 'none';

  bindCadGroups(node);
  renderCadLayers();
  renderPageBar();

  const ms = Math.round(performance.now() - t0);
  fit();
  const bw = state.cad.box ? state.cad.box.maxX - state.cad.box.minX : meta.width;
  const bh = state.cad.box ? state.cad.box.maxY - state.cad.box.minY : meta.height;
  const dim = state.cad.unit
    ? `${fmtUnit(bw)} × ${fmtUnit(bh)} ${state.cad.unit}`
    : `${meta.width}×${meta.height}`;
  $('#perfPill').innerHTML = state.cad.layers.length
    ? `矢量 <b>${ms} ms</b> · ${dim} · ${t('{n} layers', { n: state.cad.layers.length })}`
    : `${t('Vector')} <b>${ms} ms</b> · ${dim}`;
  const tag = state.cad.kind === 'cdr' ? 'CDR' : (r.format || 'DWG');
  $('#previewPill').textContent = t('Vector') + ' · ' + tag;
  $('#previewPill').style.display = '';
  $('#fmtPill').textContent = tag;
  if (state.cad.pages > 1) setOp(t('Page {cur} / {total}', { cur: state.cad.page + 1, total: state.cad.pages }));
  renderInfo(meta);
  updateStatus();
  buildHistogram(p);
}

function bindCadGroups(root) {
  const map = new Map();
  const groups = root.querySelectorAll('g[data-layer]');
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k];
    const i = g.getAttribute('data-layer');
    map.set(i, g);
    const L = state.cad.layers[Number(i)];
    // 属性 display="none" 会盖住 style.display=''，统一收拢成内联样式，状态才好改
    g.removeAttribute('display');
    g.style.display = (L && L.visible === false) ? 'none' : '';
  }
  state.cad.groups = map;
}

// ---- 图层树 ----
function layerOn(i) {
  const g = state.cad.groups.get(String(i));
  if (!g) return !!(state.cad.layers[i] && state.cad.layers[i].visible !== false);
  return g.style.display !== 'none';
}

function setLayerVisible(i, on) {
  const g = state.cad.groups.get(String(i));
  if (g) g.style.display = on ? '' : 'none';
  const row = $('#cadLayers').querySelector(`.cad-lrow[data-i="${i}"]`);
  if (row) {
    row.classList.toggle('off', !on);
    const eye = row.querySelector('.cad-eye');
    if (eye) eye.title = on ? t('Hide this layer') : t('Show this layer');
  }
  if (state.cad.measure) drawMeasure();
}

function toggleLayer(i) {
  if (state.cad.degraded) return;
  setLayerVisible(i, !layerOn(i));
  setOp(layerOn(i) ? t('Layer "{name}" shown', { name: state.cad.layers[i].name }) : t('Layer "{name}" hidden', { name: state.cad.layers[i].name }));
}

function soloLayer(i) {
  if (state.cad.degraded) return;
  for (let k = 0; k < state.cad.layers.length; k++) setLayerVisible(k, k === i);
  setOp(t('Solo layer "{name}"', { name: state.cad.layers[i].name }));
}

function allLayers(on) {
  if (state.cad.degraded) return;
  for (let k = 0; k < state.cad.layers.length; k++) setLayerVisible(k, on);
  setOp(on ? t('Show all layers') : t('Hide all layers'));
}

function renderCadLayers() {
  const box = $('#cadLayers');
  box.innerHTML = '';
  const list = state.cad.layers || [];
  // CDR/CMX 的 SVG 是扁平的（librevenge 不带图层），整块卡片由 .cad-flat 收起
  if (state.cad.kind !== 'cad') return;
  if (state.cad.degraded) {
    box.innerHTML = '<div class="hint">' + t('Drawing too large, layer interaction disabled (zoom/pan still works)') + '</div>';
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const L = list[i];
    const row = document.createElement('div');
    const on = layerOn(i) && L.visible !== false;
    row.className = 'cad-lrow' + (on ? '' : ' off');
    row.dataset.i = String(i);
    const sw = document.createElement('span');
    sw.className = 'cad-sw';
    sw.style.setProperty('--c', L.color || '#9aa4b2');
    const nm = document.createElement('span');
    nm.className = 'cad-nm';
    nm.textContent = L.name;
    nm.title = L.name;
    const ct = document.createElement('span');
    ct.className = 'cad-ct';
    ct.textContent = L.count ? String(L.count) : '';
    const eye = document.createElement('button');
    eye.className = 'cad-eye';
    eye.title = on ? t('Hide this layer') : t('Show this layer');
    eye.innerHTML = '<svg class="ic"><use href="#i-eye"/></svg>';
    eye.addEventListener('click', (e) => { e.stopPropagation(); toggleLayer(i); });
    row.addEventListener('dblclick', () => soloLayer(i));
    row.append(sw, nm, ct, eye);
    box.appendChild(row);
  }
}

// ---- 多页（CDR/CMX）----
// 像名片正反面、多页画册这类文件，libcdr 每页单独转一份 SVG；
// 这里只负责页码与切页，样式沿用工具栏的 pill-bar。
function renderPageBar() {
  const bar = $('#pageBar');
  if (!bar) return;
  const total = Math.max(1, state.cad.pages || 1);
  const on = !!state.cad.on && state.cad.kind === 'cdr' && total > 1;
  bar.style.display = on ? 'inline-flex' : 'none';
  if (!on) return;
  const cur = Math.min(total - 1, Math.max(0, state.cad.page || 0));
  $('#pageNow').textContent = String(cur + 1);
  $('#pageTotal').textContent = String(total);
  $('#pagePrev').disabled = cur <= 0;
  $('#pageNext').disabled = cur >= total - 1;
}

function gotoPage(delta) {
  const total = Math.max(1, state.cad.pages || 1);
  const cur = state.cad.page || 0;
  const next = Math.min(total - 1, Math.max(0, cur + delta));
  if (next === cur || !state.meta || !state.meta.path) return;
  setOp(t('Loading page {cur} / {total}…', { cur: next + 1, total }));
  requestVector(state.meta.path, next);
}

// ---- 图纸坐标 ----
// SVG 的 viewBox 就是图纸坐标范围；把它和「图像像素」对上，就能在两者之间来回换算。
function cadUnitAt(cx, cy) {
  const m = state.meta;
  const box = state.cad.box;
  if (!state.cad.on || !m || !box || !m.width || !m.height) return null;
  const img = imageRect();
  const px = (cx - img.left) / state.view.z;
  const py = (cy - img.top) / state.view.z;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return {
    x: box.minX + (px / m.width) * (box.maxX - box.minX),
    y: box.maxY - (py / m.height) * (box.maxY - box.minY),
    px, py,
  };
}

function cadScreenAt(x, y) {
  const m = state.meta;
  const box = state.cad.box;
  if (!m || !box) return { x: 0, y: 0 };
  const img = imageRect();
  const px = (x - box.minX) / (box.maxX - box.minX) * m.width;
  const py = (box.maxY - y) / (box.maxY - box.minY) * m.height;
  return { x: img.left + px * state.view.z, y: img.top + py * state.view.z };
}

// withUnit：CDR 的图纸坐标是毫米（页面尺寸），读数带上单位才有意义；
// DWG 的图形单位因图而异，照旧只给数字。
function fmtUnit(v, withUnit) {
  const a = Math.abs(v);
  const s = a >= 1000 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  return withUnit && state.cad.unit ? `${s} ${state.cad.unit}` : s;
}

function updateCoord(cx, cy) {
  const el = $('#coordPill');
  if (!state.cad.on) return;
  const u = cadUnitAt(cx, cy);
  const unit = state.cad.unit ? ` ${state.cad.unit}` : '';
  el.textContent = u ? `X ${fmtUnit(u.x)}  Y ${fmtUnit(u.y)}${unit}` : 'X — Y —';
}

// ---- 测量 ----
function drawMeasure() {
  const svg = $('#measureLayer');
  const tip = $('#measureTip');
  if (!svg) return;
  const on = !!state.cad.on;
  svg.classList.toggle('on', on);
  const ms = state.cad.measure;
  if (!on || !ms) {
    if (svg.firstChild) svg.replaceChildren();
    tip.classList.remove('on');
    return;
  }
  const { w, h } = vpSize();
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(Math.round(w)));
  svg.setAttribute('height', String(Math.round(h)));

  const a = cadScreenAt(ms.a.x, ms.a.y);
  const b = ms.b ? cadScreenAt(ms.b.x, ms.b.y) : null;
  const parts = [];
  if (b) {
    parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    parts.push(`<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="3.5" fill="currentColor"/>`);
  }
  parts.push(`<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="3.5" fill="currentColor"/>`);
  svg.innerHTML = parts.join('');

  if (b) {
    const dx = ms.b.x - ms.a.x, dy = ms.b.y - ms.a.y;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    tip.innerHTML = t('Distance {d} · ΔX {dx} ΔY {dy} · {ang}°', {
      d: `<b>${fmtUnit(d, 1)}</b>`, dx: fmtUnit(Math.abs(dx)), dy: fmtUnit(Math.abs(dy)), ang: ang.toFixed(1),
    });
    tip.style.left = ((a.x + b.x) / 2) + 'px';
    tip.style.top = Math.min(a.y, b.y) + 'px';
    tip.classList.add('on');
  } else {
    tip.classList.remove('on');
  }
}

function toggleMeasure() {
  if (!state.cad.on) return;
  const next = state.cad.mode === 'measure' ? null : 'measure';
  state.cad.mode = next;
  state.cad.measure = null;
  stopWinZoom();
  $('#btnMeasure').classList.toggle('on', next === 'measure');
  $('#viewport').classList.toggle('cad-cross', !!next);
  drawMeasure();
  setOp(next ? t('Measure: click two points to measure, Esc to exit') : t('Measure exited'));
}

function measureClick(cx, cy) {
  const u = cadUnitAt(cx, cy);
  if (!u) return;
  const cur = state.cad.measure;
  if (!cur || cur.b) {
    state.cad.measure = { a: u, b: null };
  } else {
    state.cad.measure = { a: cur.a, b: u };
    const d = Math.hypot(u.x - cur.a.x, u.y - cur.a.y);
    setOp(t('Measure result: {d} (Esc to clear)', { d: fmtUnit(d, 1) }));
  }
  drawMeasure();
}

// ---- 窗口放大（框选一块区域铺满视口）----
function stopWinZoom() {
  $('#cadRubber').classList.remove('on');
  if (state.cad.mode === 'win') state.cad.mode = null;
  $('#btnCadWin').classList.remove('on');
  $('#viewport').classList.remove('cad-cross');
  state.cad.win = null;
}

function toggleWinZoom() {
  if (!state.cad.on) return;
  const next = state.cad.mode === 'win' ? null : 'win';
  state.cad.mode = next;
  if (next !== 'measure') { $('#btnMeasure').classList.remove('on'); }
  $('#btnCadWin').classList.toggle('on', next === 'win');
  $('#viewport').classList.toggle('cad-cross', !!next);
  $('#cadRubber').classList.remove('on');
  setOp(next ? t('Window zoom: drag a box, Esc to exit') : t('Window zoom exited'));
}

function winZoomStart(cx, cy) {
  state.cad.win = { x0: cx, y0: cy, x1: cx, y1: cy };
  const el = $('#cadRubber');
  el.style.left = cx + 'px';
  el.style.top = cy + 'px';
  el.style.width = '0px';
  el.style.height = '0px';
  el.classList.add('on');
}

function winZoomMove(cx, cy) {
  const w = state.cad.win;
  if (!w) return;
  w.x1 = cx;
  w.y1 = cy;
  const el = $('#cadRubber');
  el.style.left = Math.min(w.x0, w.x1) + 'px';
  el.style.top = Math.min(w.y0, w.y1) + 'px';
  el.style.width = Math.abs(w.x1 - w.x0) + 'px';
  el.style.height = Math.abs(w.y1 - w.y0) + 'px';
}

function winZoomEnd() {
  const w = state.cad.win;
  $('#cadRubber').classList.remove('on');
  state.cad.win = null;
  if (!w || !state.meta) return;
  const dw = Math.abs(w.x1 - w.x0);
  const dh = Math.abs(w.y1 - w.y0);
  if (dw < 12 || dh < 12) return;          // 误点当作没发生
  const { w: vw, h: vh } = vpSize();
  const img = imageRect();
  const z = state.view.z;
  // 选区换算到「图像像素」坐标
  const ix = (Math.min(w.x0, w.x1) - img.left) / z;
  const iy = (Math.min(w.y0, w.y1) - img.top) / z;
  const iw = dw / z;
  const ih = dh / z;
  const nz = clamp(Math.min(vw / iw, vh / ih), 0.02, 200);
  const m = state.meta;
  state.view.z = nz;
  state.view.tx = -((ix + iw / 2) - m.width / 2) * nz;
  state.view.ty = -((iy + ih / 2) - m.height / 2) * nz;
  updateStage();
  setOp(t('Zoomed to selection'));
}

/* ============================================================ CAD 看图结束 */

function prev() {
  if (!state.files.length) return;
  select((state.index - 1 + state.files.length) % state.files.length);
}

function next() {
  if (!state.files.length) return;
  select((state.index + 1) % state.files.length);
}

// 翻页预取：把相邻 1–2 张送进 openImage（native 读 EXIF、preview/矢量会顺手预热），
// 让来回翻看几乎瞬时。矢量图预热要起进程，跳过避免刷图时一次性拉起太多。
// 加了防抖：按住方向键连翻时，每按一次就发 4 个 IPC 会把主进程塞爆，
// 等手停下来（180ms 没有新选中）再预取才有意义。
let prefetchTimer = null;
function prefetchNeighbors(i) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (state.index !== i) return;     // 期间又翻页了，交给新的那次预取
    const total = state.files.length;
    if (!total) return;
    for (const j of [i - 1, i + 1, i - 2, i + 2]) {
      if (j < 0 || j >= total) continue;
      const f = state.files[j];
      if (VECTOR_EXT.has(String(f.ext || '').toLowerCase())) continue;
      R.openImage(f.path).catch(() => {});
    }
  }, 180);
}

const EMPTY_HINT_TITLE = 'Drag images or a folder here';
const EMPTY_HINT_SUB = 'Or click “Open” / “Folder” at top-left　Supported: JPG · PNG · WebP · GIF · BMP · AVIF · SVG · TIFF · PSD · CDR · DWG · RAW';

function setEmptyHint(title, sub) {
  const t = $('#emptyHint .eh-t');
  const s = $('#emptyHint .eh-s');
  if (t) t.textContent = title != null ? title : t(EMPTY_HINT_TITLE);
  if (s) s.textContent = sub != null ? sub : t(EMPTY_HINT_SUB);
}

function renderEmpty(hintTitle, hintSub) {
  $('#emptyHint').style.display = '';
  setEmptyHint(hintTitle, hintSub);
  $('#stage').removeAttribute('src');
  $('#dimPill').textContent = '—';
  $('#sizePill').textContent = '—';
  $('#fmtPill').textContent = '—';
  $('#zoomVal').textContent = '—';
  setCadMode(false);
  $('#coordPill').textContent = 'X — Y —';
}

// ------------------------------------------------------------------ 视图变换
// 滤镜表达式只有亮度/对比度/饱和度变化时才需要重设。
// 平移时每秒要调 updateStage 几十次，重复写同一个 style.filter 会让浏览器
// 白白重建一次滤镜链。
let lastFilter = null;

function updateStage(anim) {
  const img = $('#stage');
  const v = state.view;
  img.classList.toggle('anim', !!anim);
  const filter = `brightness(${(1 + state.adj.b / 100 * 0.6).toFixed(3)}) `
    + `contrast(${(1 + state.adj.c / 100 * 0.9).toFixed(3)}) `
    + `saturate(${(1 + state.adj.s / 100).toFixed(3)})`;
  if (filter !== lastFilter) {
    img.style.filter = filter;
    lastFilter = filter;
  }
  // -50%,-50% 先把图中心对齐到视口中心(#stage 被 absolute 定位在 50%/50%),
  // 之后 tx/ty 就是「图中心相对视口中心的偏移」—— 与 zoomAt/imageRect 的模型一致
  const tf = `translate(-50%, -50%) translate(${v.tx}px, ${v.ty}px) scale(${v.z}) rotate(${v.rot}deg) scale(${v.sx}, ${v.sy})`;
  img.style.transform = tf;
  // CAD 的内联 SVG 画布与位图共用同一套变换，切图层/读坐标才不会错位
  const cadEl = $('#cadStage');
  if (cadEl) {
    cadEl.classList.toggle('anim', !!anim);
    cadEl.style.transform = tf;
  }
  $('#zoomVal').textContent = Math.round(v.z * 100) + '%';
  if (state.crop.on) drawCrop();   // 缩放/平移后重算裁剪框位置
  if (state.cad.on) drawMeasure(); // 测量线与图纸同步缩放
}

function vpSize() {
  const r = $('#viewport').getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function fit() {
  const m = state.meta;
  if (!m || !m.width || !m.height) return;
  const { w, h } = vpSize();
  const pad = 24;
  const rot = Math.abs(state.view.rot) % 180 === 90;
  const iw = rot ? m.height : m.width;
  const ih = rot ? m.width : m.height;
  const z = Math.max(0.02, Math.min((w - pad) / iw, (h - pad) / ih));
  state.view.z = z;
  state.view.tx = 0;
  state.view.ty = 0;
  updateStage(true);
}

function oneToOne() {
  state.view.z = 1;
  state.view.tx = 0;
  state.view.ty = 0;
  updateStage(true);
}

function zoomAt(factor, cx, cy) {
  const { w, h } = vpSize();
  const px = (cx === undefined ? w / 2 : cx) - w / 2;
  const py = (cy === undefined ? h / 2 : cy) - h / 2;
  const v = state.view;
  const nz = clamp(v.z * factor, 0.02, 64);
  const k = nz / v.z;
  v.tx = px - (px - v.tx) * k;
  v.ty = py - (py - v.ty) * k;
  v.z = nz;
  updateStage();
}

function rotate(delta) {
  state.view.rot = (state.view.rot + delta) % 360;
  fit();
}

function flip(axis) {
  if (axis === 'h') state.view.sx *= -1;
  else state.view.sy *= -1;
  updateStage();
}

// ------------------------------------------------------------------ 调整 + 直方图
function syncAdjustUI() {
  for (const [id, key] of [['#adjBright', 'b'], ['#adjContrast', 'c'], ['#adjSat', 's']]) {
    $(id).value = state.adj[key];
    $(id + 'V').textContent = state.adj[key];
  }
}

function applyAdjust() {
  state.adj.b = +$('#adjBright').value;
  state.adj.c = +$('#adjContrast').value;
  state.adj.s = +$('#adjSat').value;
  syncAdjustUI();
  updateStage();
}

function resetAdjust() {
  state.adj = { b: 0, c: 0, s: 0 };
  syncAdjustUI();
  updateStage();
  setOp(t('Reset adjust'));
}

async function getDrawable(p) {
  if (drawCache.has(p)) return drawCache.get(p);
  const r = await R.imageBytes(p);
  if (!r || !r.ok) return null;
  const blob = new Blob([r.data], { type: r.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  const ok = await new Promise((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = url;
  });
  if (!ok) {
    URL.revokeObjectURL(url);
    return null;
  }
  const rec = { url, w: img.naturalWidth, h: img.naturalHeight, img };
  if (drawCache.size > 8) {
    const k = drawCache.keys().next().value;
    const old = drawCache.get(k);
    URL.revokeObjectURL(old.url);
    drawCache.delete(k);
  }
  drawCache.set(p, rec);
  return rec;
}

function smallSample(d) {
  const max = 220;
  const scale = Math.min(1, max / Math.max(d.w, d.h));
  const w = Math.max(1, Math.round(d.w * scale));
  const h = Math.max(1, Math.round(d.h * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(d.img, 0, 0, w, h);
  return { ctx, w, h };
}

state.histSource = null;

function drawHist(ctx, W, H, hist) {
  const { bins, rgb } = hist;
  const colors = ['rgba(120,130,150,.55)', 'rgba(220,70,80,.45)', 'rgba(60,190,120,.45)', 'rgba(70,130,240,.45)'];
  const series = [bins, rgb[0], rgb[1], rgb[2]];
  for (let s = 0; s < series.length; s++) {
    ctx.beginPath();
    const src = series[s];
    const p2 = Math.max(...src, 1);
    for (let i = 0; i < 64; i++) {
      const x = (i / 63) * W;
      const y = H - (src[i] / p2) * (H - 6);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = colors[s];
    ctx.fill();
  }
}

// 矢量图（CDR/DWG 的 SVG）画到 canvas 后，浏览器出于安全策略禁止 getImageData 回读像素，
// 所以矢量图的直方图天然不可用 —— 这里把异常兜住，画布显示「无法读取像素」而不是整页报错。

// 直方图只需要 220px 左右的一小撮像素。原实现走 imageBytes 把整张原图搬进渲染层
// 再解码一遍：一张 32MB 的图约 100ms，还要瞬时多占 64MB 内存 —— 只为了画个 240×72 的小图。
// 缩略图管道早就把同一张图的 220px 版本生成好并落盘了，直接 fetch 它即可（约 20KB）。
// 拿不到（矢量 / 特殊格式）再退回原来的整图读取。
const histMemo = new Map();          // path -> {bins, rgb, mean, std}
const HIST_MEMO_MAX = 24;

async function loadThumbDrawable(p) {
  try {
    // 宽度必须与胶片条一致(220)，否则会生成两份不同尺寸的缩略图缓存 ——
    // 本来想省一次整图传输，结果多转一张，得不偿失。
    const res = await fetch(R.thumbUrl(p, 220));
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const ok = await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!ok) {
      URL.revokeObjectURL(url);
      return null;
    }
    return { url, w: img.naturalWidth, h: img.naturalHeight, img, temp: true };
  } catch {
    return null;
  }
}

async function buildHistogram(p) {
  state.histSource = p || null;
  const cv = $('#hist');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!p) return;

  const dark = document.documentElement.dataset.theme === 'dark';
  ctx.fillStyle = dark ? '#0a0d12' : '#eef0f4';
  ctx.fillRect(0, 0, W, H);

  const failed = () => {
    ctx.fillStyle = dark ? '#6c7787' : '#8b93a3';
    ctx.font = '11px sans-serif';
    ctx.fillText(t('Cannot read pixels'), 10, H / 2 + 4);
  };

  // 同一张图反复翻回时直接复用已算好的直方图，省一次采样
  const memo = histMemo.get(p);
  if (memo) {
    state.histStats = { mean: memo.mean, std: memo.std };
    drawHist(ctx, W, H, memo);
    return;
  }

  let d = await loadThumbDrawable(p);
  if (!d) d = await getDrawable(p);       // 缩略图取不到 → 退回整图字节
  if (!d) {
    failed();
    return;
  }

  let hist = d.hist || null;
  if (!hist) {
    try {
      const s = smallSample(d);
      const data = s.ctx.getImageData(0, 0, s.w, s.h).data;
      const bins = new Array(64).fill(0);
      const rgb = [new Array(64).fill(0), new Array(64).fill(0), new Array(64).fill(0)];
      let sum = 0;
      let sum2 = 0;
      const n = s.w * s.h;
      for (let i = 0; i < n; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += l;
        sum2 += l * l;
        bins[Math.min(63, (l / 4) | 0)]++;
        rgb[0][Math.min(63, (r / 4) | 0)]++;
        rgb[1][Math.min(63, (g / 4) | 0)]++;
        rgb[2][Math.min(63, (b / 4) | 0)]++;
      }
      const mean = sum / n;
      const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      hist = { bins, rgb, mean, std };
      d.hist = hist;      // 走整图路径时顺手留在 drawCache 里
    } catch (e) {
      hist = null;        // 画不进去 / 读不回来（taint），按不支持处理
    }
  }

  if (d.temp) URL.revokeObjectURL(d.url);

  if (!hist) {
    failed();
    return;
  }
  state.histStats = { mean: hist.mean, std: hist.std };
  if (histMemo.size >= HIST_MEMO_MAX) histMemo.delete(histMemo.keys().next().value);
  histMemo.set(p, hist);
  drawHist(ctx, W, H, hist);
}

function autoEnhance() {
  const st = state.histStats;
  if (!st) {
    toast(t('No image opened yet'));
    return;
  }
  const b = clamp(Math.round((132 - st.mean) * 0.40), -40, 40);
  const c = clamp(Math.round((66 - st.std) * 0.55), -22, 32);
  state.adj = { b, c, s: 14 };
  syncAdjustUI();
  updateStage();
  setOp(t('Auto enhance: brightness {b}, contrast {c}, saturation +14', { b: (b >= 0 ? '+' : '') + b, c: (c >= 0 ? '+' : '') + c }));
}

// ------------------------------------------------------------------ 信息面板
function kv(rows) {
  return rows.map(([k, v, cls]) => {
    const val = (v === '' || v === null || v === undefined) ? '—' : String(v);
    const title = String(val).replace(/"/g, '&quot;');
    return `<div class="r"><span class="k">${k}</span><span class="v ${cls || ''}" title="${title}">${val}</span></div>`;
  }).join('');
}

function renderInfo(info) {
  const m = state.meta || info;
  if (!m || !m.path) {
    $('#kvInfo').innerHTML = '<div class="empty">' + t('No image open') + '</div>';
    return;
  }
  const src = m.previewSource || t('Embedded image');
  const pExt = extname(m.path);
  const isCdr = CDR_EXT.has(pExt);
  const kindText = m.kind === 'preview'
    ? (/解码/.test(src) ? t('Local decode ({fmt})', { fmt: m.format || '' }) : t('Embedded preview ({src})', { src }))
    : m.kind === 'vector' ? (isCadPath(m.path) ? t('Vector parse (DWG/DXF)') : isCdr ? t('Vector render (CDR)') : t('Vector render'))
      : m.ok === false ? (m.reason === 'needs-plugin' ? t('Needs decode plugin') : t('Not supported yet'))
        : t('Native decode');
  // 图纸用「图纸单位」标尺寸：SVG 的内在像素（2048px 之类）对用户没有意义
  const box = m.cadBox;
  const isCad = isCadPath(m.path);
  const usePage = (isCad || isCdr) && box;
  const pageUnit = m.cadUnit === 'mm' ? t(' mm') : t(' units');
  const dimText = usePage
    ? `${fmtUnit(box.maxX - box.minX)} × ${fmtUnit(box.maxY - box.minY)}${pageUnit}`
    : (m.width && m.height ? `${m.width} × ${m.height}` : '—');
  const rows = [
    [t('File name'), m.name, 'wrap'],
    [t('Format'), (m.format || '') + (m.kind === 'preview' ? ' · ' + t('Preview') : '')],
    [t('Dimensions'), dimText],
    [t('Size'), fmtSize(m.size)],
    [t('Modified'), fmtTime(m.mtime)],
    [t('Decode method'), kindText, 'wrap'],
    [t('Location'), m.dir, 'wrap mono'],
  ];
  if (isCad && m.cadLayers != null) {
    rows.splice(3, 0, [t('Layers'), String(m.cadLayers)], [t('Entities'), String(m.cadEntities || 0)]);
  }
  // 多页 CDR（名片正反面、画册）把页数摆出来，否则用户不知道还能往后翻
  if (isCdr && m.cadPages > 1) {
    rows.splice(3, 0, [t('Pages'), `${m.cadPages}${t(' pages')}${state.cad.page ? t(' (page {n})', { n: state.cad.page + 1 }) : ''}`]);
  }
  if (m.kind === 'preview' && m.previewSize) {
    rows.splice(4, 0, [t('Decoded size'), fmtSize(m.previewSize)]);
  }
  $('#kvInfo').innerHTML = kv(rows);
}

async function renderExif(p, exif) {
  const e = exif || (await R.readExif(p));
  if (!e) {
    $('#kvExif').innerHTML = '<div class="empty">' + t('This file has no readable EXIF') + '</div>';
    return;
  }
  const cam = [e.make, e.model].filter(Boolean).join(' ');
  const rows = [
    [t('Camera'), cam],
    [t('Lens'), e.lens, 'wrap'],
    [t('Shutter'), e.exposure],
    [t('Aperture'), e.aperture],
    ['ISO', e.iso],
    [t('Focal length'), e.focal],
    [t('Capture time'), e.dateTime],
    [t('Orientation'), e.orientationText],
    [t('Software'), e.software, 'wrap'],
  ];
  $('#kvExif').innerHTML = kv(rows);
}

function updateStatus() {
  const m = state.meta;
  if (!m) {
    $('#sbFile').textContent = t('No file opened');
    return;
  }
  const pos = `${state.index + 1} / ${state.files.length}`;
  const box = m.cadBox;
  const unitTxt = m.cadUnit ? ' ' + m.cadUnit : '';
  const dim = box
    ? `${fmtUnit(box.maxX - box.minX)}×${fmtUnit(box.maxY - box.minY)}${unitTxt}`
    : (m.width && m.height ? m.width + '×' + m.height : '—');
  $('#sbFile').textContent = `${m.name}　·　${dim}　·　${fmtSize(m.size)}　·　${pos}`;
  $('#navCount').textContent = pos;
  // 左下角「尺寸」小药丸同步成图纸单位
  $('#dimPill').textContent = dim;
  if (m.size) $('#sizePill').textContent = fmtSize(m.size);
}

// ------------------------------------------------------------------ 胶片条
// 矢量缩略图：首次请求时 SVG 往往还没转好（404 灰块）。主进程收到请求会顺手起
// 后台转换，这里隔几秒重试几次 —— 让「预览」和「打开」显示同一份内容。
function attachVectorThumbRetry(img, f, w) {
  if (!VECTOR_EXT.has(String(f.ext || '').toLowerCase())) return;
  const delays = [1500, 3500, 7000];
  let tries = 0;
  img.addEventListener('error', () => {
    if (tries >= delays.length) return;
    const delay = delays[tries++];
    setTimeout(() => {
      img.src = R.thumbUrl(f.path, w) + '&retry=' + tries;
    }, delay);
  });
}

// 胶片条窗口：大文件夹只渲染当前附近的 60 个，避免一次性创建上千个 DOM。
// 之前每按一次方向键都整块重建（60 个 div + 60 个 img 全部重新请求），
// 连翻时肉眼可见地卡。现在只有「选中项跑出已渲染范围的内圈」才换窗口，
// 其余情况只切换 .on 类名。
const FILM_WIN = 60;
const FILM_MARGIN = 8;
let filmRange = { total: -1, start: 0, end: 0 };
let filmSignature = '';

function filmWindow(total) {
  if (total <= FILM_WIN) return { start: 0, end: total };
  const inRange = filmRange.total === total
    && state.index >= filmRange.start + FILM_MARGIN
    && state.index <= filmRange.end - FILM_MARGIN;
  if (inRange) return { start: filmRange.start, end: filmRange.end };
  const start = clamp(state.index - FILM_WIN / 2, 0, total - FILM_WIN);
  return { start, end: start + FILM_WIN };
}

function renderFilm() {
  const box = $('#filmstrip');
  const total = state.files.length;
  const { start, end } = filmWindow(total);

  // 签名里带首个文件路径：换了文件夹但张数恰好相同时也要重建
  const sig = total + '|' + start + '|' + end + '|' + (total ? state.files[0].path : '');

  if (sig !== filmSignature) {
    box.innerHTML = '';
    for (let i = start; i < end; i++) {
      const f = state.files[i];
      const el = document.createElement('div');
      el.className = 'thumb' + (i === state.index ? ' on' : '');
      el.title = f.name;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      // 矢量图纸：完整显示(不裁切)，并允许转换完成后重试
      if (VECTOR_EXT.has(String(f.ext || '').toLowerCase())) img.className = 'fit';
      attachVectorThumbRetry(img, f, 220);
      img.src = R.thumbUrl(f.path, 220);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = f.name;
      el.append(img, nm);
      const b = badgeOf(f.ext);
      if (b) {
        const tag = document.createElement('span');
        tag.className = 'tag ' + b;
        tag.textContent = b === 'cdr' ? (CAD_EXT.has(f.ext) ? f.ext.slice(1).toUpperCase() : 'CDR')
          : (NATIVE_EXT.has(f.ext) ? '' : t('Preview'));
        if (tag.textContent) el.appendChild(tag);
      }
      el.addEventListener('click', () => select(i));
      box.appendChild(el);
    }
    filmSignature = sig;
  }

  filmRange = { total, start, end };

  const cells = box.children;
  for (let k = 0; k < cells.length; k++) {
    cells[k].classList.toggle('on', start + k === state.index);
  }
  const cur = box.querySelector('.thumb.on');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// ------------------------------------------------------------------ 管理（网格）
// 缩略图宽度按档位取整：滑块是连续值，若每次拖动都按新宽度取缩略图，
// 一个来回就会在主进程里重新解码几十遍整个文件夹（每档都是一次 cache miss）。
const GRID_THUMB_STEPS = [240, 320, 420, 560, 720, 900];
function gridThumbWidth(size) {
  const want = Math.max(240, size * 2);
  return GRID_THUMB_STEPS.find((s) => s >= want) || GRID_THUMB_STEPS[GRID_THUMB_STEPS.length - 1];
}

// 上次渲染的依据（文件夹列表引用 / 过滤词 / 缩略图档位）。
// 三者都没变时只更新选中态，不再重建上千个节点 —— 每次切到管理屏都重建
// 大文件夹要卡一百多毫秒。
let gridCache = { files: null, q: '', tw: 0, count: '' };

function renderGrid() {
  const g = $('#grid');
  const size = +$('#mgSize').value;
  g.style.setProperty('--cell', size + 'px');
  const q = ($('#mgFilter').value || '').trim().toLowerCase();
  const tw = gridThumbWidth(size);

  if (!state.files.length) {
    g.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'grid-empty';
    d.textContent = t('No folder loaded — click “Open folder” above, or drag a folder into the window');
    g.appendChild(d);
    $('#mgCount').textContent = '0' + t(' items');
    gridCache = { files: null, q, tw, count: '0' + t(' items') };
    return;
  }

  const unchanged = gridCache.files === state.files && gridCache.q === q && gridCache.tw === tw;

  if (!unchanged) {
    // 按文件名过滤（大文件夹里也能快速定位）
    let shown = 0;
    const frag = document.createDocumentFragment();
    state.files.forEach((f, realIdx) => {
      if (q && !String(f.name || '').toLowerCase().includes(q)) return;
      shown++;
      const cell = document.createElement('div');
      cell.className = 'cell' + (realIdx === state.index ? ' on' : '');
      cell.dataset.i = String(realIdx);
      const pv = document.createElement('div');
      pv.className = 'pv';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      if (VECTOR_EXT.has(String(f.ext || '').toLowerCase())) img.className = 'fit';
      attachVectorThumbRetry(img, f, tw);
      img.src = R.thumbUrl(f.path, tw);
      img.alt = f.name;
      pv.appendChild(img);
      const b = badgeOf(f.ext);
      if (b) {
        const bd = document.createElement('span');
        bd.className = 'badge ' + b;
        bd.textContent = b === 'cdr' ? (CAD_EXT.has(f.ext) ? f.ext.slice(1).toUpperCase() : 'CDR')
          : (NATIVE_EXT.has(f.ext) ? f.ext.slice(1).toUpperCase() : t('Preview'));
        pv.appendChild(bd);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<div class="ttl"></div><div class="sub"><span></span><span></span></div>`;
      meta.querySelector('.ttl').textContent = f.name;
      meta.querySelector('.sub span:first-child').textContent = fmtSize(f.size);
      meta.querySelector('.sub span:last-child').textContent = fmtTime(f.mtime).slice(0, 10);
      cell.append(pv, meta);
      // 用真实索引，过滤后点击才不会选错文件
      cell.addEventListener('click', () => { select(realIdx); go('view'); });
      frag.appendChild(cell);
    });
    g.innerHTML = '';
    g.appendChild(frag);
    gridCache = { files: state.files, q, tw, count: (q ? shown + t(' / ') : '') + state.files.length + t(' items') };
  } else {
    for (const el of g.children) {
      el.classList.toggle('on', +el.dataset.i === state.index);
    }
  }
  $('#mgCount').textContent = gridCache.count;
}

// 最近打开的文件夹：从设置读取，点一下直接载入（持久化在 userData）
async function renderRecent() {
  const box = $('#mgRecent');
  if (!box) return;
  let recent = [];
  try { recent = await R.recentFolders(); } catch { recent = []; }
  if (!recent.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = '<span class="lbl">' + t('Recent: ') + '</span>';
  recent.forEach((f) => {
    const chip = document.createElement('button');
    chip.className = 'recent-chip';
    chip.textContent = basename(f) || f;
    chip.title = f;
    chip.addEventListener('click', () => openPaths([f]));
    box.appendChild(chip);
  });
}

// ------------------------------------------------------------------ 对比
// 对比屏的下拉选项：每个文件一条 <option>，5000 张就是 1 万个节点。
// 之前每次切到对比屏都重建一遍，现在只在文件列表真的换了（数组换了引用）时重建。
let cmpCache = { files: null, html: '' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function initCompare() {
  const a = $('#cmpA');
  const b = $('#cmpB');
  if (cmpCache.files !== state.files) {
    const opts = state.files.map((f, i) => `<option value="${i}">${escapeHtml(f.name)}</option>`).join('');
    a.innerHTML = opts;
    b.innerHTML = opts;
    cmpCache = { files: state.files, html: opts };
  }
  if (state.files.length > 1) {
    a.value = String(state.index >= 0 ? state.index : 0);
    b.value = String((state.index + 1) % state.files.length);
  }
  syncCompare();
}

function syncCompare() {
  const a = state.files[+$('#cmpA').value];
  const b = state.files[+$('#cmpB').value];
  if (a) {
    $('#cmpImgA').src = R.imageUrl(a.path);
    $('#cmpLabelA').textContent = a.name;
  }
  if (b) {
    $('#cmpImgB').src = R.imageUrl(b.path);
    $('#cmpLabelB').textContent = b.name;
  }
}

// ------------------------------------------------------------------ 批量
function addBatch(files) {
  const list = files || state.files;
  state.batch = list.slice();
  renderBatchRows();
}

function renderBatchRows() {
  const box = $('#bRows');
  box.innerHTML = '';
  if (!state.batch.length) {
    const d = document.createElement('div');
    d.className = 'grid-empty';
    d.textContent = t('No files loaded — open a folder first, or click “Load from current folder” below');
    box.appendChild(d);
    $('#bSummary').textContent = '—';
    return;
  }
  state.batch.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'brow';
    row.dataset.i = String(i);
    row.innerHTML = `<span class="f"></span>
      <span class="pbar"><i></i></span>
      <span class="st"></span>
      <span class="o"></span>`;
    row.querySelector('.f').textContent = f.name;
    row.querySelector('.f').title = f.path;
    row.querySelector('.st').textContent = t('Waiting');
    box.appendChild(row);
  });
  const total = state.batch.length;
  const bytes = state.batch.reduce((s, f) => s + (f.size || 0), 0);
  $('#bSummary').textContent = t('Total {n} files · {size}', { n: total, size: fmtSize(bytes) });
}

function setRow(i, pct, stateText, out, cls) {
  const row = $(`.brow[data-i="${i}"]`);
  if (!row) return;
  const bar = row.querySelector('.pbar > i');
  bar.style.width = pct + '%';
  bar.className = cls || '';
  const st = row.querySelector('.st');
  st.textContent = stateText;
  st.className = 'st ' + (cls || '');
  if (out !== undefined) {
    const o = row.querySelector('.o');
    o.textContent = out;
    o.title = out;
  }
}

async function runBatch() {
  if (state.running) return;
  if (!state.batch.length) {
    toast(t('Batch list is empty'), true);
    return;
  }
  if (!state.outDir) {
    state.outDir = (state.folder || dirname(state.batch[0].path)) + '\\RatViewer导出';
    $('#bOutDir').textContent = state.outDir;
  }
  const type = $('#bFormat').value;
  const quality = +$('#bQuality').value / 100;
  const maxEdge = +$('#bMaxEdge').value || 0;
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const outExt = extMap[type] || 'jpg';

  // 预筛：矢量格式（CDR/CMX/DWG/DXF）读不到像素，批量转换对它们没有意义，直接排除
  const jobs = state.batch
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !VECTOR_EXT.has(String(f.ext || '').toLowerCase()));
  const skipped = state.batch.length - jobs.length;

  state.running = true;
  $('#bRun').disabled = true;
  let okCount = 0;
  let errCount = 0;
  const usedNames = new Set();

  // 4 路并发，进度仍逐行刷新（避免大目录串行时一次等很久）
  const CONC = 4;
  const worker = async (start) => {
    for (let k = start; k < jobs.length; k += CONC) {
      const { f, i } = jobs[k];
      setRow(i, 8, t('Reading…'), '', 'run');
      try {
        const d = await getDrawable(f.path);
        if (!d) throw new Error(t('Cannot read pixels'));
        setRow(i, 34, t('Encoding…'), '');

        let w = d.w;
        let h = d.h;
        if (maxEdge > 0 && Math.max(w, h) > maxEdge) {
          const kk = maxEdge / Math.max(w, h);
          w = Math.max(1, Math.round(w * kk));
          h = Math.max(1, Math.round(h * kk));
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (type === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(d.img, 0, 0, w, h);

        const blob = await new Promise((res) => c.toBlob(res, type, quality));
        if (!blob) throw new Error(t('Encode failed'));
        const buf = await blob.arrayBuffer();
        setRow(i, 76, t('Writing…'), '');

        // 输出名去重：a.PSD 与 a.png 同名都转 jpg 会互相覆盖，碰撞时加序号
        const stem = basename(f.path).replace(/\.[^.]+$/, '');
        let name = stem + '.' + outExt;
        if (usedNames.has(name)) {
          let n = 2;
          while (usedNames.has(stem + '_' + n + '.' + outExt)) n++;
          name = stem + '_' + n + '.' + outExt;
        }
        usedNames.add(name);
        const target = state.outDir + '\\' + name;
        const wr = await R.writeFile(target, buf);
        if (!wr.ok) throw new Error(wr.error || t('Write failed'));
        okCount++;
        setRow(i, 100, t('Done'), fmtSize(wr.bytes), 'done');
      } catch (e) {
        errCount++;
        setRow(i, 100, t('Failed'), String(e.message || e), 'err');
      }
    }
  };

  const runners = [];
  for (let s = 0; s < CONC; s++) runners.push(worker(s));
  await Promise.all(runners);

  state.running = false;
  $('#bRun').disabled = false;
  const tail = skipped ? t('Skipped {n} vector files', { n: skipped }) : '';
  setOp(t('Batch conversion complete: {ok} succeeded, {err} failed{extra} → {dir}', { ok: okCount, err: errCount, extra: tail, dir: state.outDir }));
  toast(t('Batch done: {ok} succeeded{extra}', { ok: okCount, extra: errCount ? t(', {n} failed', { n: errCount }) : '' }), errCount > 0);
}

// ------------------------------------------------------------------ 裁剪
// 裁剪框一律用「图像像素坐标」存储，渲染时再换算成视口坐标 ——
// 这样缩放、适应窗口之后框都不会跑偏。
function enterCrop() {
  const m = state.meta;
  if (!m) {
    toast(t('Open an image first'), true);
    return;
  }
  // 矢量文件在 SVG 就绪前宽高是 0（CDR 无内嵌预览 / DWG / DXF），裁剪框会退化成 0×0
  if (!m.width || !m.height) {
    toast(t('Vector content still rendering, crop after it appears'), true);
    return;
  }
  if (state.view.rot % 360 !== 0 || state.view.sx !== 1 || state.view.sy !== 1) {
    state.view.rot = 0;
    state.view.sx = 1;
    state.view.sy = 1;
    fit();
    toast(t('Rotation/flip reset for cropping by original coordinates'));
  }
  state.crop.on = true;
  state.crop.rect = { x: m.width * 0.18, y: m.height * 0.18, w: m.width * 0.64, h: m.height * 0.64 };
  $('#cropBox').classList.add('show');
  $('#ratioRow').classList.remove('off');
  $('#btnCrop').classList.add('on');
  drawCrop();
  setOp(t('Crop mode: drag box or corners, Enter to apply, Esc to cancel'));
}

function exitCrop(silent) {
  if (!state.crop.on) return;
  state.crop.on = false;
  state.crop.rect = null;
  $('#cropBox').classList.remove('show');
  $('#ratioRow').classList.add('off');
  $('#btnCrop').classList.remove('on');
  if (!silent) setOp(t('Crop exited'));
}

function imageRect() {
  const { w: vw, h: vh } = vpSize();
  const m = state.meta;
  const dw = m.width * state.view.z;
  const dh = m.height * state.view.z;
  const cx = vw / 2 + state.view.tx;
  const cy = vh / 2 + state.view.ty;
  return { left: cx - dw / 2, top: cy - dh / 2, w: dw, h: dh, vw, vh };
}

function drawCrop() {
  const r = state.crop.rect;
  const m = state.meta;
  if (!r || !m) return;
  const img = imageRect();
  const z = state.view.z;
  const el = $('#cropBox');
  el.style.inset = 'auto';
  el.style.left = (img.left + r.x * z) + 'px';
  el.style.top = (img.top + r.y * z) + 'px';
  el.style.width = (r.w * z) + 'px';
  el.style.height = (r.h * z) + 'px';
  const pct = Math.round((r.w / m.width) * 100);
  $('#cropSize').textContent = t('{w} × {h} px · {pct}% of original', { w: Math.round(r.w), h: Math.round(r.h), pct });
}

function cropAspect(r) {
  const m = state.meta;
  if (r === 'orig') return m.width / m.height;
  const [a, b] = r.split(':').map(Number);
  return a / b;
}

function setCropRatio(r) {
  state.crop.ratio = r;
  $$('#ratioRow button[data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === r));
  if (r === 'free' || !state.crop.rect) {
    drawCrop();
    return;
  }
  const m = state.meta;
  const ar = cropAspect(r);
  const cur = state.crop.rect;
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  let w = cur.w;
  let h = w / ar;
  if (h > m.height) {
    h = m.height;
    w = h * ar;
  }
  if (w > m.width) {
    w = m.width;
    h = w / ar;
  }
  state.crop.rect = {
    x: clamp(cx - w / 2, 0, m.width - w),
    y: clamp(cy - h / 2, 0, m.height - h),
    w,
    h,
  };
  drawCrop();
}

async function applyCrop() {
  const m = state.meta;
  const r = state.crop.rect;
  if (!m || !r) return;
  const sx = clamp(Math.round(r.x), 0, m.width - 1);
  const sy = clamp(Math.round(r.y), 0, m.height - 1);
  const sw = clamp(Math.round(r.w), 1, m.width - sx);
  const sh = clamp(Math.round(r.h), 1, m.height - sy);
  if (sw < 4 || sh < 4) {
    toast(t('Crop area too small'), true);
    return;
  }
  const d = await getDrawable(m.path);
  if (!d) {
    toast(t('Cannot read pixels, cannot crop'), true);
    return;
  }
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d').drawImage(d.img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) {
    toast(t('Crop failed'), true);
    return;
  }
  const base = basename(m.path).replace(/\.[^.]+$/, '');
  const target = await R.saveAs(dirname(m.path) + '\\' + base + '_裁剪.png', [
    { name: 'PNG', extensions: ['png'] },
    { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  ]);
  if (!target) return;
  const wr = await R.writeFile(target, await blob.arrayBuffer());
  if (wr.ok) {
    toast(t('Cropped to {sw}×{sh} and saved', { sw, sh }));
    setOp(t('Crop saved: {path}', { path: target }));
    exitCrop(true);
  } else {
    toast(t('Save failed: {err}', { err: wr.error || '' }), true);
  }
}

// ------------------------------------------------------------------ 放大镜
function stopLens() {
  state.lens = false;
  $('#viewLens').classList.remove('show');
  $('#btnLens').classList.remove('on');
  $('#stage').classList.remove('lens-off');
  $('#cadStage').classList.remove('lens-off');
}

function toggleLens() {
  if (!state.meta) return;
  state.lens = !state.lens;
  $('#viewLens').classList.toggle('show', state.lens);
  $('#btnLens').classList.toggle('on', state.lens);
  $('#stage').classList.toggle('lens-off', state.lens);
  $('#cadStage').classList.toggle('lens-off', state.lens);
  setOp(state.lens ? t('Magnifier on (move mouse to view, L to close)') : t('Magnifier off'));
}

let lensImgUrl = '';

function moveLens(cx, cy) {
  if (!state.lens) return;
  const m = state.meta;
  if (!m) return;
  const lens = $('#viewLens');
  const size = 168;
  const zoom = 2.2;
  const img = imageRect();
  // 光标在图片坐标系中的位置
  const ix = (cx - img.left) / state.view.z;
  const iy = (cy - img.top) / state.view.z;
  lens.style.left = (cx - size / 2) + 'px';
  lens.style.top = (cy - size / 2) + 'px';
  const url = R.imageUrl(m.path);
  if (url !== lensImgUrl) {
    lens.style.backgroundImage = `url("${url}")`;
    lensImgUrl = url;
  }
  lens.style.backgroundSize = `${m.width * state.view.z * zoom}px ${m.height * state.view.z * zoom}px`;
  lens.style.backgroundPosition = `${-ix * state.view.z * zoom + size / 2}px ${-iy * state.view.z * zoom + size / 2}px`;
}

// ------------------------------------------------------------------ 幻灯片
function togglePlay() {
  if (!state.files.length) return;
  state.playing = !state.playing;
  $('#viewport').classList.toggle('playing', state.playing);
  $('#btnSlides').classList.toggle('on', state.playing);
  clearInterval(state.timer);
  if (state.playing) {
    state.timer = setInterval(next, state.slideshowInterval || 2600);
    setOp(t('Slideshow playing (Space or Esc to exit)'));
  } else {
    setOp(t('Slideshow exited'));
  }
}

// ------------------------------------------------------------------ 右键菜单
// 第一个元素改为 i18n key（英文），由 showCtx 用 t() 翻译。
const MENU = [
  ['Fit window', 'i-fit', 'F', () => fit()],
  ['Actual pixels', 'i-one', 'Ctrl+1', () => oneToOne()],
  ['Zoom in', 'i-plus', '+', () => zoomAt(1.2)],
  ['Zoom out', 'i-minus', '-', () => zoomAt(1 / 1.2)],
  ['sep'],
  ['Rotate left 90°', 'i-ccw', ',', () => rotate(-90)],
  ['Rotate right 90°', 'i-cw', '.', () => rotate(90)],
  ['Flip horizontal', 'i-fliph', 'H', () => flip('h')],
  ['Flip vertical', 'i-flipv', 'V', () => flip('v')],
  ['sep'],
  ['Crop', 'i-crop', 'C', () => enterCrop()],
  ['Magnifier', 'i-lens', 'L', () => toggleLens()],
  ['Auto enhance', 'i-wand', '', () => autoEnhance()],
  ['Reset adjust', 'i-reset', '', () => resetAdjust()],
  ['sep'],
  ['Save as…', 'i-save', 'Ctrl+S', () => saveAsCurrent()],
  ['Copy image', 'i-copy', '', () => copyImage()],
  ['Copy file path', 'i-copy', '', () => copyPath()],
  ['Show in Explorer', 'i-folder', '', () => revealCurrent()],
  ['sep'],
  ['Slideshow', 'i-slides', 'Space', () => togglePlay()],
  ['Delete to Recycle Bin', 'i-trash', 'Del', () => trashCurrent(), 'danger'],
];

function showCtx(x, y) {
  const el = $('#ctxMenu');
  el.innerHTML = '';
  MENU.forEach((it) => {
    if (it[0] === 'sep') {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      el.appendChild(s);
      return;
    }
    const [mkey, icon, hot, fn, cls] = it;
    const d = document.createElement('div');
    d.className = 'ctx-item' + (cls ? ' ' + cls : '') + (state.meta ? '' : ' disabled');
    d.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg><span>${t(mkey)}</span>`
      + (hot ? `<span class="k">${hot}</span>` : '');
    d.addEventListener('click', () => {
      hideCtx();
      if (state.meta || mkey === 'Slideshow') fn();
    });
    el.appendChild(d);
  });
  el.classList.add('show');
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
}

function hideCtx() {
  $('#ctxMenu').classList.remove('show');
}

// ------------------------------------------------------------------ 文件操作
async function saveAsCurrent() {
  const m = state.meta;
  if (!m) return;
  const d = await getDrawable(m.path);
  if (!d) {
    toast(t('This format has no exportable pixels'), true);
    return;
  }
  const c = document.createElement('canvas');
  c.width = d.w;
  c.height = d.h;
  const ctx = c.getContext('2d');
  ctx.drawImage(d.img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const base = basename(m.path).replace(/\.[^.]+$/, '');
  const target = await R.saveAs(dirname(m.path) + '\\' + base + '.png', [
    { name: 'PNG', extensions: ['png'] },
    { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
    { name: 'WebP', extensions: ['webp'] },
  ]);
  if (!target) return;
  const wr = await R.writeFile(target, await blob.arrayBuffer());
  toast(wr.ok ? t('Saved as {name}', { name: basename(target) }) : t('Save failed'), !wr.ok);
  if (wr.ok) setOp(t('Saved as {name}', { name: target }));
}

async function copyPath() {
  if (!state.meta) return;
  try {
    await navigator.clipboard.writeText(state.meta.path);
    toast(t('Path copied'));
  } catch {
    toast(t('Copy failed'), true);
  }
}

// 复制图片本身到剪贴板（不只是路径）。矢量 SVG 可能无法回读到 canvas，会提示失败。
async function copyImage() {
  if (!state.meta) return;
  const d = await getDrawable(state.meta.path);
  if (!d) {
    toast(t('This format has no exportable pixels'), true);
    return;
  }
  try {
    const c = document.createElement('canvas');
    c.width = d.w;
    c.height = d.h;
    c.getContext('2d').drawImage(d.img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error(t('Encode failed'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(t('Image copied to clipboard'));
    setOp(t('Image copied to clipboard'));
  } catch {
    toast(t('Copy failed (format or environment not supported)'), true);
  }
}

function revealCurrent() {
  if (state.meta) R.reveal(state.meta.path);
}

async function trashCurrent() {
  const m = state.meta;
  if (!m) return;
  const r = await R.trash(m.path);
  if (!r.ok) {
    toast(t('Delete failed: {err}', { err: r.error || '' }), true);
    return;
  }
  toast(t('Moved to Recycle Bin'));
  setOp(t('Deleted (moved to Recycle Bin): {name}', { name: m.name }));
  const wasIndex = state.index;
  state.files = state.files.filter((f) => !samePath(f.path, m.path));
  state.tabs = state.tabs.filter((t) => !samePath(t, m.path));
  // 同步把文件夹缓存里的同一条剔掉，否则切换到别的标签再回来时，
  // 已经删掉的文件会「复活」（缓存里还是删之前那份列表）
  const cached = folderCache.get(state.folder);
  if (cached) cached.files = cached.files.filter((f) => !samePath(f.path, m.path));
  renderFilm();
  renderGrid();
  if (!state.files.length) {
    state.meta = null;
    state.index = -1;
    renderEmpty();
    renderTabs();
    updateStatus();
  } else {
    select(clamp(wasIndex, 0, state.files.length - 1));
  }
}

// ------------------------------------------------------------------ 设置页
// 第三个元素（说明）与快捷键说明都改用英文 key，渲染时由 t() 翻译。
const FMT_TABLE = [
  ['JPG / JPEG', 'native', 'Built-in · Chromium decode'],
  ['PNG / APNG', 'native', 'Built-in · transparent'],
  ['WebP', 'native', 'Built-in · animated'],
  ['GIF', 'native', 'Built-in · animated'],
  ['BMP', 'native', 'Built-in'],
  ['ICO', 'native', 'Built-in'],
  ['SVG', 'native', 'Built-in · vector'],
  ['AVIF', 'native', 'Built-in'],
  ['TIFF / TIF', 'preview', 'Extract embedded preview'],
  ['PSD / PSB', 'preview', 'Read thumbnail resource'],
  ['CDR / CMX', 'preview', 'Extract embedded preview + libcdr full vector render'],
  ['DWG / DXF', 'cad', 'LibreDWG vector parse (Rat CAD Viewer engine)'],
  ['HEIC / HEIF', 'preview', 'Extract embedded JPEG preview'],
  ['CR2 / CR3 / NEF / ARW / DNG 等 RAW', 'preview', 'Extract embedded JPEG preview'],
  ['PDF / AI / EPS / EXR / TGA / JXL', 'no', 'Not supported (excluded from list)'],
];

const KEYS = [
  ['← / →', 'Prev / next'],
  ['Space', 'Slideshow on/off'],
  ['+ / -', 'Zoom in / out'],
  ['F', 'Fit window'],
  ['Ctrl+1', 'Actual pixels'],
  ['C', 'Crop mode'],
  ['Enter', 'Apply crop'],
  ['Esc', 'Exit crop / slideshow'],
  ['1 / 2 / 3 / 4', 'Switch screen (View / Manage / Compare / Batch)'],
  ['L', 'Magnifier'],
  [', / .', 'Rotate left / right 90°'],
  ['H / V', 'Flip horizontal / vertical'],
  ['Del', 'Delete to Recycle Bin'],
  ['Ctrl+O', 'Open image'],
  ['Ctrl+S', 'Save as'],
  ['Ctrl+D', 'Toggle theme'],
  ['Ctrl+滚轮', 'Zoom (Ctrl+wheel)'],
];

function renderSettings() {
  $('#fmtList').innerHTML = FMT_TABLE.map(([name, kind, note]) => {
    const cls = kind === 'native' ? '' : (kind === 'preview' || kind === 'cad') ? 'pv' : 'no';
    return `<span class="fmt ${cls}" title="${t(note)}"><i></i>${name}</span>`;
  }).join('');

  $('#keyList').innerHTML = KEYS.map(([k, d]) =>
    `<div class="keyrow"><span class="kbd">${k}</span><span>${t(d)}</span></div>`).join('');

  $('#aboutInfo').innerHTML = kv([
    [t('App version'), 'V' + (R.appVersion || '1.0.0')],
    ['Electron', R.versions.electron],
    ['Chromium', R.versions.chrome],
    ['Node', R.versions.node],
    [t('Platform'), R.platform],
  ], 'kv-line');
}

async function refreshAssoc() {
  const s = await R.assocStatus();
  $('#assocInfo').innerHTML = kv([
    [t('Current status'), s.registered ? t('Registered as candidate') : t('Not registered')],
    [t('Program file'), s.exeName, 'wrap mono'],
    [t('Full path'), s.exe, 'wrap mono'],
    [t('Associated extensions'), (s.extensions || []).length],
  ]);
  return s;
}

// ------------------------------------------------------------------ 事件绑定
function bind() {
  // 窗口
  $('#btnMin').addEventListener('click', () => R.winMinimize());
  $('#btnMax').addEventListener('click', () => R.winToggleMax());
  $('#btnClose').addEventListener('click', () => R.winClose());
  R.onWinState((s) => {
    $('#btnMax').innerHTML = `<svg class="ic"><use href="#i-${s.maximized ? 'restore' : 'max'}"/></svg>`;
  });

  // 导航
  $$('.rail-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  // 打开
  const doOpen = async () => {
    const paths = await R.openFiles();
    if (paths && paths.length) openPaths(paths);
  };
  $('#btnOpen').addEventListener('click', doOpen);
  $('#btnAddTab').addEventListener('click', doOpen);
  $('#btnFolder').addEventListener('click', async () => {
    const d = await R.openFolder();
    if (d) openPaths([d]);
  });
  $('#btnFolder2').addEventListener('click', async () => {
    const d = await R.openFolder();
    if (d) openPaths([d]);
  });
  $('#btnCmpPick').addEventListener('click', async () => {
    const d = await R.openFolder();
    if (d) {
      await openPaths([d]);
      initCompare();
      toast(t('Loaded this folder in compare screen'));
    }
  });

  // 翻页
  $('#btnPrev').addEventListener('click', prev);
  $('#btnNext').addEventListener('click', next);
  $('#arrowPrev').addEventListener('click', prev);
  $('#arrowNext').addEventListener('click', next);

  // 缩放
  $('#btnZoomIn').addEventListener('click', () => zoomAt(1.2));
  $('#btnZoomOut').addEventListener('click', () => zoomAt(1 / 1.2));
  $('#btnFit').addEventListener('click', () => fit());
  $('#btnOne').addEventListener('click', () => oneToOne());
  $('#viewport').addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = $('#viewport').getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // 平移
  const vp = $('#viewport');
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let panRaf = 0;
  vp.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || state.crop.on || state.lens) return;
    // CAD 的「测量」「窗口放大」要吃掉这次按下，否则会变成平移
    if (state.cad.on && (state.cad.mode === 'measure' || state.cad.mode === 'win')) {
      const r = vp.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      if (state.cad.mode === 'measure') measureClick(cx, cy);
      else winZoomStart(cx, cy);
      e.preventDefault();
      return;
    }
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    vp.classList.add('grabbing');
  });
  window.addEventListener('mousemove', (e) => {
    // 只有开着放大镜时才需要量视口。原来无条件 getBoundingClientRect()，
    // 等于每次鼠标移动都强制同步布局一次 —— 高回报率鼠标下这是纯浪费。
    const needRect = state.lens || state.cad.on;
    let rect = null;
    if (needRect) rect = vp.getBoundingClientRect();
    if (state.lens) moveLens(e.clientX - rect.left, e.clientY - rect.top);
    if (state.cad.on) {
      updateCoord(e.clientX - rect.left, e.clientY - rect.top);
      if (state.cad.win) winZoomMove(e.clientX - rect.left, e.clientY - rect.top);
    }
    if (!dragging) return;
    state.view.tx += e.clientX - lastX;
    state.view.ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    // 合并到下一帧：1000Hz 的鼠标一秒能发上千次事件，逐次写 transform 会掉帧
    if (!panRaf) {
      panRaf = requestAnimationFrame(() => { panRaf = 0; updateStage(); });
    }
  });
  window.addEventListener('mouseup', () => {
    if (state.cad.win) winZoomEnd();
    dragging = false;
    vp.classList.remove('grabbing');
    if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; updateStage(); }
  });
  vp.addEventListener('dblclick', () => {
    // 图纸没有「1:1 像素」的概念，双击统一回适应
    if (state.cad.on) { fit(); return; }
    if (Math.abs(state.view.z - 1) < 0.02) fit();
    else oneToOne();
  });

  // 变换
  $('#btnRotL').addEventListener('click', () => rotate(-90));
  $('#btnRotR').addEventListener('click', () => rotate(90));
  $('#btnFlipH').addEventListener('click', () => flip('h'));
  $('#btnFlipV').addEventListener('click', () => flip('v'));

  // 裁剪
  $('#btnCrop').addEventListener('click', () => (state.crop.on ? exitCrop() : enterCrop()));
  $('#cropCancel').addEventListener('click', () => exitCrop());
  $('#cropApply').addEventListener('click', applyCrop);
  $$('#ratioRow button[data-r]').forEach((b) =>
    b.addEventListener('click', () => setCropRatio(b.dataset.r)));
  setupCropDrag();

  // 放大镜
  $('#btnLens').addEventListener('click', toggleLens);

  // CAD 专属：窗口放大 / 测量 / 图层
  $('#btnCadWin').addEventListener('click', toggleWinZoom);
  $('#btnMeasure').addEventListener('click', toggleMeasure);
  $('#cadAllOn').addEventListener('click', () => allLayers(true));
  $('#cadAllOff').addEventListener('click', () => allLayers(false));

  // CDR/CMX 多页翻页
  $('#pagePrev').addEventListener('click', () => gotoPage(-1));
  $('#pageNext').addEventListener('click', () => gotoPage(1));

  // 调整
  ['#adjBright', '#adjContrast', '#adjSat'].forEach((id) =>
    $(id).addEventListener('input', applyAdjust));
  $('#btnReset').addEventListener('click', resetAdjust);
  $('#btnReset2').addEventListener('click', resetAdjust);
  $('#btnWand').addEventListener('click', autoEnhance);

  // 其它
  $('#btnSlides').addEventListener('click', togglePlay);
  $('#btnSave').addEventListener('click', saveAsCurrent);
  $('#btnTrash').addEventListener('click', trashCurrent);
  $('#btnMore').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showCtx(r.left, r.bottom + 6);
  });

  // 右键
  vp.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY);
  });
  window.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#ctxMenu')) hideCtx();
  });

  // 主题
  $('#btnTheme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    setTheme(dark ? 'light' : 'dark');
  });
  $$('#segTheme button').forEach((b) =>
    b.addEventListener('click', () => setTheme(b.dataset.mode)));

  // 管理屏：格子尺寸即时跟手，只有缩略图档位真的变了才重建（否则拖一次滑块
  // 会把整个文件夹的缩略图重新解码十几遍）
  let gridTimer = null;
  $('#mgSize').addEventListener('input', () => {
    const size = +$('#mgSize').value;
    $('#grid').style.setProperty('--cell', size + 'px');
    if (gridThumbWidth(size) === gridCache.tw) return;
    clearTimeout(gridTimer);
    gridTimer = setTimeout(renderGrid, 140);
  });

  // 对比屏
  $('#cmpA').addEventListener('change', syncCompare);
  $('#cmpB').addEventListener('change', syncCompare);
  const split = $('#cmpSplit');
  const applySplit = () => {
    const v = split.value + '%';
    $('#cmpPaneB').style.setProperty('--split', v);
    $('#cmpHandle').style.setProperty('--split', v);
  };
  split.addEventListener('input', applySplit);
  applySplit();
  let splitDrag = false;
  $('#cmpHandle').addEventListener('mousedown', () => { splitDrag = true; });
  window.addEventListener('mousemove', (e) => {
    if (!splitDrag) return;
    const r = $('#cmpWrap').getBoundingClientRect();
    const pct = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
    split.value = String(Math.round(pct));
    applySplit();
  });
  window.addEventListener('mouseup', () => { splitDrag = false; });

  // 批量屏
  $('#bQuality').addEventListener('input', () => {
    $('#bQualityV').textContent = $('#bQuality').value;
  });
  $('#bPickOut').addEventListener('click', async () => {
    const d = await R.openFolder();
    if (d) {
      state.outDir = d;
      $('#bOutDir').textContent = d;
    }
  });
  $('#bRun').addEventListener('click', runBatch);
  $('#bClear').addEventListener('click', () => {
    state.batch = [];
    renderBatchRows();
  });

  // 设置屏
  $('#btnAssoc').addEventListener('click', async () => {
    const r = await R.assocRegister();
    if (r.ok) {
      await refreshAssoc();
      toast(t('Registered as candidate viewer ({n} extensions)', { n: r.extensions }));
      $('#assocHint').textContent = t('Next step: click ② open the system Default Apps page and assign extensions to RatViewer one by one.');
    } else {
      toast(t('Register failed: {err}', { err: r.error || '' }), true);
    }
  });
  $('#btnAssocOpen').addEventListener('click', async () => {
    const r = await R.assocOpenSettings();
    if (r.ok) {
      toast(t('Opened system “Default Apps” page'));
      $('#assocHint').textContent = t('In the list find RatViewer and assign .jpg/.png etc. to it one by one.');
    } else {
      toast(t('Cannot open system settings, search “Default apps” manually'), true);
    }
  });
  $('#btnAssocOff').addEventListener('click', async () => {
    await R.assocUnregister();
    await refreshAssoc();
    toast(t('Unregistered file association'));
  });
  $('#btnRevealExe').addEventListener('click', () => R.revealExe());

  // 多语言：手动切换（1.0.5）
  const langSel = $('#langSelect');
  if (langSel) langSel.addEventListener('change', async () => {
    const v = langSel.value;
    try { await R.configSet({ language: v }); } catch {}
    const lang = window.RAT_I18N.ratResolveLang(v);
    window.RAT_I18N.setLang(lang);
    window.RAT_I18N.applyStaticI18n();
    renderSettings();
    refreshAssoc();
    updateStatus();
    if (state.meta) { renderInfo(state.meta); renderExif(state.meta.path); }
    else renderEmpty();
    renderGrid();
    renderBatchRows();
    if (!state.meta) setOp(t('Ready'));
  });

  // 拖拽
  const veil = $('#dropVeil');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    if (state.meta || dragDepth === 1) veil.classList.add('show');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) veil.classList.remove('show');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    veil.classList.remove('show');
    const paths = [];
    for (const f of e.dataTransfer.files) {
      const p = R.pathForFile(f);
      if (p) paths.push(p);
    }
    if (paths.length) openPaths(paths);
  });

  // 窗口尺寸变化（拖拽边缘 / 最大化 / 还原）后重新适应，否则图片会溢出或被留白
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.meta && state.meta.width && state.meta.height) fit();
    }, 120);
  });

  // 管理屏：文件名搜索框（输入即过滤，大文件夹也能快速定位）
  const mgf = $('#mgFilter');
  if (mgf) mgf.addEventListener('input', renderGrid);

  // 幻灯片间隔（设置里改，持久化）
  const si = $('#slideInterval');
  if (si) si.addEventListener('change', () => {
    state.slideshowInterval = +si.value || 2600;
    R.configSet({ slideshowInterval: state.slideshowInterval }).catch(() => {});
  });

  // 键盘
  window.addEventListener('keydown', onKey);

  // 主进程推来的打开请求（双击文件 / 第二实例）
  R.onOpenPath((p) => { if (p) openPaths([p]); });
  R.onSystemTheme((s) => {
    if (state.themeMode === 'system') applyThemeAttr(!!s.dark);
  });
}

function onKey(e) {
  if (e.target.matches('input, select, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btnOpen').click(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveAsCurrent(); return; }
  if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); $('#btnTheme').click(); return; }
  if (ctrl && e.key === '1') { e.preventDefault(); oneToOne(); return; }
  // 数字键 1–4 切换屏幕（看图 / 管理 / 对比 / 批量），与左侧导航一一对应
  if (!ctrl && e.key >= '1' && e.key <= '4') {
    e.preventDefault();
    go(['view', 'manage', 'compare', 'batch'][+e.key - 1]);
    return;
  }
  if (ctrl) return;

  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); prev(); break;
    case 'ArrowRight': e.preventDefault(); next(); break;
    case '+': case '=': e.preventDefault(); zoomAt(1.2); break;
    case '-': e.preventDefault(); zoomAt(1 / 1.2); break;
    case 'f': case 'F': fit(); break;
    case 'c': case 'C': if (state.cad.on) break; state.crop.on ? exitCrop() : enterCrop(); break;
    case 'l': case 'L': toggleLens(); break;
    case 'w': case 'W': if (!state.cad.on) break; e.preventDefault(); toggleWinZoom(); break;
    case 'm': case 'M': if (!state.cad.on) break; e.preventDefault(); toggleMeasure(); break;
    case 'h': case 'H': if (state.cad.on) break; flip('h'); break;
    case 'v': case 'V': if (state.cad.on) break; flip('v'); break;
    case ',': if (state.cad.on) break; rotate(-90); break;
    case '.': if (state.cad.on) break; rotate(90); break;
    case 'Delete': trashCurrent(); break;
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'Enter': if (state.crop.on) applyCrop(); break;
    case 'Escape':
      if (state.cad.measure || state.cad.mode === 'win') {
        state.cad.measure = null;
        state.cad.mode = null;
        $('#btnMeasure').classList.remove('on');
        $('#cadRubber').classList.remove('on');
        $('#btnCadWin').classList.remove('on');
        $('#viewport').classList.remove('cad-cross');
        state.cad.win = null;
        drawMeasure();
        setOp(t('Measure cleared'));
      } else if (state.crop.on) exitCrop();
      else if (state.lens) stopLens();
      else if (state.playing) togglePlay();
      else hideCtx();
      break;
    default: break;
  }
}

// ------------------------------------------------------------------ 裁剪框拖动
function setupCropDrag() {
  const box = $('#cropBox');
  let mode = null;
  let start = null;

  const onDown = (e, m) => {
    if (!state.crop.on || !state.crop.rect) return;
    e.preventDefault();
    e.stopPropagation();
    mode = m;
    start = { mx: e.clientX, my: e.clientY, rect: { ...state.crop.rect } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onMove = (e) => {
    if (!mode || !start) return;
    const m = state.meta;
    const z = state.view.z;
    // 鼠标位移换算到图像像素
    const dx = (e.clientX - start.mx) / z;
    const dy = (e.clientY - start.my) / z;
    const r = { ...start.rect };
    const minS = Math.max(8, 24 / z);

    if (mode === 'move') {
      r.x = clamp(start.rect.x + dx, 0, m.width - r.w);
      r.y = clamp(start.rect.y + dy, 0, m.height - r.h);
    } else {
      if (mode.includes('l')) {
        const nx = clamp(start.rect.x + dx, 0, start.rect.x + start.rect.w - minS);
        r.w = start.rect.w + (start.rect.x - nx);
        r.x = nx;
      }
      if (mode.includes('r')) {
        r.w = clamp(start.rect.w + dx, minS, m.width - start.rect.x);
      }
      if (mode.includes('t')) {
        const ny = clamp(start.rect.y + dy, 0, start.rect.y + start.rect.h - minS);
        r.h = start.rect.h + (start.rect.y - ny);
        r.y = ny;
      }
      if (mode.includes('b')) {
        r.h = clamp(start.rect.h + dy, minS, m.height - start.rect.y);
      }
      const ratio = state.crop.ratio;
      if (ratio !== 'free') {
        const ar = cropAspect(ratio);
        const draggingLeft = mode.includes('l');
        const draggingTop = mode.includes('t');
        // 以宽定高；超高则改以高定宽，并钉住被拖角的对角
        let nh = r.w / ar;
        if (r.y + nh <= m.height) {
          const bottom = r.y + r.h;
          r.h = nh;
          if (draggingTop) r.y = bottom - nh;
        } else {
          const nw = r.h * ar;
          const right = r.x + r.w;
          r.w = nw;
          if (draggingLeft) r.x = right - nw;
        }
      }
    }
    state.crop.rect = r;
    drawCrop();
  };

  const onUp = () => {
    mode = null;
    start = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  box.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('h')) return;
    onDown(e, 'move');
  });
  const cornerMap = { tl: 'lt', tr: 'rt', bl: 'lb', br: 'rb' };
  $$('#cropBox .h').forEach((h) => {
    const c = Array.from(h.classList).find((x) => cornerMap[x]);
    h.addEventListener('mousedown', (e) => onDown(e, cornerMap[c]));
  });
}

// ------------------------------------------------------------------ 启动
async function main() {
  // ---- 多语言初始化（1.0.5）：读配置 → 解析语言（auto 按时区）→ 应用 ----
  let cfg = null;
  try { cfg = await R.configGet() || {}; } catch {}
  try {
    const lang = window.RAT_I18N.ratResolveLang(cfg && cfg.language);
    window.RAT_I18N.setLang(lang);
    window.RAT_I18N.applyStaticI18n();
    const ls = $('#langSelect');
    if (ls) ls.value = (cfg && cfg.language) || 'auto';
  } catch {}

  renderSettings();
  bind();
  refreshAssoc();

  const themeCfg = await R.getTheme();
  state.themeMode = themeCfg.mode || 'light';
  applyThemeAttr(!!themeCfg.dark);
  $$('#segTheme button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.themeMode));

  // 主进程可能在 did-finish-load 时就推过一次；这里再主动取一次，两边都不会漏
  const pending = await R.pendingPath();
  if (pending) openPaths([pending]);

  // 读取持久化的幻灯片间隔，应用到设置控件
  if (cfg && cfg.slideshowInterval) {
    state.slideshowInterval = +cfg.slideshowInterval || 2600;
    const si = $('#slideInterval');
    if (si) si.value = String(state.slideshowInterval);
  }

  updateStage();
  setOp(t('Ready'));
}

window.addEventListener('DOMContentLoaded', main);
