<div align="center">

# RatViewer

**A lightweight, fast image viewer for Windows — it also opens CDR, PSD, DWG/DXF and camera RAW, the formats most viewers choke on.**

[![Download](https://img.shields.io/github/v/release/mollyneko/RatImgViewer?label=Download&color=2ea043&style=for-the-badge)](https://github.com/mollyneko/RatImgViewer/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/mollyneko/RatImgViewer/total?style=for-the-badge&color=0969da)](https://github.com/mollyneko/RatImgViewer/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d4?style=for-the-badge)](#download--install)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#license)

[Download](#download--install) · [Features](#features) · [Formats](#supported-formats) · [Shortcuts](#keyboard-shortcuts) · [Screenshots](#screenshots) · [Build from source](#build-from-source)

</div>

---

## Language / 言語 / 언어

- **English** (default)
- [中文](#中文)
- [日本語](#日本語)
- [한국어](#한국어)

---

# English

## What it is

A pure image viewer. No layers, no filter curves, no attempt to become Photoshop — it does exactly one thing: **open your image and show it, fast.**

What makes it different is the stuff other viewers can't open:

- **CDR / CMX** (CorelDRAW) — a built-in libcdr vector engine, so you can view them without CorelDRAW installed, with no font dependency and no blur.
- **DWG / DXF** (CAD drawings) — LibreDWG built in, so you can read CAD files without AutoCAD.
- **PSD / PSB, HEIC, camera RAW** — it pulls the embedded preview and opens instantly, without waiting for a full parse. TIFF is decoded in-app instead, so plain scans open too.

## Download & install

Grab the latest build (Windows 10 / 11, 64-bit) from the **[Releases page](https://github.com/mollyneko/RatImgViewer/releases/latest)**:

| File | Type | For |
|---|---|---|
| **[RatViewer-Setup-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.2.exe)** | Installer (NSIS) | Everyday use. Choose the install folder, create desktop/start-menu shortcuts, and register file associations. |
| **[RatViewer-Portable-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.2.exe)** | Portable (single file) | Carry it on a USB stick — double-click to run, no registry writes, no leftovers. |

> **About the "unknown publisher" warning**
> The installer isn't code-signed (an EV certificate isn't cheap). On first run Windows SmartScreen may say "Windows protected your PC." Click "More info" → "Run anyway." If that bothers you, you can always [build from source](#build-from-source).
>
> The Releases page also ships `SHA256SUMS.txt`, so you can verify integrity with `certutil -hashfile <file> SHA256`.

**System requirements:** Windows 10 1809+ / Windows 11, x64. No .NET, no runtime, no codec pack needed.

## Features

### Viewing

| | |
|---|---|
| **Fast paging** | Left/right arrows, toolbar buttons, or the bottom filmstrip. Thumbnails are cached on disk, so re-opening is near-instant. |
| **Zoom** | Scroll wheel (anchored at the cursor), fit-to-window, 1:1 actual pixels, drag to pan. |
| **Tabs** | Multiple tabs in one window, each keeping its own folder and position. |
| **Slideshow** | Spacebar starts/stops, auto-advances on a configurable interval. |
| **Magnifier** | Press `L` for a follow-cursor loupe to inspect detail. |
| **Info panel** | Dimensions, size, format, decode time, EXIF (camera/lens/aperture/shutter/ISO), RGB histogram. |

### Format support & decode strategy

Three layers: **native decode** → **extract embedded preview** → **vector engine**. The rule is "open instantly if we can" — we never fully parse a PSD just to show it.

### Light adjustment (non-destructive)

- **Rotate / flip** — only writes EXIF Orientation and a sidecar note; the original pixels are never touched.
- **Crop** — stores the rectangle; you can revert anytime. It only bakes into a new file when you apply it.
- **Brightness / contrast / saturation / one-click enhance** — exactly four sliders, no more. Live preview; baked only on export.
- Want it on disk? Always "Save as" — the original stays safe.

### Manage, compare, batch

- **Manage** — a thumbnail grid of the whole folder, adjustable thumbnail size, disk-cache accelerated. Filter by filename to find files in a large folder.
- **Compare** — side-by-side with a draggable divider; great for spotting differences (before/after, two versions).
- **Batch** — convert formats (JPEG / PNG / WebP), set quality, cap the long edge, and watch per-file progress and status.

### System integration

- **File association** — one click to register as a candidate viewer. Note: per Microsoft's rules, an app **cannot** silently set itself as the default opener (the UserChoice registry key is tamper-protected). So the right flow is: this app registers as a candidate → you confirm it in the system "Default apps" page.
- **Open via double-click / drag** — drop a file or an entire folder into the window.
- **Delete = Recycle Bin** — deletes always go through `shell.trashItem`; we never wipe directly.
- **Fully offline** — no network requests, no telemetry, no data collection. Works disconnected.

## Screenshots

| Viewing (light) | Viewing (dark) |
|---|---|
| ![View](docs/screenshots/01-view.png) | ![Dark](docs/screenshots/02-view-dark.png) |

| Folder manage | CDR vector render |
|---|---|
| ![Manage](docs/screenshots/03-manage.png) | ![CDR](docs/screenshots/04-cdr.png) |

![Settings](docs/screenshots/05-settings.png)

> Screenshots are taken from the real running app. Design drafts and architecture docs live in the [`design/`](design/) folder.

## Supported formats

| Format | How it's handled | Notes |
|---|---|---|
| JPG / JPEG | Native decode | Chromium decoder |
| PNG / APNG | Native decode | Transparency & animation |
| WebP | Native decode | Animation |
| GIF | Native decode | Animation |
| BMP / ICO | Native decode | — |
| AVIF | Native decode | — |
| SVG | Native decode | Vector, lossless scaling |
| TIFF / TIF | Local decode, built in | Uncompressed, LZW, Deflate, PackBits; JPEG-compressed TIFF isn't supported |
| PSD / PSB | Extract embedded preview | Requires saving with "Maximize Compatibility" |
| **CDR / CMX** | Preview + libcdr full vector | Falls back to the vector engine (background render + hot-swap) only when there's no embedded preview |
| **DWG / DXF** | LibreDWG vector parse | Layers, text, block refs; DXF uses a pure-JS parser that auto-detects gb18030 / Big5 / UTF-16 encoding |
| HEIC / HEIF | Extract embedded preview | Only works when the file carries a JPEG preview |
| CR2 / CR3 / NEF / ARW / DNG and other RAW | Extract embedded JPEG preview | Mainstream camera models |

Not yet supported: PDF, AI, EPS, EXR, TGA, JXL (open an issue if you need them).

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `←` / `→` | Previous / next | `C` | Enter crop mode |
| `Space` | Toggle slideshow | `Enter` | Apply crop |
| `+` / `-` | Zoom in / out | `Esc` | Exit crop / slideshow |
| `F` | Fit to window | `L` | Magnifier |
| `Ctrl+1` | Actual pixels 1:1 | `,` / `.` | Rotate left / right 90° |
| `Ctrl+Scroll` | Zoom | `H` / `V` | Flip horizontal / vertical |
| `Ctrl+O` | Open image | `Del` | Delete to Recycle Bin |
| `Ctrl+S` | Save as | `Ctrl+D` | Toggle theme |
| `1` / `2` / `3` / `4` | Switch screen (View / Manage / Compare / Batch) | | |

## Build from source

```bash
# Prereqs: Node.js 18+ (20/22 recommended), Windows
git clone https://github.com/mollyneko/RatImgViewer.git
cd RatImgViewer
npm install

npm start              # run in dev mode
npm run smoke          # headless self-test
npm run dist           # package: NSIS installer + portable → dist/
npm run dist:portable  # portable only
npm run dist:dir       # unpackaged folder only, for debugging
```

### Prebuilt binaries in the repo

`vendor/` holds prebuilt artifacts shipped with the package, **outside the main dependency chain** — clone and they just work:

```
vendor/cdr2svg/         # CDR vector converter (~44 MB)
                        #   cdr2svg.exe + libcdr / librevenge / ICU / lcms2 runtime
                        #   built as a standalone process from libcdr 0.1.9 + librevenge via MSYS2 mingw-w64
vendor/libredwg-web/    # DWG/DXF parse engine (~10 MB)
                        #   @mlightcad/libredwg-web 0.7.10 (LibreDWG compiled to WASM)
```

Two key design trade-offs:

1. **CDR uses a separate process, not an N-API plugin** — vector parsers crashing on malformed files is normal. A separate process gives crash isolation + a 30s timeout + result caching keyed by `path + mtime + size + page`. Worst case, one image fails to render; the viewer survives.
2. **DWG runs in-process via WASM** — drawings are fairly regular, so in-process avoids IPC overhead. `.dxf` uses a pure-JS text parser (zero deps), which is faster than WASM and handles encoding cleanly.

### Project structure

```
src/
  main/                    # main process
    main.js                #   app entry, window, IPC, ratfile:// custom protocol
    preload.js             #   contextBridge safe bridge
    scanner.js             #   folder scan & prefetch
    exif.js                #   EXIF parsing
    preview.js             #   embedded preview extraction (PSD/HEIC/RAW/CDR)
    tiff.js                #   built-in TIFF decoder (LZW/Deflate/PackBits)
    cache.js               #   disk cache
    assoc.js               #   file-association registration (HKCU)
    cdr.js                 #   CDR conversion process scheduler
    dwg.js                 #   DWG/DXF scheduler + SVG generation
    dwg-parser.js          #   DWG → unified geometry buckets (WASM)
    dxf-parser.js          #   DXF → unified geometry buckets (pure JS)
  renderer/                # renderer (plain HTML/CSS/JS, no framework)
    index.html
    styles.css
    app.js
  design/                  # interaction drafts & technical architecture docs
  build/                   # icons, NSIS install script
  tools/                   # toolchain checks, smoke test, release scripts
```

**Why no React/Vue for the renderer:** it's a 5-screen single-window app with mostly static DOM and simple state (current file + zoom + adjust params). Hand-written vanilla JS buys zero build step, zero framework weight, and fully controlled repaint timing — which matters for the "page turn stays within 16 ms" goal.

### Tech stack

Electron 33 · plain HTML/CSS/JS (no framework in the renderer) · libcdr 0.1.9 + librevenge (CDR/CMX)
· LibreDWG via WebAssembly (DWG/DXF) · bitmaps handed to the renderer via `SharedArrayBuffer` zero-copy.

Architecture details, performance targets, and trade-off notes are in [`design/architecture.html`](design/architecture.html).

## Known limitations

- Windows only. The renderer is cross-platform; the file association, CDR converter, and packaging are tied to Win32.
- The installer is unsigned, so there's a SmartScreen prompt on first run (see above).
- CDR/CMX files **with an embedded preview keep that preview and are not hot-swapped to vector**: on some files libcdr moves embedded bitmaps out of the page, and white text reads worse on a light background, so hot-swapping would be a downgrade. Only CDR files without an embedded preview use the vector engine.
- Vector images (CDR / DWG) have no histogram: browsers forbid reading pixels back from an SVG drawn to a canvas (a malicious-SVG information-leak guard), so the histogram area shows "pixels unavailable." Raster formats are unaffected.
- Camera RAW reads the embedded JPEG preview only, not a full RAW decode (fine for viewing; use Lightroom for quality).
- PDF / AI / EPS not yet supported.

## Third-party components & license

This project's **own code** is released under the [MIT license](LICENSE). The bundled third-party components each have their own licenses:

| Component | License | Use |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | App runtime |
| [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) | MPL-2.0 | CDR / CMX vector parsing |
| [ICU](https://icu.unicode.org/) | Unicode License | Charset & encoding conversion |
| [lcms2](https://github.com/mm2/Little-CMS) | MIT | Color management |
| [zlib](https://zlib.net/) | zlib License | Compression |
| [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) / [LibreDWG](https://www.gnu.org/software/libredwg/) | GPL-3.0 | DWG / DXF parsing |

> ⚠️ **Heads up**: `libredwg-web` and its underlying LibreDWG are **GPL-3.0**. That means the distributed package mixes MIT code with GPL-3.0 components — a combined distribution. If you plan to redistribute or commercialize a derivative, confirm whether you need to replace the DWG/DXF module or comply with GPL-3.0. The project author is not responsible for your compliance decisions.

## Acknowledgements

- [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) — all the CDR/CMX parsing.
- [LibreDWG](https://www.gnu.org/software/libredwg/) and [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) — the DWG/DXF engine.
- The [Electron](https://github.com/electron/electron) team.

## License

[MIT](LICENSE) © 2026 Rat (mollyneko)

---

# 中文

## 这是什么

一个纯粹的看图工具。没有图层、没有滤镜曲线、不试图变成 Photoshop —— 它只做一件事：**把文件打开给你看，而且快**。

特别之处在于它能直接看一些同类看图软件打不开的东西：

- **CDR / CMX**（CorelDRAW）—— 内置 libcdr 矢量引擎，不装 CorelDRAW 也能看，无字体依赖、不糊
- **DWG / DXF**（CAD 图纸）—— 内置 LibreDWG，看图不用开 AutoCAD
- **PSD / PSB、HEIC、相机 RAW** —— 直接抽取内嵌预览，秒开不等解析；TIFF 由内置解码器直接解，扫描件也能开

## 下载与安装

前往 **[Releases 页面](https://github.com/mollyneko/RatImgViewer/releases/latest)** 下载最新版（Windows 10 / 11 64 位）：

| 文件 | 类型 | 适合谁 |
|---|---|---|
| **[RatViewer-Setup-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.2.exe)** | 安装版（NSIS） | 日常使用。可选安装目录、创建桌面/开始菜单快捷方式、支持注册文件关联 |
| **[RatViewer-Portable-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.2.exe)** | 免安装版（单文件） | 放 U 盘里随身带，双击即用，不写注册表、不留痕 |

> **关于「未知发布者」警告**
> 安装包未购买代码签名证书（EV 证书年费不便宜）。首次运行 Windows SmartScreen 会提示"已保护你的电脑"，点「更多信息」→「仍要运行」即可。如果你介意，也可以直接[从源码构建](#从源码构建-1)。Releases 页面同时提供 `SHA256SUMS.txt`，可用 `certutil -hashfile <文件> SHA256` 核对完整性。

**系统要求**：Windows 10 1809 及以上 / Windows 11，x64。无需安装 .NET、运行库或任何解码包。

## 功能特性

### 看图

| | |
|---|---|
| **快速翻页** | 左右方向键 / 工具栏按钮 / 底部胶片条；缩略图走磁盘缓存，二次打开几乎瞬时 |
| **缩放** | 滚轮（以光标为锚点）缩放、适应窗口、1:1 实际像素、拖动平移 |
| **多标签** | 一个窗口开多个标签页，各自记住所在的文件夹和位置，互不干扰 |
| **幻灯片** | 空格键开始/停止放映，按设定的间隔自动翻页（间隔可在设置里改） |
| **放大镜** | 按 `L` 调出跟随放大镜，看清局部细节 |
| **信息面板** | 尺寸、体积、格式、解码耗时、EXIF（相机/镜头/光圈/快门/ISO）、RGB 直方图 |

### 格式支持与解码策略

分三层：**内置直解** → **抽取内嵌预览** → **矢量引擎渲染**。策略是"能秒开就秒开"，绝不为了一张 PSD 去完整解析整个文件。

### 轻量调整（非破坏性）

- **旋转 / 翻转** —— 只写 EXIF Orientation 与 sidecar 记录，原始像素一个字节都不动
- **裁剪** —— 存的是矩形参数，随时可以还原；应用时才另存为新文件
- **亮度 / 对比度 / 饱和度 / 一键美化** —— 四项，没有再多了。实时预览，导出时才烘焙
- 想真正落盘？一律走「另存为」，原文件永远安全

### 管理、对比、批量

- **管理** —— 缩略图网格浏览整个文件夹，缩略图尺寸可调，磁盘缓存加速二次打开；还能按文件名搜索，大文件夹里也能快速定位
- **对比** —— 左右并排 + 可拖动分割线，找差异（改图前后、两个版本）非常直观
- **批量** —— 批量转换格式（JPEG / PNG / WebP）、调质量、限制长边，逐行显示进度与状态（矢量格式会自动跳过）

### 系统集成

- **文件关联** —— 一键注册为候选看图程序。注意：按微软的规定，程序**不能**把自己静默设成默认打开方式（UserChoice 注册表项有防篡改哈希）。所以正确姿势是：本程序注册候选 → 你在系统「默认应用」里点一下确认。
- **双击打开 / 拖拽打开** —— 支持把文件或整个文件夹拖进窗口
- **删除 = 回收站** —— 删除一律走 `shell.trashItem` 进系统回收站，绝不直接抹掉
- **完全离线** —— 不发任何网络请求，不看你的图，不收集数据。可以断网使用

## 界面截图

| 看图（白天） | 看图（黑夜） |
|---|---|
| ![看图](docs/screenshots/01-view.png) | ![黑夜](docs/screenshots/02-view-dark.png) |

| 文件夹管理 | CDR 矢量渲染 |
|---|---|
| ![管理](docs/screenshots/03-manage.png) | ![CDR](docs/screenshots/04-cdr.png) |

![设置](docs/screenshots/05-settings.png)

> 截图取自真实程序运行画面。设计稿与架构文档见 [`design/`](design/) 目录。

## 支持格式

| 格式 | 处理方式 | 说明 |
|---|---|---|
| JPG / JPEG | 内置直解 | Chromium 解码 |
| PNG / APNG | 内置直解 | 支持透明与动画 |
| WebP | 内置直解 | 支持动画 |
| GIF | 内置直解 | 支持动画 |
| BMP / ICO | 内置直解 | — |
| AVIF | 内置直解 | — |
| SVG | 内置直解 | 矢量，可无损放大 |
| TIFF / TIF | 本地解码（内置） | 支持未压缩 / LZW / Deflate / PackBits；JPEG 压缩的 TIFF 不支持 |
| PSD / PSB | 抽取内嵌预览 | 需保存时勾选「最大兼容」，才有缩略图资源 |
| **CDR / CMX** | 预览 + libcdr 全量矢量 | 无内嵌预览时才启动矢量引擎后台渲染并热替换 |
| **DWG / DXF** | LibreDWG 矢量解析 | 支持图层、文字、块参照；DXF 走纯 JS 解析，自动识别 gb18030 / Big5 / UTF-16 编码 |
| HEIC / HEIF | 抽取内嵌预览 | 仅当文件内带 JPEG 预览时可用 |
| CR2 / CR3 / NEF / ARW / DNG 等 RAW | 抽取内嵌 JPEG 预览 | 主流相机机型 |

暂不支持：PDF、AI、EPS、EXR、TGA、JXL（有需求可以提 issue）。

## 快捷键

| 按键 | 功能 | 按键 | 功能 |
|---|---|---|---|
| `←` / `→` | 上一张 / 下一张 | `C` | 进入裁剪模式 |
| `空格` | 幻灯片放映开关 | `回车` | 应用裁剪 |
| `+` / `-` | 放大 / 缩小 | `Esc` | 退出裁剪 / 放映 |
| `F` | 适应窗口 | `L` | 放大镜 |
| `Ctrl+1` | 实际像素 1:1 | `,` / `.` | 左转 / 右转 90° |
| `Ctrl+滚轮` | 缩放 | `H` / `V` | 水平 / 垂直翻转 |
| `Ctrl+O` | 打开图片 | `Del` | 删除到回收站 |
| `Ctrl+S` | 另存为 | `Ctrl+D` | 切换主题 |
| `1` / `2` / `3` / `4` | 切换屏幕（看图 / 管理 / 对比 / 批量） | | |

## 从源码构建

```bash
# 前置：Node.js 18+（建议 20/22），Windows 环境
git clone https://github.com/mollyneko/RatImgViewer.git
cd RatImgViewer
npm install

npm start              # 开发模式直接运行
npm run smoke          # 冒烟测试（无头自检）
npm run dist           # 打包：NSIS 安装包 + 免安装版 → dist/
npm run dist:portable  # 只打免安装版
npm run dist:dir       # 只出未打包目录，调试用
```

### 仓库里的预编译二进制

`vendor/` 下是随包分发的预编译产物，**不进主包依赖链**，clone 下来即可直接用：

```
vendor/cdr2svg/         # CDR 矢量转换器（~44 MB）
                        #   cdr2svg.exe + libcdr / librevenge / ICU / lcms2 等运行库
                        #   由 libcdr 0.1.9 + librevenge 用 MSYS2 mingw-w64 编译成独立进程
vendor/libredwg-web/    # DWG/DXF 解析引擎（~10 MB）
                        #   @mlightcad/libredwg-web 0.7.10（LibreDWG 的 WASM 版）
```

设计上的两个关键取舍：

1. **CDR 用独立进程而不是 N-API 插件** —— 矢量解析器面对畸形文件崩溃是常态。独立进程可以做到崩溃隔离 + 30 秒超时 + 按「路径 + mtime + size + 页码」缓存结果，最坏情况也只是这一张图渲染失败，不会把整个看图软件带走。
2. **DWG 走 WASM 进程内** —— 图纸文件相对规整，进程内调用省掉 IPC 开销；`.dxf` 直接用纯 JS 文本解析器（零依赖），比 WASM 更快且能把编码问题处理干净。

### 项目结构

```
src/
  main/                    # 主进程
    main.js                #   应用入口、窗口、IPC、ratfile:// 自定义协议
    preload.js             #   contextBridge 安全桥
    scanner.js             #   目录扫描与预取
    exif.js                #   EXIF 解析
    preview.js             #   内嵌预览抽取（PSD/HEIC/RAW/CDR）
    tiff.js                #   TIFF 解码器（LZW/Deflate/PackBits）
    cache.js               #   磁盘缓存
    assoc.js               #   文件关联注册（HKCU）
    cdr.js                 #   CDR 转换进程调度
    dwg.js                 #   DWG/DXF 调度 + SVG 生成
    dwg-parser.js          #   DWG → 统一几何桶（WASM）
    dxf-parser.js          #   DXF → 统一几何桶（纯 JS）
  renderer/                # 渲染进程（原生 HTML/CSS/JS，无框架）
    index.html
    styles.css
    app.js
  design/                  # 交互设计稿与技术架构文档
  build/                   # 图标、NSIS 安装脚本
  tools/                   # 工具链校验、冒烟测试、发布脚本
```

**为什么渲染层不用 React/Vue**：这是个 5 屏的单窗口应用，DOM 结构基本静态，状态也不复杂（当前文件 + 缩放 + 调整参数）。手写原生 JS 换来的是零构建步骤、零框架体积、以及完全可控的重绘时机 —— 对"翻页要稳在 16 ms 内"这个目标很重要。

### 技术栈

Electron 33 · 原生 HTML/CSS/JS（渲染层无框架）· libcdr 0.1.9 + librevenge（CDR/CMX）· LibreDWG via WebAssembly（DWG/DXF）· 位图走 `SharedArrayBuffer` 零拷贝交给渲染进程。

架构细节、性能目标与取舍记录见 [`design/architecture.html`](design/architecture.html)。

## 已知限制

- 只支持 Windows。渲染层是跨平台的，主要是文件关联、CDR 转换器、打包流程绑定了 Win32
- 安装包未签名，首次运行会有 SmartScreen 提示（见上）
- CDR/CMX 有内嵌预览的文件**保留预览图、不热替换成矢量**：libcdr 在某些文件上会把嵌入位图移出页面，且白字在浅色底上可见性更差，热替换反而是降级。只有无内嵌预览的 CDR 才走矢量渲染
- 相机 RAW 只读内嵌 JPEG 预览，不做完整 RAW 解码（正常看图足够，追求画质请用 Lightroom）
- CDR / DWG 这类矢量图看不到直方图：浏览器不允许把 SVG 图片画到 canvas 后读回像素（恶意 SVG 的信息泄露防护），所以矢量图的直方图区会显示"无法读取像素"。位图格式不受影响
- 暂不支持 PDF / AI / EPS

## 第三方组件与许可

本项目**自身代码**以 [MIT 许可](LICENSE) 发布。随包分发的第三方组件各有其许可：

| 组件 | 许可 | 用途 |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | 应用运行时 |
| [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) | MPL-2.0 | CDR / CMX 矢量解析 |
| [ICU](https://icu.unicode.org/) | Unicode License | 字符集与编码转换 |
| [lcms2](https://github.com/mm2/Little-CMS) | MIT | 色彩管理 |
| [zlib](https://zlib.net/) | zlib License | 压缩 |
| [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) ／ [LibreDWG](https://www.gnu.org/software/libredwg/) | GPL-3.0 | DWG / DXF 解析 |

> ⚠️ **注意**：`libredwg-web` 及其底层 LibreDWG 是 **GPL-3.0**。也就是说，本项目的发布包内同时包含 MIT 代码与 GPL-3.0 组件，属于混合分发。如果你打算基于本项目做二次分发或商用，请先确认是否需要替换掉 DWG/DXF 模块，或者按 GPL-3.0 的要求处理。本项目作者不对使用者的合规决策负责。

## 致谢

- [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) — CDR/CMX 的解析全靠它们
- [LibreDWG](https://www.gnu.org/software/libredwg/) 与 [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) — DWG/DXF 引擎
- [Electron](https://github.com/electron/electron) 团队

## 许可

[MIT](LICENSE) © 2026 Rat (mollyneko)

---

# 日本語

## RatViewer について

純粋な画像ビューアーです。レイヤーもフィルターカーブもなく、Photoshop になるつもりもありません。やることはただ一つ：**画像を開いて素早く表示する**こと。

他のビューアーが開けないものを開けるのが特徴です：

- **CDR / CMX**（CorelDRAW）—— 内蔵の libcdr ベクトルエンジンで、CorelDRAW をインストールせずに表示可能。フォント依存なし、にじみなし。
- **DWG / DXF**（CAD 図面）—— LibreDWG を内蔵。AutoCAD なしで CAD ファイルを読めます。
- **PSD / PSB、HEIC、カメラ RAW** —— 埋め込みプレビューを取り出して即座に開き、全体の解析を待ちません。TIFF は内蔵デコーダで直接デコードします。

## ダウンロードとインストール

最新版（Windows 10 / 11、64 ビット）は **[Releases ページ](https://github.com/mollyneko/RatImgViewer/releases/latest)** から取得してください：

| ファイル | 種類 | 向いている人 |
|---|---|---|
| **[RatViewer-Setup-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.2.exe)** | インストーラー（NSIS） | 日常利用。インストール先の選択、デスクトップ/スタートメニューのショートカット作成、ファイルの関連付けに対応。 |
| **[RatViewer-Portable-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.2.exe)** | ポータブル（単一ファイル） | USB メモリに入れて持ち運び。ダブルクリックで実行、レジストリ書き込みなし、跡残しなし。 |

> **「発行元が不明」警告について**
> インストーラーはコード署名されていません（EV 証明書は安くありません）。初回実行時に Windows SmartScreen が「Windows によって PC が保護されました」と表示します。「詳細情報」→「実行」をクリックしてください。気になる場合は[ソースからビルド](#ソースからのビルド)も可能です。Releases ページには `SHA256SUMS.txt` もあり、`certutil -hashfile <ファイル> SHA256` で整合性を確認できます。

**動作環境**：Windows 10 1809 以降 / Windows 11、x64。.NET やランタイム、コーデックのインストールは不要です。

## 主な機能

### 表示

| | |
|---|---|
| **高速ページ送り** | 左右キー、ツールバーボタン、下部のフィルムストリップ。サムネイルはディスクにキャッシュされ、再オープンはほぼ瞬時。 |
| **ズーム** | ホイール（カーソル位置基準）、ウィンドウに合わせる、1:1 実ピクセル、ドラッグで移動。 |
| **タブ** | 1 ウィンドウで複数タブ。各タブは自分のフォルダーと位置を覚えて、互いに干渉しません。 |
| **スライドショー** | スペースキーで開始/停止。間隔は設定で変更できます。 |
| **ルーペ** | `L` でカーソル追従のルーペを表示し、細部を確認。 |
| **情報パネル** | サイズ、容量、形式、デコード時間、EXIF（カメラ/レンズ/絞り/シャッター/ISO）、RGB ヒストグラム。 |

### 形式対応とデコード戦略

3 層構成：**ネイティブデコード** → **埋め込みプレビューの抽出** → **ベクトルエンジン**。方針は「開けるなら即座に」。PSD を表示するためにファイル全体を解析することはありません。

### 軽量な調整（非破壊）

- **回転 / 反転** —— EXIF の Orientation とサイドカーファイルだけを書き込み。元のピクセルは一切変更しません。
- **切り抜き** —— 矩形パラメータを保持するのでいつでも元に戻せます。適用時だけ新しいファイルとして保存。
- **明るさ / コントラスト / 彩度 / ワンタップ補正** —— 4 つのスライダーのみ。リアルタイムプレビュー、書き出し時に反映。
- ディスクに残したいときは必ず「名前を付けて保存」。元ファイルは常に安全。

### 管理・比較・一括変換

- **管理** —— フォルダー全体をサムネイル一覧で表示。サムネイルサイズ可変、ディスクキャッシュで再オープンが高速。ファイル名で絞り込みも可能。
- **比較** —— 左右並べ + ドラッグ可能な仕切り線。違い（修正前後、2 つのバージョン）の発見に便利。
- **一括変換** —— 形式変換（JPEG / PNG / WebP）、品質設定、長辺の上限、1 件ずつの進捗と状態を表示（ベクトル形式は自動で除外）。

### システム連携

- **ファイルの関連付け** —— ワンクリックで候補ビューアーに登録。ただし Microsoft の規則により、アプリが自分自身を既定の開き方に**静かに設定することはできません**（UserChoice レジストリキーは改ざん防止済み）。正しい手順は：本アプリが候補登録 → システムの「既定のアプリ」で一度クリックして確定。
- **ダブルクリック / ドラッグで開く** —— ファイルやフォルダー全体をウィンドウへドロップ可能。
- **削除 = ごみ箱** —— 削除は常に `shell.trashItem` 経由でごみ箱へ。直接消すことはありません。
- **完全オフライン** —— ネットワーク通信なし、テレメトリなし、データ収集なし。オフラインで動作します。

## スクリーンショット

| 表示（ライト） | 表示（ダーク） |
|---|---|
| ![表示](docs/screenshots/01-view.png) | ![ダーク](docs/screenshots/02-view-dark.png) |

| フォルダー管理 | CDR ベクトル描画 |
|---|---|
| ![管理](docs/screenshots/03-manage.png) | ![CDR](docs/screenshots/04-cdr.png) |

![設定](docs/screenshots/05-settings.png)

> スクリーンショットは実際のアプリから取得。デザイン案とアーキテクチャ文書は [`design/`](design/) フォルダーにあります。

## 対応形式

| 形式 | 処理方法 | 備考 |
|---|---|---|
| JPG / JPEG | ネイティブデコード | Chromium デコーダー |
| PNG / APNG | ネイティブデコード | 透過・アニメーション対応 |
| WebP | ネイティブデコード | アニメーション対応 |
| GIF | ネイティブデコード | アニメーション対応 |
| BMP / ICO | ネイティブデコード | — |
| AVIF | ネイティブデコード | — |
| SVG | ネイティブデコード | ベクトル、無劣化拡大 |
| TIFF / TIF | ローカルデコード（内蔵） | 非圧縮 / LZW / Deflate / PackBits に対応。JPEG 圧縮 TIFF は非対応 |
| PSD / PSB | 埋め込みプレビュー抽出 | 「最大限の互換性」を有効にして保存したファイルが必要 |
| **CDR / CMX** | プレビュー + libcdr フルベクトル | 埋め込みプレビューがない場合のみベクトルエンジンへフォールバック |
| **DWG / DXF** | LibreDWG ベクトル解析 | レイヤー・文字・ブロック参照対応。DXF は gb18030 / Big5 / UTF-16 を自動判定する純 JS パーサー |
| HEIC / HEIF | 埋め込みプレビュー抽出 | JPEG プレビューを含むファイルのみ |
| CR2 / CR3 / NEF / ARW / DNG など RAW | 埋め込み JPEG プレビュー抽出 | 主要なカメラ機種 |

未対応：PDF、AI、EPS、EXR、TGA、JXL（必要なら issue をどうぞ）。

## キーボードショートカット

| キー | 動作 | キー | 動作 |
|---|---|---|---|
| `←` / `→` | 前へ / 次へ | `C` | 切り抜きモード |
| `スペース` | スライドショー切替 | `Enter` | 切り抜きを適用 |
| `+` / `-` | 拡大 / 縮小 | `Esc` | 切り抜き / スライドショーを終了 |
| `F` | ウィンドウに合わせる | `L` | ルーペ |
| `Ctrl+1` | 実ピクセル 1:1 | `,` / `.` | 左 / 右に 90° 回転 |
| `Ctrl+ホイール` | ズーム | `H` / `V` | 水平 / 垂直反転 |
| `Ctrl+O` | 画像を開く | `Del` | ごみ箱へ削除 |
| `Ctrl+S` | 名前を付けて保存 | `Ctrl+D` | テーマ切替 |
| `1` / `2` / `3` / `4` | 画面切替（表示 / 管理 / 比較 / 一括） | | |

## ソースからのビルド

```bash
# 前提：Node.js 18+（20/22 推奨）、Windows
git clone https://github.com/mollyneko/RatImgViewer.git
cd RatImgViewer
npm install

npm start              # 開発モードで実行
npm run smoke          # ヘッドレステスト
npm run dist           # パッケージ：NSIS インストーラー + ポータブル → dist/
npm run dist:portable  # ポータブルのみ
npm run dist:dir       # 非パッケージフォルダのみ（デバッグ用）
```

### リポジトリ内の事前ビルドバイナリ

`vendor/` には同梱の事前ビルド成果物があり、メインの依存ツリーには**含まれません**。clone するだけでそのまま使えます：

```
vendor/cdr2svg/         # CDR ベクトル変換ツール（約 44 MB）
                        #   cdr2svg.exe + libcdr / librevenge / ICU / lcms2 などのランタイム
                        #   libcdr 0.1.9 + librevenge を MSYS2 mingw-w64 でスタンドアロンプロセスとして構築
vendor/libredwg-web/    # DWG/DXF 解析エンジン（約 10 MB）
                        #   @mlightcad/libredwg-web 0.7.10（LibreDWG の WASM 版）
```

設計上の 2 つの重要なトレードオフ：

1. **CDR は N-API プラグインではなく別プロセス** —— ベクトルパーサーが不正なファイルでクラッシュするのは日常茶飯事。別プロセスならクラッシュ分離 + 30 秒タイムアウト + `パス + mtime + size + ページ` をキーとする結果キャッシュが効く。最悪でもその 1 枚が描画失敗するだけで、ビューアー自体は落ちません。
2. **DWG は WASM をプロセス内で実行** —— 図面は比較的規則的で、プロセス内なら IPC オーバーヘッドが不要。`.dxf` は（ゼロ依存の）純 JS テキストパーサーを使い、WASM より速く、エンコーディングもきれいに処理します。

### プロジェクト構成

```
src/
  main/                    # メインプロセス
    main.js                #   エントリ、ウィンドウ、IPC、ratfile:// カスタムプロトコル
    preload.js             #   contextBridge セーフブリッジ
    scanner.js             #   フォルダースキャンとプリフェッチ
    exif.js                #   EXIF 解析
    preview.js             #   埋め込みプレビュー抽出（PSD/HEIC/RAW/CDR）
    tiff.js                #   TIFF デコーダ（LZW/Deflate/PackBits）
    cache.js               #   ディスクキャッシュ
    assoc.js               #   ファイル関連付け登録（HKCU）
    cdr.js                 #   CDR 変換プロセススケジューラ
    dwg.js                 #   DWG/DXF スケジューラ + SVG 生成
    dwg-parser.js          #   DWG → 統一ジオメトリバケツ（WASM）
    dxf-parser.js          #   DXF → 統一ジオメトリバケツ（純 JS）
  renderer/                # レンダラー（プレーンな HTML/CSS/JS、フレームワークなし）
    index.html
    styles.css
    app.js
  design/                  # インタラクション案と技術アーキテクチャ文書
  build/                   # アイコン、NSIS インストールスクリプト
  tools/                   # ツールチェーンチェック、スモークテスト、リリーススクリプト
```

**なぜレンダラーに React/Vue を使わないか**：5 画面の単一ウィンドウアプリで、DOM はほぼ静的、状態も単純（現在のファイル + ズーム + 調整パラメータ）だからです。生 JS を書くことでビルドステップ不要、フレームワークの重みゼロ、そして再描画タイミングを完全に制御できます —— 「ページ送りを 16 ms 内に収める」という目標に直結します。

### 技術スタック

Electron 33 · プレーン HTML/CSS/JS（レンダラーはフレームワークなし）· libcdr 0.1.9 + librevenge（CDR/CMX）· LibreDWG via WebAssembly（DWG/DXF）· ビットマップは `SharedArrayBuffer` でゼロコピーにレンダラーへ渡します。

アーキテクチャの詳細、パフォーマンス目標、トレードオフの記録は [`design/architecture.html`](design/architecture.html) を参照。

## 既知の制限

- Windows のみ。レンダラー自体はクロスプラットフォームですが、ファイルの関連付け・CDR 変換ツール・パッケージングが Win32 に依存しています。
- インストーラーは未署名のため、初回に SmartScreen が表示されます（上記参照）。
- 埋め込みプレビューのある CDR/CMX は**そのプレビューを保持し、ベクトルには差し替えません**：一部のファイルでは libcdr が埋め込みビットマップをページ外に出し、白文字は明るい背景で見づらくなるため、差し替えは逆行します。埋め込みプレビューのない CDR のみベクトルエンジンを使います。
- カメラ RAW は埋め込み JPEG プレビューのみを読み、完全な RAW デコードはしません（閲覧には十分。画質重視なら Lightroom を）。
- CDR / DWG などのベクトル図面にはヒストグラムが表示できません：ブラウザは canvas に描いた SVG からのピクセル読み戻しを禁止している（悪意ある SVG の情報漏えい防止）ため、ヒストグラム欄には「ピクセルを読み取れません」と表示します。ラスター形式は影響なし。
- PDF / AI / EPS は未対応。

## サードパーティコンポーネントとライセンス

本プロジェクトの**独自コード**は [MIT ライセンス](LICENSE) で公開されています。同梱のサードパーティコンポーネントは各々のライセンスに従います：

| コンポーネント | ライセンス | 用途 |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | アプリのランタイム |
| [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) | MPL-2.0 | CDR / CMX ベクトル解析 |
| [ICU](https://icu.unicode.org/) | Unicode License | 文字セットとエンコーディング変換 |
| [lcms2](https://github.com/mm2/Little-CMS) | MIT | カラーマネジメント |
| [zlib](https://zlib.net/) | zlib License | 圧縮 |
| [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) ／ [LibreDWG](https://www.gnu.org/software/libredwg/) | GPL-3.0 | DWG / DXF 解析 |

> ⚠️ **ご注意**：`libredwg-web` およびそのベースの LibreDWG は **GPL-3.0** です。つまり配布パッケージには MIT コードと GPL-3.0 コンポーネントが混在しており、いわば混合配布となります。派生版を再配布・商用利用する場合は、DWG/DXF モジュールを置き換える必要があるか、GPL-3.0 の要件に従う必要があるかを確認してください。著者は利用者のコンプライアンス判断に対して責任を負いません。

## 謝辞

- [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) — CDR/CMX の解析はこれら次第。
- [LibreDWG](https://www.gnu.org/software/libredwg/) と [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) — DWG/DXF エンジン。
- [Electron](https://github.com/electron/electron) チーム。

## ライセンス

[MIT](LICENSE) © 2026 Rat (mollyneko)

---

# 한국어

## RatViewer 소개

순수한 이미지 뷰어입니다. 레이어도 없고 필터 곡선도 없으며 Photoshop이 되려고 하지도 않습니다. 하는 일은 딱 하나입니다: **이미지를 열어 빠르게 보여주는 것**.

다른 뷰어가 못 여는 것들을 여는 것이 특징입니다:

- **CDR / CMX**(CorelDRAW) — 내장된 libcdr 벡터 엔진으로 CorelDRAW를 설치하지 않아도 보고, 폰트 의존성도 없고 번짐도 없습니다.
- **DWG / DXF**(CAD 도면) — LibreDWG 내장. AutoCAD 없이 CAD 파일을 읽습니다.
- **PSD / PSB, HEIC, 카메라 RAW** — 내장 프리뷰를 꺼내 즉시 열고, 전체 파싱을 기다리지 않습니다. TIFF는 내장 디코더로 직접 디코딩합니다.

## 다운로드 및 설치

최신 빌드(Windows 10 / 11, 64비트)는 **[Releases 페이지](https://github.com/mollyneko/RatImgViewer/releases/latest)** 에서 받으세요:

| 파일 | 종류 | 대상 |
|---|---|---|
| **[RatViewer-Setup-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.2.exe)** | 설치 프로그램(NSIS) | 일상 사용. 설치 폴더 선택, 바탕화면/시작 메뉴 바로가기 생성, 파일 연결 등록 지원. |
| **[RatViewer-Portable-V1.0.2.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.2.exe)** | 이식형(단일 파일) | USB에 넣고 휴대. 더블클릭으로 실행, 레지스트리 기록 없음, 흔적 없음. |

> **"게시자 알 수 없음" 경고에 대하여**
> 설치 프로그램은 코드 서명이 되어 있지 않습니다(EV 인증서는 저렴하지 않습니다). 첫 실행 시 Windows SmartScreen이 "PC를 보호했습니다"라고 띄웁니다. "자세히 알아보기" → "실행"을 누르세요. 신경 쓰인다면 [소스에서 빌드](#소스에서-빌드)할 수도 있습니다. Releases 페이지에는 `SHA256SUMS.txt`도 있어 `certutil -hashfile <파일> SHA256`로 무결성을 확인할 수 있습니다.

**시스템 요구 사항**: Windows 10 1809 이상 / Windows 11, x64. .NET·런타임·코덱 설치 불필요.

## 주요 기능

### 보기

| | |
|---|---|
| **빠른 페이지 넘김** | 좌우 화살표, 도구 모음 버튼, 하단 필름스트립. 썸네일은 디스크에 캐시되어 다시 열 때 거의 즉시. |
| **확대/축소** | 휠(커서 기준), 창 맞춤, 1:1 실제 픽셀, 드래그로 이동. |
| **탭** | 한 창에 여러 탭. 각 탭은 자신의 폴더와 위치를 기억해 서로 간섭하지 않습니다. |
| **슬라이드 쇼** | 스페이스바로 시작/정지. 간격은 설정에서 변경 가능. |
| **돋보기** | `L`로 커서를 따르는 루페를 켜 세부 내용을 확인. |
| **정보 패널** | 크기, 용량, 형식, 디코드 시간, EXIF(카메라/렌즈/조리개/셔터/ISO), RGB 히스토그램. |

### 형식 지원 및 디코드 전략

3계층: **네이티브 디코드** → **내장 프리뷰 추출** → **벡터 엔진**. 방침은 "열 수 있으면 즉시" — PSD를 보려고 파일 전체를 분석하지 않습니다.

### 가벼운 보정(비파괴)

- **회전 / 반전** —— EXIF Orientation과 사이드카 기록만 씁니다. 원본 픽셀은 단 1바이트도 건드리지 않습니다.
- **자르기** —— 사각형 파라미터를 보관하므로 언제든 되돌릴 수 있습니다. 적용할 때만 새 파일로 저장.
- **밝기 / 대비 / 채도 / 원터치 보정** —— 딱 네 개의 슬라이더뿐. 실시간 미리보기, 내보낼 때 반영.
- 디스크에 남기려면 항상 "다른 이름으로 저장". 원본은 늘 안전합니다.

### 관리 · 비교 · 일괄 변환

- **관리** —— 폴더 전체를 썸네일 격자로 표시. 썸네일 크기 조절, 디스크 캐시로 재오픈이 빠름. 파일 이름으로 필터링도 가능.
- **비교** —— 좌우 나란히 + 드래그 가능한 구분선. 차이(수정 전후, 두 버전)를 찾기 좋습니다.
- **일괄 변환** —— 형식 변환(JPEG / PNG / WebP), 품질 설정, 긴 쪽 길이 제한, 파일별 진행률과 상태 표시(벡터 형식은 자동 제외).

### 시스템 연동

- **파일 연결** —— 한 번의 클릭으로 후보 뷰어로 등록. 다만 Microsoft 규칙상 앱이 스스로를 기본 열기 프로그램으로 **조용히 지정할 수 없습니다**(UserChoice 레지스트리 키는 변조 방지됨). 올바른 순서: 이 앱이 후보 등록 → 시스템 "기본 앱"에서 한 번 클릭해 확정.
- **더블클릭 / 드래그로 열기** —— 파일이나 폴더 전체를 창에 끌어다 놓기 가능.
- **삭제 = 휴지통** —— 삭제는 항상 `shell.trashItem`을 거쳐 휴지통으로. 바로 지우지 않습니다.
- **완전 오프라인** —— 네트워크 요청 없음, 원격 측정 없음, 데이터 수집 없음. 오프라인으로 동작.

## 스크린샷

| 보기(라이트) | 보기(다크) |
|---|---|
| ![보기](docs/screenshots/01-view.png) | ![다크](docs/screenshots/02-view-dark.png) |

| 폴더 관리 | CDR 벡터 렌더링 |
|---|---|
| ![관리](docs/screenshots/03-manage.png) | ![CDR](docs/screenshots/04-cdr.png) |

![설정](docs/screenshots/05-settings.png)

> 스크린샷은 실제 앱에서 캡처했습니다. 디자인 초안과 아키텍처 문서는 [`design/`](design/) 폴더에 있습니다.

## 지원 형식

| 형식 | 처리 방식 | 비고 |
|---|---|---|
| JPG / JPEG | 네이티브 디코드 | Chromium 디코더 |
| PNG / APNG | 네이티브 디코드 | 투명·애니메이션 지원 |
| WebP | 네이티브 디코드 | 애니메이션 지원 |
| GIF | 네이티브 디코드 | 애니메이션 지원 |
| BMP / ICO | 네이티브 디코드 | — |
| AVIF | 네이티브 디코드 | — |
| SVG | 네이티브 디코드 | 벡터, 손실 없이 확대 |
| TIFF / TIF | 로컬 디코딩(내장) | 비압축 / LZW / Deflate / PackBits 지원. JPEG 압축 TIFF는 미지원 |
| PSD / PSB | 내장 프리뷰 추출 | "최대 호환성" 옵션으로 저장된 파일 필요 |
| **CDR / CMX** | 프리뷰 + libcdr 전체 벡터 | 내장 프리뷰가 없을 때만 벡터 엔진으로 폴백 |
| **DWG / DXF** | LibreDWG 벡터 파싱 | 레이어·문자·블록 참조 지원. DXF는 gb18030 / Big5 / UTF-16을 자동 판별하는 순수 JS 파서 |
| HEIC / HEIF | 내장 프리뷰 추출 | JPEG 프리뷰가 들어 있는 파일만 가능 |
| CR2 / CR3 / NEF / ARW / DNG 등 RAW | 내장 JPEG 프리뷰 추출 | 주요 카메라 기종 |

미지원: PDF, AI, EPS, EXR, TGA, JXL(필요하면 이슈를 주세요).

## 키보드 단축키

| 키 | 동작 | 키 | 동작 |
|---|---|---|---|
| `←` / `→` | 이전 / 다음 | `C` | 자르기 모드 |
| `스페이스` | 슬라이드 쇼 켜기/끄기 | `Enter` | 자르기 적용 |
| `+` / `-` | 확대 / 축소 | `Esc` | 자르기 / 슬라이드 쇼 종료 |
| `F` | 창 맞춤 | `L` | 돋보기 |
| `Ctrl+1` | 실제 픽셀 1:1 | `,` / `.` | 왼쪽 / 오른쪽으로 90° 회전 |
| `Ctrl+휠` | 확대/축소 | `H` / `V` | 가로 / 세로 반전 |
| `Ctrl+O` | 이미지 열기 | `Del` | 휴지통으로 삭제 |
| `Ctrl+S` | 다른 이름으로 저장 | `Ctrl+D` | 테마 전환 |
| `1` / `2` / `3` / `4` | 화면 전환(보기 / 관리 / 비교 / 일괄) | | |

## 소스에서 빌드

```bash
# 사전 조건: Node.js 18+(20/22 권장), Windows
git clone https://github.com/mollyneko/RatImgViewer.git
cd RatImgViewer
npm install

npm start              # 개발 모드로 실행
npm run smoke          # 헤드리스 자가 점검
npm run dist           # 패키징: NSIS 설치 프로그램 + 이식형 → dist/
npm run dist:portable  # 이식형만
npm run dist:dir       # 비패키징 폴더만(디버그용)
```

### 저장소의 사전 빌드 바이너리

`vendor/`에는 패키지와 함께 배포되는 사전 빌드 산출물이 있으며, 메인 의존성 트리에는 **포함되지 않습니다**. clone하면 바로 쓸 수 있습니다:

```
vendor/cdr2svg/         # CDR 벡터 변환기(약 44 MB)
                        #   cdr2svg.exe + libcdr / librevenge / ICU / lcms2 등 런타임
                        #   libcdr 0.1.9 + librevenge를 MSYS2 mingw-w64로 독립 프로세스로 빌드
vendor/libredwg-web/    # DWG/DXF 파싱 엔진(약 10 MB)
                        #   @mlightcad/libredwg-web 0.7.10(LibreDWG의 WASM 버전)
```

설계상 두 가지 핵심 트레이드오프:

1. **CDR은 N-API 플러그인이 아닌 별도 프로세스** —— 벡터 파서는 손상된 파일에서 크래시하는 것이 일상적입니다. 별도 프로세스는 크래시 격리 + 30초 타임아웃 + `경로 + mtime + size + 페이지`를 키로 하는 결과 캐시를 가능하게 합니다. 최악의 경우 그 한 장만 렌더링에 실패할 뿐, 뷰어 자체는 살아남습니다.
2. **DWG는 WASM을 프로세스 내에서 실행** —— 도면은 비교적 규칙적이라 프로세스 내 호출이 IPC 오버헤드를 없앱니다. `.dxf`는 (의존성 없는) 순수 JS 텍스트 파서를 써 WASM보다 빠르고 인코딩도 깔끔하게 처리합니다.

### 프로젝트 구조

```
src/
  main/                    # 메인 프로세스
    main.js                #   진입점, 창, IPC, ratfile:// 사용자 정의 프로토콜
    preload.js             #   contextBridge 안전 브리지
    scanner.js             #   폴더 스캔 및 프리페치
    exif.js                #   EXIF 파싱
    preview.js             #   내장 프리뷰 추출(PSD/HEIC/RAW/CDR)
    tiff.js                #   TIFF 디코더(LZW/Deflate/PackBits)
    cache.js               #   디스크 캐시
    assoc.js               #   파일 연결 등록(HKCU)
    cdr.js                 #   CDR 변환 프로세스 스케줄러
    dwg.js                 #   DWG/DXF 스케줄러 + SVG 생성
    dwg-parser.js          #   DWG → 통합 지오메트리 버킷(WASM)
    dxf-parser.js          #   DXF → 통합 지오메트리 버킷(순수 JS)
  renderer/                # 렌더러(프레임워크 없는 일반 HTML/CSS/JS)
    index.html
    styles.css
    app.js
  design/                  # 인터랙션 초안 및 기술 아키텍처 문서
  build/                   # 아이콘, NSIS 설치 스크립트
  tools/                   # 도구 체인 검증, 스모크 테스트, 릴리스 스크립트
```

**왜 렌더러에 React/Vue를 쓰지 않는가**: 5화면 단일 창 앱으로 DOM은 거의 정적이고 상태도 단순(현재 파일 + 확대 + 보정 파라미터)하기 때문입니다. 순수 JS를 쓰면 빌드 단계 불필요, 프레임워크 무게 제로, 그리고 재도화 타이밍을 완전히 제어할 수 있습니다 —— "페이지 넘김을 16ms 안에"라는 목표에 직결됩니다.

### 기술 스택

Electron 33 · 프레임워크 없는 일반 HTML/CSS/JS(렌더러)· libcdr 0.1.9 + librevenge(CDR/CMX)· LibreDWG via WebAssembly(DWG/DXF)· 비트맵은 `SharedArrayBuffer`로 제로 카피하여 렌더러에 전달.

아키텍처 세부사항, 성능 목표, 트레이드오프 기록은 [`design/architecture.html`](design/architecture.html)을 참고하세요.

## 알려진 제한

- Windows만 지원. 렌더러 자체는 크로스 플랫폼이지만 파일 연결, CDR 변환기, 패키징이 Win32에 묶여 있습니다.
- 설치 프로그램은 미서명이라 첫 실행 시 SmartScreen이 뜹니다(위 참조).
- 내장 프리뷰가 있는 CDR/CMX는 **그 프리뷰를 유지하고 벡터로 교체하지 않습니다**: 일부 파일에서 libcdr이 내장 비트맵을 페이지 밖으로 빼내고, 흰 글자는 밝은 배경에서 잘 안 보이므로 교체는 오히려 퇴보입니다. 내장 프리뷰가 없는 CDR만 벡터 엔진을 씁니다.
- 카메라 RAW는 내장 JPEG 프리뷰만 읽고 전체 RAW 디코드는 하지 않습니다(보기에 충분. 화질을 원하면 Lightroom).
- CDR / DWG 같은 벡터 도면은 히스토그램을 표시할 수 없습니다: 브라우저는 canvas에 그린 SVG에서 픽셀을 다시 읽어오는 것을 금지합니다(악의적 SVG의 정보 유출 방지). 그래서 벡터의 히스토그램 칸에는 "픽셀을 읽을 수 없음"이 표시됩니다. 래스터 형식은 영향 없음.
- PDF / AI / EPS는 미지원.

## 서드파티 구성 요소 및 라이선스

이 프로젝트의 **고유 코드**는 [MIT 라이선스](LICENSE)로 배포됩니다. 함께 배포되는 서드파티 구성 요소는 각자의 라이선스를 따릅니다:

| 구성 요소 | 라이선스 | 용도 |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | 앱 런타임 |
| [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) | MPL-2.0 | CDR / CMX 벡터 파싱 |
| [ICU](https://icu.unicode.org/) | Unicode License | 문자 집합 및 인코딩 변환 |
| [lcms2](https://github.com/mm2/Little-CMS) | MIT | 색상 관리 |
| [zlib](https://zlib.net/) | zlib License | 압축 |
| [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) ／ [LibreDWG](https://www.gnu.org/software/libredwg/) | GPL-3.0 | DWG / DXF 파싱 |

> ⚠️ **주의**: `libredwg-web`과 그 기반인 LibreDWG는 **GPL-3.0**입니다. 즉 배포 패키지에는 MIT 코드와 GPL-3.0 구성 요소가 섞여 있어 이른바 혼합 배포가 됩니다. 파생물을 재배포하거나 상용으로 쓰려면 DWG/DXF 모듈을 교체해야 하는지, 아니면 GPL-3.0 요건을 따라야 하는지 먼저 확인하세요. 저자는 사용자의 컴플라이언스 결정에 책임을 지지 않습니다.

## 감사의 말

- [libcdr](https://git.libreoffice.org/libcdr) / [librevenge](https://sourceforge.net/projects/librevenge/) — CDR/CMX 파싱은 전적으로 이들 덕분.
- [LibreDWG](https://www.gnu.org/software/libredwg/)와 [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) — DWG/DXF 엔진.
- [Electron](https://github.com/electron/electron) 팀.

## 라이선스

[MIT](LICENSE) © 2026 Rat (mollyneko)
