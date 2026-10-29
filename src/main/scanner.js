'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');

// Chromium 能直接渲染的格式
const NATIVE = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.webp', '.gif', '.bmp', '.ico', '.svg', '.avif',
]);

// Chromium 不能直接渲染，但文件里通常内嵌了预览图（JPEG/BMP），可提取后显示
const PREVIEW = new Set([
  '.cdr', '.cmx', '.psd', '.psb',
  '.tif', '.tiff',
  '.heic', '.heif',
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng',
  '.orf', '.rw2', '.raf', '.pef', '.srw', '.mrw', '.x3f', '.raw',
]);

// CAD 矢量（LibreDWG WASM 解析 → SVG）
const CAD = new Set([
  '.dwg', '.dxf',
]);

// 已知但本版不做（列出来是为了给用户明确提示，而不是静默忽略）
const KNOWN_UNSUPPORTED = new Set([
  '.pdf', '.ai', '.eps', '.exr', '.hdr', '.tga', '.jxl', '.dds', '.ktx',
]);

const ALL = new Set([...NATIVE, ...PREVIEW, ...CAD]);
const REGEX = new RegExp(
  '\\.(' + [...ALL].map((e) => e.slice(1)).join('|') + ')$', 'i'
);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.png': 'image/png', '.apng': 'image/apng',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.dwg': 'image/vnd.dwg', '.dxf': 'image/x-dxf',
};

function isSupported(file) {
  return REGEX.test(file);
}

function kind(ext) {
  if (NATIVE.has(ext)) return 'native';
  if (PREVIEW.has(ext)) return 'preview';
  if (CAD.has(ext)) return 'cad';
  return 'unsupported';
}

function mimeOf(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

// 自然排序：IMG_2 排在 IMG_10 前面。
// 复用同一个 Intl.Collator 而不是每次 localeCompare —— 后者每次比较都要
// 现建排序器，2000 个文件名实测 205ms，用 Collator 只要 2ms。
const COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function naturalCompare(a, b) {
  return COLLATOR.compare(a, b);
}

async function fileInfo(full, name) {
  const st = await fsp.stat(full);
  const ext = path.extname(name).toLowerCase();
  return {
    path: full,
    name,
    ext,
    dir: path.dirname(full),
    size: st.size,
    mtime: st.mtimeMs,
    kind: kind(ext),
  };
}

// 并发上限：Windows 上 stat 是异步 IO，串行等于把队列一个个排完。
// 实测 2000 个文件串行 200ms，32 路并发 59ms。
const STAT_CONCURRENCY = 32;

async function scanFolder(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && isSupported(e.name))
    .map((e) => e.name)
    .sort(naturalCompare);

  // 结果按下标写入，保证顺序与 names 一致（并发不改变排序）
  const out = new Array(names.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= names.length) return;
      const name = names[i];
      try {
        out[i] = await fileInfo(path.join(dir, name), name);
      } catch {
        out[i] = null;   // 单个文件读取失败不影响整体
      }
    }
  };
  const lanes = Math.min(STAT_CONCURRENCY, names.length);
  if (lanes > 0) await Promise.all(Array.from({ length: lanes }, worker));
  return out.filter(Boolean);
}

module.exports = {
  NATIVE, PREVIEW, CAD, KNOWN_UNSUPPORTED, ALL,
  isSupported, kind, mimeOf, scanFolder, fileInfo, naturalCompare,
};
