@echo off
REM ----------------------------------------------------------------------------
REM  RatViewer — generate English README screenshots
REM  Run this by DOUBLE-CLICKING it inside your interactive Windows desktop
REM  (RDP session). It drives the built app's screenshot probe (RAT_PROBE_*)
REM  five times and writes the PNGs into docs/screenshots/.
REM
REM  Prereqs:
REM   - dist\win-unpacked\RatViewer.exe must exist (run: npm run dist)
REM   - RatViewer\settings.json must have "language": "en"  (already set)
REM   - The app renders offscreen (show:false) and exits on its own after
REM     each capture, so you will NOT see a window flash.
REM ----------------------------------------------------------------------------
setlocal
set EXE=D:\gitea\img-viewer\dist\win-unpacked\RatViewer.exe
set SAMP=D:\gitea\img-viewer\.workbuddy\shot-samples
set CDR=D:\gitea\img-viewer\.workbuddy\fmt-test\cdr-samples\demo.cdr
set OUT=D:\gitea\img-viewer\docs\screenshots
set P=D:\gitea\img-viewer\.workbuddy

if not exist "%EXE%" (
  echo ERROR: %EXE% not found. Run "npm run dist" first.
  pause
  exit /b 1
)

echo [1/5] view (light) ...
set RAT_WINDOW_PROBE=%P%\p1.json
set RAT_PROBE_FILE=%SAMP%
set RAT_PROBE_SHOT=%OUT%\01-view.png
set RAT_PROBE_STAGE_WAIT=6000
"%EXE%"
if exist "%P%\p1.json" del /q "%P%\p1.json"

echo [2/5] view (dark) ...
set RAT_WINDOW_PROBE=%P%\p2.json
set RAT_PROBE_FILE=%SAMP%
set RAT_PROBE_SHOT=%OUT%\02-view-dark.png
set RAT_PROBE_THEME=dark
set RAT_PROBE_STAGE_WAIT=6000
"%EXE%"
set RAT_PROBE_THEME=
if exist "%P%\p2.json" del /q "%P%\p2.json"

echo [3/5] manage ...
set RAT_WINDOW_PROBE=%P%\p3.json
set RAT_PROBE_FILE=%SAMP%
set RAT_PROBE_SHOT=%OUT%\03-manage.png
set RAT_PROBE_SCREEN=manage
set RAT_PROBE_STAGE_WAIT=6000
"%EXE%"
set RAT_PROBE_SCREEN=
if exist "%P%\p3.json" del /q "%P%\p3.json"

echo [4/5] cdr (vector) ...
set RAT_WINDOW_PROBE=%P%\p4.json
set RAT_PROBE_FILE=%CDR%
set RAT_PROBE_SHOT=%OUT%\04-cdr.png
set RAT_PROBE_STAGE_WAIT=12000
"%EXE%"
if exist "%P%\p4.json" del /q "%P%\p4.json"

echo [5/5] settings ...
set RAT_WINDOW_PROBE=%P%\p5.json
set RAT_PROBE_FILE=%SAMP%
set RAT_PROBE_SHOT=%OUT%\05-settings.png
set RAT_PROBE_SCREEN=settings
set RAT_PROBE_STAGE_WAIT=6000
"%EXE%"
set RAT_PROBE_SCREEN=
if exist "%P%\p5.json" del /q "%P%\p5.json"

echo.
echo Done. Screenshots written to:
echo   %OUT%
dir "%OUT%\0*.png"
pause
