'use strict';

// CDR/CMX 矢量渲染通道。
//
// 架构取舍（有意为之）：
// - 用「外部小工具 cdr2svg.exe」而不是 N-API 进程内加载。CDR 是闭源二进制格式，
//   恶意/损坏文件可能让解析器崩溃 —— 放在独立进程里，崩了也不连累看图器本体。
// - libcdr 不做光栅化，只输出绘图指令；这里转成 SVG 交给 Chromium 渲染，
//   质量与性能都好，还天然支持无限缩放。
// - 产物缓存在 userData/cdr-svg 下，键 = 路径 + mtime + size + 页码，
//   文件没变就不重转。

const { spawn } = require('node:child_process');
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const VECTOR_EXT = new Set(['.cdr', '.cmx']);
const TIMEOUT_MS = 30_000;               // 单文件转换上限
const MAX_INPUT_BYTES = 128 * 1024 * 1024;

let cfg = { exe: '', cacheDir: '' };
const inflight = new Map();              // `${abs}#${page}` -> Promise

function init(opts) {
  cfg = { ...cfg, ...opts };
}

// 入参既可以是完整路径，也可以是带点后缀（'.cdr'）——两者都认。
// 注意 path.extname('.cdr') 会返回 ''（首点被当成 dotfile），所以要先查整串。
function supported(p) {
  const s = String(p || '').toLowerCase();
  return VECTOR_EXT.has(s) || VECTOR_EXT.has(path.extname(s));
}

// 缓存键里的版本位：只要下面「从 SVG 反推页面几何」的规则变了就得升，
// 否则老用户会一直命中旧 meta（没有 box/单位），表现为坐标读数永远空白。
const CACHE_VER = 'v2';

function keys(abs, st, page) {
  const k = crypto
    .createHash('sha1')
    .update(`${abs.toLowerCase()}|${st.mtimeMs}|${st.size}|${CACHE_VER}|p${page}`)
    .digest('hex');
  return {
    svg: path.join(cfg.cacheDir, k + '.svg'),
    meta: path.join(cfg.cacheDir, k + '.json'),
  };
}

// 只读文件头部：SVG 的 width/height/viewBox 都在第一行，没必要把几十 MB 的
// 位图数据整个读进内存。
async function readHead(file, n = 4096) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

const LEN_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };

function parseLen(s) {
  const m = /^\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return { v, unit: (m[2] || '').toLowerCase() };
}

// libcdr 经 librevenge 的 SVG 输出器落盘，头部形如
//   <svg ... width="210mm" height="297mm" viewBox="0 0 21000 29700">
// viewBox 是内部单位（CDR 里是 1/100 mm）。把它和物理尺寸对上，就能得到
// 「毫米」坐标 —— CDR 是排版文件，用 mm 读数才和 CorelDRAW 一致。
// 解析不出来就返回 null，渲染层自动退化成「只缩放、不报坐标」，不硬编单位。
function readPageBox(head) {
  const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(head);
  if (!vb) return null;
  const n = vb[1].trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || !n.every((v) => Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;

  const wm = /<svg\b[^>]*\swidth\s*=\s*"([^"]*)"/i.exec(head);
  const hm = /<svg\b[^>]*\sheight\s*=\s*"([^"]*)"/i.exec(head);
  const W = parseLen(wm && wm[1]);
  const H = parseLen(hm && hm[1]);

  let k = 1;
  let unit = 'px';
  if (W && H && LEN_MM[W.unit] && LEN_MM[H.unit]) {
    const kw = (W.v * LEN_MM[W.unit]) / n[2];
    const kh = (H.v * LEN_MM[H.unit]) / n[3];
    if (kw > 0 && kh > 0) {
      // 宽高换算比不一致说明头部有缩放/分辨率歧义，以宽为准（宽通常更可信）
      k = Math.abs(kw - kh) > Math.max(kw, kh) * 0.02 ? kw : (kw + kh) / 2;
      unit = 'mm';
    }
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return {
    // Y 轴按工程习惯：原点在左下、向上为正，与 DWG 的读数方向保持一致
    box: { minX: r4(n[0] * k), minY: 0, maxX: r4((n[0] + n[2]) * k), maxY: r4(n[3] * k) },
    unit,
  };
}


// 命中缓存（且文件未变化）时直接返回，不重转
async function peek(abs, page = 0) {
  if (!cfg.cacheDir) return null;
  try {
    const st = await fsp.stat(abs);
    const { svg, meta } = keys(abs, st, page);
    const [mSvg, mMeta] = await Promise.all([
      fsp.stat(svg).catch(() => null),
      fsp.stat(meta).catch(() => null),
    ]);
    if (mSvg && mMeta && mSvg.size > 0) {
      const info = JSON.parse(await fsp.readFile(meta, 'utf8'));
      return { ...info, svgPath: svg, cached: true };
    }
  } catch {
    // 文件不存在 / 缓存读取失败都当未命中
  }
  return null;
}

function runTool(abs, outSvg, page) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(cfg.exe, [abs, outSvg, String(page)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch {}
        reject(new Error(`cdr2svg 超时（${TIMEOUT_MS / 1000}s）`));
      }
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const msg = (stderr || stdout || `退出码 ${code}`).trim();
        reject(new Error(msg.slice(0, 200) || `cdr2svg 退出码 ${code}`));
        return;
      }
      // stdout 最后一行是 JSON 摘要（前面可能有库的告警输出，从右往左找 '{'）
      const line = stdout.trim().split('\n').pop() || '';
      try {
        const info = JSON.parse(line.slice(line.lastIndexOf('{')));
        resolve(info);
      } catch {
        reject(new Error('cdr2svg 输出无法解析'));
      }
    });
  });
}

/**
 * 把 CDR/CMX 转成 SVG。
 * @returns {Promise<{ok:true,svgPath:string,pages:number,page:number,width:number,height:number,cached:boolean}>}
 */
async function render(abs, page = 0) {
  if (!supported(abs)) throw new Error('不是 CDR/CMX 文件');
  if (!cfg.exe) throw new Error('cdr2svg 工具不可用');

  const hit = await peek(abs, page);
  if (hit) return hit;

  const st = await fsp.stat(abs);
  if (st.size > MAX_INPUT_BYTES) throw new Error('文件过大，不适用矢量渲染');

  const key = `${abs.toLowerCase()}#${page}`;
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const { svg, meta } = keys(abs, st, page);
    await fsp.mkdir(cfg.cacheDir, { recursive: true });
    const info = await runTool(abs, svg, page);
    // 转出来的 SVG 头里就有页面几何：顺手记进 meta，渲染层就不用再拉一遍文件
    const geo = readPageBox(await readHead(svg));
    const metaOut = {
      ok: true,
      pages: info.pages || 1,
      page: info.page ?? page,
      width: info.width || 0,
      height: info.height || 0,
      bytes: info.bytes || 0,
      box: geo ? geo.box : null,
      unit: geo ? geo.unit : '',
      renderedAt: Date.now(),
    };
    await fsp.writeFile(meta, JSON.stringify(metaOut), 'utf8');
    return { ...metaOut, svgPath: svg, cached: false };
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

// 预热：给「正在被浏览的文件」后台转 SVG，不抛错、不阻塞调用方
function warmup(abs, notify) {
  render(abs, 0)
    .then((r) => { if (notify) notify(null, r); })
    .catch((err) => { if (notify) notify(err, null); });
}

module.exports = {
  VECTOR_EXT,
  init,
  supported,
  render,
  peek,
  warmup,
  toolConfigured: () => !!cfg.exe,
};
