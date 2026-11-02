'use strict';

// 文件关联与「设为默认看图软件」。
//
// 重要：Windows 8 之后，系统**不允许**任何程序静默把自己设成默认打开方式
// （微软刻意封死了这条路径，防止软件互相抢关联）。
// 正确做法是：
//   1. 把本程序注册成候选（Capabilities + RegisteredApplications + OpenWithProgids）
//      —— 这样它才会出现在「打开方式」和「默认应用」列表里；
//   2. 用 ms-settings: 深链把用户送到系统设置页并选中本程序，由用户点一下确认。
// 下面两条路都实现，installer/UI 只需要调用。

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

const DISPLAY_NAME = 'RatViewer';   // 只作为「值」出现，显示给人看
const KEY_NAME = 'RatViewer';  // 注册表键名一律用 ASCII，避开编码坑
const PROGID = 'RatViewer.Image';

// 某些受限环境（例如自动化沙箱）会拦截 reg.exe。设为 1 时本模块整体降级为
// 只报告状态、不碰注册表 —— 便于在沙箱内验证程序能否正常启动。
const REG_DISABLED = process.env.RAT_NO_REG === '1';

const EXTENSIONS = [
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.webp', '.gif', '.bmp', '.ico', '.svg', '.avif',
  '.tif', '.tiff', '.cdr', '.cmx', '.psd', '.psb', '.heic', '.heif',
  '.dwg', '.dxf',
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng',
  '.orf', '.rw2', '.raf', '.pef', '.srw', '.mrw', '.x3f',
];

// 关联清单版本：EXTENSIONS 变化时 +1，老用户升级后会自动重注册一次
const EXT_VER = 2;

function reg(args) {
  return run('reg.exe', args, { windowsHide: true }).catch((e) => {
    throw new Error('注册表写入失败: ' + (e.stderr || e.message));
  });
}

