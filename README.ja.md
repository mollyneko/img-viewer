<div align="center">

# RatViewer

[![Download](https://img.shields.io/github/v/release/mollyneko/RatImgViewer?label=Download&color=2ea043&style=for-the-badge)](https://github.com/mollyneko/RatImgViewer/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/mollyneko/RatImgViewer/total?style=for-the-badge&color=0969da)](https://github.com/mollyneko/RatImgViewer/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d4?style=for-the-badge)](#download--install)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#license)

</div>

---

**[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)**

---
# 日本語

## RatViewer について

純粋な画像ビューアーです。レイヤーもフィルターカーブもなく、Photoshop になるつもりもありません。やることはただ一つ：**画像を開いて素早く表示する**こと。

他のビューアーが開けないものを開けるのが特徴です：

- **CDR / CMX**（CorelDRAW）—— 内蔵の libcdr ベクトルエンジンで、CorelDRAW をインストールせずに表示可能。フォント依存なし、にじみなし。埋め込みプレビューを先に出し、その後に本物のベクトルへ差し替えます。ミリ単位の座標、2 点間の距離測定、範囲ズーム、複数ページのページ送りに対応。
- **DWG / DXF**（CAD 図面）—— LibreDWG を内蔵。AutoCAD なしで CAD ファイルを読めます。実際のベクトルとして描画し、ハッチング・線種・線幅にも対応。レイヤーツリーの表示切替／単独表示、カーソル座標、2 点間の距離測定、ウィンドウズームも使えます。
- **PSD / PSB、HEIC、カメラ RAW** —— 埋め込みプレビューを取り出して即座に開き、全体の解析を待ちません。TIFF は内蔵デコーダで直接デコードします。

## ダウンロードとインストール

最新版（Windows 10 / 11、64 ビット）は **[Releases ページ](https://github.com/mollyneko/RatImgViewer/releases/latest)** から取得してください：

| ファイル | 種類 | 向いている人 |
|---|---|---|
| **[RatViewer-Setup-V1.0.6.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.6.exe)** | インストーラー（NSIS） | 日常利用。インストール先の選択、デスクトップ/スタートメニューのショートカット作成、ファイルの関連付けに対応。 |
| **[RatViewer-Portable-V1.0.6.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.6.exe)** | ポータブル（単一ファイル） | USB メモリに入れて持ち運び。ダブルクリックで実行、レジストリ書き込みなし、跡残しなし。 |

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
| **CDR / CMX** | libcdr ベクトル（プレビュー先出し） | 埋め込みプレビューで即表示し、その後ベクトルへ差し替え。ミリ座標・距離測定・範囲ズーム・ページ送り対応。レイヤーツリーなし（libcdr の SVG 出力はフラット） |
| **DWG / DXF** | LibreDWG ベクトル解析 | ハッチング（ソリッド＋パターン、複数方向の定義線）、線種、線幅、レイヤーの表示切替／単独表示、座標、測定、ウィンドウズームに対応。DXF は gb18030 / Big5 / UTF-16 を自動判定する純 JS パーサー |
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
- CDR/CMX は常にベクトルへ昇格します：埋め込みプレビューはプレースホルダーで、libcdr の変換が終わると差し替わります。一部のファイルでは libcdr が埋め込みビットマップをページ外に出したり、フォントやグラデーションを落としたりします。ベクトル表示がおかしい場合は libcdr の解析限界であり、レンダリングの不具合ではありません。
- カメラ RAW は埋め込み JPEG プレビューのみを読み、完全な RAW デコードはしません（閲覧には十分。画質重視なら Lightroom を）。
- DWG / DXF などのベクトル図面にはヒストグラムが表示できません：ブラウザは canvas に描いた SVG からのピクセル読み戻しを禁止している（悪意ある SVG の情報漏えい防止）ため、ヒストグラム欄には「ピクセルを読み取れません」と表示します。CDR/CMX は埋め込みプレビューからヒストグラムを作れるため表示できます。ラスター形式は影響なし。
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

