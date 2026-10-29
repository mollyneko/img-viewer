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
# 한국어

## RatViewer 소개

순수한 이미지 뷰어입니다. 레이어도 없고 필터 곡선도 없으며 Photoshop이 되려고 하지도 않습니다. 하는 일은 딱 하나입니다: **이미지를 열어 빠르게 보여주는 것**.

다른 뷰어가 못 여는 것들을 여는 것이 특징입니다:

- **CDR / CMX**(CorelDRAW) — 내장된 libcdr 벡터 엔진으로 CorelDRAW를 설치하지 않아도 보고, 폰트 의존성도 없고 번짐도 없습니다. 내장 프리뷰를 먼저 보여준 뒤 실제 벡터로 교체하며, 밀리미터 좌표·두 점 거리 측정·범위 확대·여러 페이지 넘기기를 지원합니다.
- **DWG / DXF**(CAD 도면) — LibreDWG 내장. AutoCAD 없이 CAD 파일을 읽습니다. 실제 벡터로 그리며 해치·선종류·선가중치를 살리고, 레이어 트리 표시/숨김·단독 보기, 커서 좌표, 두 점 거리 측정, 창 확대까지 지원합니다.
- **PSD / PSB, HEIC, 카메라 RAW** — 내장 프리뷰를 꺼내 즉시 열고, 전체 파싱을 기다리지 않습니다. TIFF는 내장 디코더로 직접 디코딩합니다.

## 다운로드 및 설치

최신 빌드(Windows 10 / 11, 64비트)는 **[Releases 페이지](https://github.com/mollyneko/RatImgViewer/releases/latest)** 에서 받으세요:

| 파일 | 종류 | 대상 |
|---|---|---|
| **[RatViewer-Setup-V1.0.4.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Setup-V1.0.4.exe)** | 설치 프로그램(NSIS) | 일상 사용. 설치 폴더 선택, 바탕화면/시작 메뉴 바로가기 생성, 파일 연결 등록 지원. |
| **[RatViewer-Portable-V1.0.4.exe](https://github.com/mollyneko/RatImgViewer/releases/latest/download/RatViewer-Portable-V1.0.4.exe)** | 이식형(단일 파일) | USB에 넣고 휴대. 더블클릭으로 실행, 레지스트리 기록 없음, 흔적 없음. |

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
| **CDR / CMX** | libcdr 벡터(프리뷰 먼저 표시) | 내장 프리뷰로 즉시 표시한 뒤 벡터로 교체. 밀리미터 좌표·거리 측정·범위 확대·페이지 넘기기 지원. 레이어 트리 없음(libcdr의 SVG 출력은 평면) |
| **DWG / DXF** | LibreDWG 벡터 파싱 | 해치(솔리드+패턴, 다방향 정의선), 선종류, 선가중치, 레이어 표시/숨김·단독 보기, 좌표, 측정, 창 확대 지원. DXF는 gb18030 / Big5 / UTF-16을 자동 판별하는 순수 JS 파서 |
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
- CDR/CMX는 항상 벡터로 승격됩니다: 내장 프리뷰는 자리표시자일 뿐이고, libcdr 변환이 끝나면 교체됩니다. 일부 파일에서 libcdr이 내장 비트맵을 페이지 밖으로 빼내거나 폰트·그라디언트를 놓치기도 합니다. 벡터 화면이 이상하다면 libcdr의 해석 한계이지 렌더링 버그가 아닙니다.
- 카메라 RAW는 내장 JPEG 프리뷰만 읽고 전체 RAW 디코드는 하지 않습니다(보기에 충분. 화질을 원하면 Lightroom).
- DWG / DXF 같은 벡터 도면은 히스토그램을 표시할 수 없습니다: 브라우저는 canvas에 그린 SVG에서 픽셀을 다시 읽어오는 것을 금지합니다(악의적 SVG의 정보 유출 방지). 그래서 벡터의 히스토그램 칸에는 "픽셀을 읽을 수 없음"이 표시됩니다. CDR/CMX는 내장 프리뷰로 히스토그램을 만들 수 있어 표시됩니다. 래스터 형식은 영향 없음.
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