// 有限并发跑一批异步任务。36 个扩展 × 每项 2~3 次 reg 调用，串行要好几秒，
// 并发 8 路能把「注册 + 检测」压到几百毫秒。
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// 读一个注册表值。键/值不存在都返回 null（reg query 对不存在的键退出码非 0）。
async function readValue(key, value) {
  const args = ['query', key];
  if (value) args.push('/v', value);
  try {
    const { stdout } = await run('reg.exe', args, { windowsHide: true });
    if (value) {
      const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = stdout.match(new RegExp('\\s' + esc + '\\s+REG_\\w+\\s+(.*)'));
      return m ? m[1].trim() : null;
    }
    const m = stdout.match(/REG_\w+\s+(.*)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// 某个扩展名当前归谁：
//   userChoice —— Windows 在「默认应用」里记住的选择（带哈希校验，程序不能直接改）
//   classDefault —— HKCU\Software\Classes\.ext 的默认 ProgID（无 userChoice 时就是它生效）
async function probeExt(ext) {
  const ucKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`;
  const userChoice = await readValue(ucKey, 'ProgId');
  if (userChoice) {
    return { ext, userChoice, classDefault: null, isMine: userChoice === PROGID, locked: userChoice !== PROGID };
  }
  const classDefault = await readValue(`HKCU\\Software\\Classes\\${ext}`, null);
  return { ext, userChoice: null, classDefault, isMine: classDefault === PROGID, locked: false };
}

// 把「Windows 还没有记住选择」的扩展名直接接管 —— 写 HKCU\Software\Classes\.ext 默认值。
// 这类格式（.cdr/.psd/.dwg/.cr2/.heic ...）系统里没有 UserChoice，谁写默认值谁就是默认，
// 所以装完/启动后立刻生效，用户不用做任何事。
// 已有 UserChoice 的格式（.jpg/.png 等被系统或用户选过的）绝不抢，留给用户确认。
async function claimUnowned() {
  if (REG_DISABLED) {
    return { ok: false, disabled: true, claimed: [], locked: [], failed: [], total: EXTENSIONS.length };
  }
  const probes = await mapLimit(EXTENSIONS, 8, probeExt);
  const claimed = [];
  const locked = [];
  const failed = [];
  for (const p of probes) {
    if (p.isMine) { claimed.push(p.ext); continue; }
    if (p.userChoice) { locked.push(p.ext); continue; }   // 系统已记住别的程序，不碰
    try {
      await reg(['add', `HKCU\\Software\\Classes\\${p.ext}`, '/ve', '/t', 'REG_SZ', '/d', PROGID, '/f']);
      claimed.push(p.ext);
    } catch {
      failed.push(p.ext);
    }
  }
  return { ok: true, claimed, locked, failed, total: EXTENSIONS.length };
}

// 当前接管情况，给界面显示「已接管 N/M」用
async function summary() {
  if (REG_DISABLED) return { total: EXTENSIONS.length, mine: [], locked: [], ok: false };
  const probes = await mapLimit(EXTENSIONS, 8, probeExt);
  return {
    ok: true,
    total: EXTENSIONS.length,
    mine: probes.filter((p) => p.isMine).map((p) => p.ext),
    locked: probes.filter((p) => !p.isMine && p.userChoice).map((p) => p.ext),
  };
}


function exePath() {
  return process.execPath;
}

// 「打开方式」列表里显示的名字 = exe 文件名，所以这里必须和实际 exe 一致
function exeName() {
  return path.basename(process.execPath);
}

async function register() {
  const exe = exePath();
  const name = exeName();
  if (REG_DISABLED) {
    return { ok: false, disabled: true, exe, exeName: name, progId: PROGID, extensions: EXTENSIONS.length };
  }
  const appKey = `HKCU\\Software\\Classes\\Applications\\${name}`;

  // 1) ProgID
  await reg(['add', `HKCU\\Software\\Classes\\${PROGID}`, '/ve', '/t', 'REG_SZ', '/d', `${DISPLAY_NAME} 图片文件`, '/f']);
  await reg(['add', `HKCU\\Software\\Classes\\${PROGID}\\DefaultIcon`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f']);
  await reg(['add', `HKCU\\Software\\Classes\\${PROGID}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f']);

  // 2) Applications\<exe>：让它出现在「打开方式」菜单
  await reg(['add', appKey, '/ve', '/t', 'REG_SZ', '/d', DISPLAY_NAME, '/f']);
  await reg(['add', appKey, '/v', 'FriendlyAppName', '/t', 'REG_SZ', '/d', DISPLAY_NAME, '/f']);
  await reg(['add', `${appKey}\\DefaultIcon`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f']);
  await reg(['add', `${appKey}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f']);

  // 3) Capabilities：让它出现在 Win10/11 的「默认应用」页面
  const cap = `HKCU\\Software\\${KEY_NAME}\\Capabilities`;
  await reg(['add', cap, '/v', 'ApplicationName', '/t', 'REG_SZ', '/d', DISPLAY_NAME, '/f']);
  await reg(['add', cap, '/v', 'ApplicationDescription', '/t', 'REG_SZ', '/d', '轻量高性能看图软件，支持 CDR/PSD/RAW 内嵌预览', '/f']);
  await reg(['add', cap, '/v', 'ApplicationIcon', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f']);
  await reg(['add', `HKCU\\Software\\RegisteredApplications`, '/v', KEY_NAME, '/t', 'REG_SZ', '/d', `Software\\${KEY_NAME}\\Capabilities`, '/f']);

  // 4) 逐个扩展名登记为候选（并发写，串行要好几秒）
  await mapLimit(EXTENSIONS, 8, async (ext) => {
    await reg(['add', `${cap}\\FileAssociations`, '/v', ext, '/t', 'REG_SZ', '/d', PROGID, '/f']);
    await reg(['add', appKey + '\\SupportedTypes', '/v', ext, '/t', 'REG_SZ', '/d', '', '/f']);
    // 「打开方式 → 更多应用」里出现本程序；只写 OpenWithProgids 子键，不动 .jpg 的默认值
    await reg(['add', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', PROGID, '/t', 'REG_SZ', '/d', '', '/f']);
  });

  // 5) 顺手接管「还没有主儿」的格式：装上就能双击打开，不用再去系统设置里点
  const claim = await claimUnowned().catch(() => ({ claimed: [], locked: [] }));

  return {
    ok: true, exe, exeName: name, progId: PROGID, extensions: EXTENSIONS.length,
    claimed: claim.claimed || [], locked: claim.locked || [],
  };
}

async function unregister() {
  if (REG_DISABLED) return { ok: false, disabled: true };
  const name = exeName();
  const del = (key) => reg(['delete', key, '/f']).catch(() => {});
  await del(`HKCU\\Software\\Classes\\Applications\\${name}`);
  await del(`HKCU\\Software\\Classes\\${PROGID}`);
  await del(`HKCU\\Software\\${KEY_NAME}`);
  // RegisteredApplications 下 KEY_NAME 是「值」不是「键」，只能按值删，绝不能整键删
  await run('reg.exe', ['delete', 'HKCU\\Software\\RegisteredApplications', '/v', KEY_NAME, '/f'], { windowsHide: true }).catch(() => {});
  for (const ext of EXTENSIONS) {
    await run('reg.exe', [
      'delete', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', PROGID, '/f',
    ], { windowsHide: true }).catch(() => {});
  }
  // 回收我们写成默认的扩展名——只在值确实还是我们的时候删，用户后来自己选的绝不动
  await mapLimit(EXTENSIONS, 8, async (ext) => {
    const cur = await readValue(`HKCU\\Software\\Classes\\${ext}`, null);
    if (cur === PROGID) {
      await run('reg.exe', ['delete', `HKCU\\Software\\Classes\\${ext}`, '/ve', '/f'], { windowsHide: true }).catch(() => {});
    }
  });
  return { ok: true };
}

// 安装器里用户勾了「设为默认」，会留下 SetDefaultRequested=1。
// 首次启动读一次并清掉：如果还有被 UserChoice 锁住的格式，就把用户送到系统页确认。
async function consumeInstallRequest() {
  if (REG_DISABLED) return false;
  const key = `HKCU\\Software\\${KEY_NAME}\\Install`;
  const v = await readValue(key, 'SetDefaultRequested');
  if (v !== '1') return false;
  await run('reg.exe', ['delete', key, '/v', 'SetDefaultRequested', '/f'], { windowsHide: true }).catch(() => {});
  return true;
}

async function isRegistered() {
  if (REG_DISABLED) return false;
  try {
    const { stdout } = await run('reg.exe', ['query', `HKCU\\Software\\Classes\\${PROGID}`], { windowsHide: true });
    return stdout.includes(PROGID);
  } catch {
    return false;
  }
}

module.exports = {
  register, unregister, isRegistered, EXTENSIONS, PROGID,
  KEY_NAME, DISPLAY_NAME, exePath, EXT_VER,
  claimUnowned, summary, probeExt, consumeInstallRequest,
  // 兼容旧名
  APP_KEY: KEY_NAME,
};
