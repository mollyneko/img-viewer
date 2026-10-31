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


---

**[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)**

---
## What it is

A pure image viewer. No layers, no filter curves, no attempt to become Photoshop — it does exactly one thing: **open your image and show it, fast.**

What makes it different is the stuff other viewers can't open:

- **CDR / CMX** (CorelDRAW) — a built-in libcdr vector engine, so you can view them without CorelDRAW installed, with no font dependency and no blur. The embedded preview is shown first and then hot-swapped to real vectors, with millimetre coordinates, a two-point measure tool, window zoom and page navigation for multi-page documents.
- **DWG / DXF** (CAD drawings) — LibreDWG built in, so you can read CAD files without AutoCAD. Drawings render as real vectors with hatches, line types and line weights, plus a layer tree you can toggle, on-canvas coordinates, a two-point measure tool and window zoom.
- **PSD / PSB, HEIC, camera RAW** — it pulls the embedded preview and opens instantly, without waiting for a full parse. TIFF is decoded in-app instead, so plain scans open too.

## Download & install

Grab the latest build (Windows 10 / 11, 64-bit) from the **[Releases page](https://github.com/mollyneko/RatImgViewer/releases/latest)**:

| File | Type | For |
|---|---|---|
| **[RatViewer-Setup-V1.0.6.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.6.exe)** | Installer (NSIS) | Everyday use. Choose the install folder, create desktop/start-menu shortcuts, and register file associations. |
| **[RatViewer-Portable-V1.0.6.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.6.exe)** | Portable (single file) | Carry it on a USB stick — double-click to run, no registry writes, no leftovers. |

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
| **CDR / CMX** | libcdr vector (preview shown first) | Embedded preview appears instantly, then swaps to vectors; mm coordinates, measure, window zoom, page navigation; no layer tree (libcdr's SVG output is flat) |
| **DWG / DXF** | LibreDWG vector parse | Hatches (solid + pattern, multi-definition lines), line types, line weights, layers with toggle/solo, coordinates, measure, window zoom; DXF uses a pure-JS parser that auto-detects gb18030 / Big5 / UTF-16 encoding |
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
- CDR/CMX always upgrade to vectors: the embedded preview is only a placeholder shown while libcdr converts in the background. On some files libcdr moves embedded bitmaps out of the page or drops fonts/gradients, so if a drawing looks wrong in vector mode, that's a libcdr limitation rather than a rendering bug.
- Vector images (DWG / DXF) have no histogram: browsers forbid reading pixels back from an SVG drawn to a canvas (a malicious-SVG information-leak guard), so the histogram area shows "pixels unavailable." CDR/CMX still have a histogram because it's built from the embedded preview. Raster formats are unaffected.
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

