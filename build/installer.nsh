; ============================================================================
; RatViewer — NSIS 安装钩子
;
; 关于「默认看图软件」：
;   Windows 8 之后，系统不允许任何程序**绕过用户**把默认打开方式改掉
;   （微软刻意封死，防止软件互相抢关联）。所以这里不偷偷改，而是在安装向导里
;   直接问用户一次 —— 这正是系统允许、也是最省事的做法。
;
;   用户勾选后：
;     · 还没有被系统/用户指定过打开方式的格式（CDR / PSD / DWG / RAW 等），
;       安装时直接写 HKCU\Software\Classes\.ext 生效，装完就能双击打开；
;     · 已被系统或用户选过的格式（JPG / PNG 等）有 UserChoice 保护，安装器
;       不会去抢，只留一个标记，让程序首次启动时把用户送到系统设置页确认一次。
;
;   全部写 HKCU，不需要管理员权限，也不会动别的程序已建立的默认关联。
; ============================================================================

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BST_CHECKED
  !define BST_CHECKED 1
!endif

; 注意：electron-builder 会把本文件拼接在 installer.nsi 的最前面，因此这里比
; MUI2.nsh 更早被处理 —— 不能用 LangString、${LANG_*} 这类需要 MUI 先加载的东西。
; 页面文案改成运行时按 $LANGUAGE 的数字 ID 选（1033 en / 2052 zh-CN / 1041 ja / 1042 ko）。

; 用户在向导里的选择："" 未询问 / "1" 要设为默认 / "0" 不设
; RAT_ASSOC_CHECK 在 preInit 里也会用到，必须无条件声明（卸载器构建同样会展开 preInit）
Var RAT_ASSOC_CHECK


; ---------------------------------------------------------------------------
; 「打开方式」候选登记：让程序出现在右键菜单和「默认应用」列表里
; ---------------------------------------------------------------------------
!macro RAT_OTW EXT
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "RatViewer.Image" ""
  WriteRegStr HKCU "Software\RatViewer\Capabilities\FileAssociations" "${EXT}" "RatViewer.Image"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend

; 接管「系统还没有记住选择」的格式：这类格式谁写默认值谁就是默认，立即生效。
; 已有 UserChoice 的格式一律跳过，绝不覆盖用户的既有选择。
!macro RAT_CLAIM EXT
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\UserChoice" "ProgId"
  ${If} $R0 == ""
    WriteRegStr HKCU "Software\Classes\${EXT}" "" "RatViewer.Image"
  ${EndIf}
!macroend

; 卸载时只回收「确实是我们写的」默认值
!macro RAT_UNCLAIM EXT
  ReadRegStr $R0 HKCU "Software\Classes\${EXT}" ""
  ${If} $R0 == "RatViewer.Image"
    DeleteRegValue HKCU "Software\Classes\${EXT}" ""
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; 安装前的选择页（在「选择安装位置」之后、开始安装之前）
; ---------------------------------------------------------------------------
!macro customPageAfterChangeDir
  Page custom ratAssocPageCreate ratAssocPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
; 只在安装器里用；卸载器构建时不声明，否则会触发 "never set" 警告
Var RAT_ASSOC_HWND

Function ratAssocPageCreate
  ; 按 $LANGUAGE 选文案（1033 en / 2052 zh-CN / 1041 ja / 1042 ko）
  StrCpy $R2 "Default image viewer"
  StrCpy $R3 "Make RatViewer your default image viewer?"
  StrCpy $R4 "Set RatViewer as the default image viewer (recommended)"
  StrCpy $R5 "Windows does not let a setup program change a default you already picked, so:$\r$\n  · Formats nothing has claimed yet (CDR / PSD / DWG / RAW …) become RatViewer right away.$\r$\n  · Formats Windows or you already chose (JPG / PNG …) open the system settings page on first launch — one click there confirms them.$\r$\nYou can change or undo this anytime in Settings > Apps > Default apps."
  ${If} $LANGUAGE == 2052
    StrCpy $R2 "默认看图软件"
    StrCpy $R3 "安装完成后，是否把 RatViewer 设为图片的默认看图软件？"
    StrCpy $R4 "将 RatViewer 设为图片的默认看图软件（推荐）"
    StrCpy $R5 "说明：Windows 不允许安装程序擅自改动你已有的默认选择，所以$\r$\n  · 还没指定过打开方式的格式（CDR / PSD / DWG / RAW 等）会立即设为 RatViewer；$\r$\n  · 已被系统或你选过的格式（JPG / PNG 等），装完首次启动时会打开系统设置页，$\r$\n    点一次「设为默认」即可。$\r$\n随时可以在「设置 → 应用 → 默认应用」里更改或撤销。"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $R2 "既定の画像ビューア"
    StrCpy $R3 "RatViewer を画像の既定のビューアに設定しますか？"
    StrCpy $R4 "RatViewer を画像の既定のビューアに設定する（推奨）"
    StrCpy $R5 "Windows は、既存の既定の関連付けをセットアッププログラムが変更することを許可しません。そのため：$\r$\n  · まだ関連付けがない形式（CDR / PSD / DWG / RAW など）はすぐに RatViewer に設定されます。$\r$\n  · すでにシステムやユーザーが選んだ形式（JPG / PNG など）は、初回起動時にシステム設定ページを開きます。そこで一度クリックして確定してください。$\r$\n「設定 > アプリ > 既定のアプリ」でいつでも変更・取り消しできます。"
  ${ElseIf} $LANGUAGE == 1042
    StrCpy $R2 "기본 이미지 뷰어"
    StrCpy $R3 "RatViewer를 이미지 기본 뷰어로 설정할까요?"
    StrCpy $R4 "RatViewer를 이미지 기본 뷰어로 설정 (권장)"
    StrCpy $R5 "Windows는 설치 프로그램이 이미 선택된 기본 연결을 변경하는 것을 허용하지 않습니다. 따라서:$\r$\n  · 아직 연결이 없는 형식(CDR / PSD / DWG / RAW 등)은 즉시 RatViewer로 설정됩니다.$\r$\n  · 시스템이나 사용자가 이미 선택한 형식(JPG / PNG 등)은 첫 실행 시 시스템 설정 페이지를 엽니다. 거기서 한 번 클릭하면 확정됩니다.$\r$\n「설정 > 앱 > 기본 앱」에서 언제든지 변경하거나 취소할 수 있습니다."
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "$R2"
  Pop $0

  ${NSD_CreateLabel} 0 16u 100% 18u "$R3"
  Pop $0

  ${NSD_CreateCheckbox} 0 38u 100% 12u "$R4"
  Pop $RAT_ASSOC_HWND
  ${If} $RAT_ASSOC_CHECK == "0"
    ${NSD_Uncheck} $RAT_ASSOC_HWND
  ${Else}
    ${NSD_Check} $RAT_ASSOC_HWND
  ${EndIf}

  ${NSD_CreateLabel} 0 58u 100% 50u "$R5"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function ratAssocPageLeave
  ${NSD_GetState} $RAT_ASSOC_HWND $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $RAT_ASSOC_CHECK "1"
  ${Else}
    StrCpy $RAT_ASSOC_CHECK "0"
  ${EndIf}
FunctionEnd
!endif

; 支持静默/批量部署：安装器 /S /defaultassoc 时按「设为默认」处理
!macro preInit
  ${GetParameters} $R0
  ${GetOptions} $R0 "/defaultassoc" $R1
  ${IfNot} ${Errors}
    StrCpy $RAT_ASSOC_CHECK "1"
  ${EndIf}
!macroend

!macro customInstall
  ; ---- ProgID ----
  WriteRegStr HKCU "Software\Classes\RatViewer.Image" "" "RatViewer Image"
  WriteRegStr HKCU "Software\Classes\RatViewer.Image\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\RatViewer.Image\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; ---- 出现在鼠标右键「打开方式」菜单 ----
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; ---- 出现在「默认应用」页面 ----
  WriteRegStr HKCU "Software\RatViewer\Capabilities" "ApplicationName" "RatViewer"
  WriteRegStr HKCU "Software\RatViewer\Capabilities" "ApplicationDescription" "Lightweight high-performance image viewer"
  WriteRegStr HKCU "Software\RatViewer\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\RegisteredApplications" "RatViewer" "Software\RatViewer\Capabilities"

  ; ---- 逐个扩展名登记为候选 ----
  !insertmacro RAT_OTW ".jpg"
  !insertmacro RAT_OTW ".jpeg"
  !insertmacro RAT_OTW ".jfif"
  !insertmacro RAT_OTW ".png"
  !insertmacro RAT_OTW ".apng"
  !insertmacro RAT_OTW ".webp"
  !insertmacro RAT_OTW ".gif"
  !insertmacro RAT_OTW ".bmp"
  !insertmacro RAT_OTW ".ico"
  !insertmacro RAT_OTW ".svg"
  !insertmacro RAT_OTW ".avif"
  !insertmacro RAT_OTW ".tif"
  !insertmacro RAT_OTW ".tiff"
  !insertmacro RAT_OTW ".cdr"
  !insertmacro RAT_OTW ".cmx"
  !insertmacro RAT_OTW ".psd"
  !insertmacro RAT_OTW ".psb"
  !insertmacro RAT_OTW ".heic"
  !insertmacro RAT_OTW ".heif"
  !insertmacro RAT_OTW ".dwg"
  !insertmacro RAT_OTW ".dxf"
  !insertmacro RAT_OTW ".cr2"
  !insertmacro RAT_OTW ".cr3"
  !insertmacro RAT_OTW ".crw"
  !insertmacro RAT_OTW ".nef"
  !insertmacro RAT_OTW ".nrw"
  !insertmacro RAT_OTW ".arw"
  !insertmacro RAT_OTW ".srf"
  !insertmacro RAT_OTW ".sr2"
  !insertmacro RAT_OTW ".dng"
  !insertmacro RAT_OTW ".orf"
  !insertmacro RAT_OTW ".rw2"
  !insertmacro RAT_OTW ".raf"
  !insertmacro RAT_OTW ".pef"
  !insertmacro RAT_OTW ".srw"
  !insertmacro RAT_OTW ".mrw"
  !insertmacro RAT_OTW ".x3f"

  ; ---- 用户在向导里勾选了「设为默认」----
  ${If} $RAT_ASSOC_CHECK == "1"
    ; 1) 没有主儿的格式立刻接管，装完双击就能用
    !insertmacro RAT_CLAIM ".jpg"
    !insertmacro RAT_CLAIM ".jpeg"
    !insertmacro RAT_CLAIM ".jfif"
    !insertmacro RAT_CLAIM ".png"
    !insertmacro RAT_CLAIM ".apng"
    !insertmacro RAT_CLAIM ".webp"
    !insertmacro RAT_CLAIM ".gif"
    !insertmacro RAT_CLAIM ".bmp"
    !insertmacro RAT_CLAIM ".ico"
    !insertmacro RAT_CLAIM ".svg"
    !insertmacro RAT_CLAIM ".avif"
    !insertmacro RAT_CLAIM ".tif"
    !insertmacro RAT_CLAIM ".tiff"
    !insertmacro RAT_CLAIM ".cdr"
    !insertmacro RAT_CLAIM ".cmx"
    !insertmacro RAT_CLAIM ".psd"
    !insertmacro RAT_CLAIM ".psb"
    !insertmacro RAT_CLAIM ".heic"
    !insertmacro RAT_CLAIM ".heif"
    !insertmacro RAT_CLAIM ".dwg"
    !insertmacro RAT_CLAIM ".dxf"
    !insertmacro RAT_CLAIM ".cr2"
    !insertmacro RAT_CLAIM ".cr3"
    !insertmacro RAT_CLAIM ".crw"
    !insertmacro RAT_CLAIM ".nef"
    !insertmacro RAT_CLAIM ".nrw"
    !insertmacro RAT_CLAIM ".arw"
    !insertmacro RAT_CLAIM ".srf"
    !insertmacro RAT_CLAIM ".sr2"
    !insertmacro RAT_CLAIM ".dng"
    !insertmacro RAT_CLAIM ".orf"
    !insertmacro RAT_CLAIM ".rw2"
    !insertmacro RAT_CLAIM ".raf"
    !insertmacro RAT_CLAIM ".pef"
    !insertmacro RAT_CLAIM ".srw"
    !insertmacro RAT_CLAIM ".mrw"
    !insertmacro RAT_CLAIM ".x3f"

    ; 2) 剩下的（被 UserChoice 锁着的）交给程序首次启动时引导用户确认一次
    WriteRegStr HKCU "Software\RatViewer\Install" "SetDefaultRequested" "1"
  ${EndIf}
!macroend

!macro customUnInstall
  ; 只清我们自己写进去的东西。绝不整键删 Software\RegisteredApplications。
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey HKCU "Software\Classes\RatViewer.Image"
  DeleteRegKey HKCU "Software\RatViewer"
  DeleteRegValue HKCU "Software\RegisteredApplications" "RatViewer"

  ; 回收「确实由我们写成默认」的扩展名，用户自己选的绝不动
  !insertmacro RAT_UNCLAIM ".jpg"
  !insertmacro RAT_UNCLAIM ".jpeg"
  !insertmacro RAT_UNCLAIM ".jfif"
  !insertmacro RAT_UNCLAIM ".png"
  !insertmacro RAT_UNCLAIM ".apng"
  !insertmacro RAT_UNCLAIM ".webp"
  !insertmacro RAT_UNCLAIM ".gif"
  !insertmacro RAT_UNCLAIM ".bmp"
  !insertmacro RAT_UNCLAIM ".ico"
  !insertmacro RAT_UNCLAIM ".svg"
  !insertmacro RAT_UNCLAIM ".avif"
  !insertmacro RAT_UNCLAIM ".tif"
  !insertmacro RAT_UNCLAIM ".tiff"
  !insertmacro RAT_UNCLAIM ".cdr"
  !insertmacro RAT_UNCLAIM ".cmx"
  !insertmacro RAT_UNCLAIM ".psd"
  !insertmacro RAT_UNCLAIM ".psb"
  !insertmacro RAT_UNCLAIM ".heic"
  !insertmacro RAT_UNCLAIM ".heif"
  !insertmacro RAT_UNCLAIM ".dwg"
  !insertmacro RAT_UNCLAIM ".dxf"
  !insertmacro RAT_UNCLAIM ".cr2"
  !insertmacro RAT_UNCLAIM ".cr3"
  !insertmacro RAT_UNCLAIM ".crw"
  !insertmacro RAT_UNCLAIM ".nef"
  !insertmacro RAT_UNCLAIM ".nrw"
  !insertmacro RAT_UNCLAIM ".arw"
  !insertmacro RAT_UNCLAIM ".srf"
  !insertmacro RAT_UNCLAIM ".sr2"
  !insertmacro RAT_UNCLAIM ".dng"
  !insertmacro RAT_UNCLAIM ".orf"
  !insertmacro RAT_UNCLAIM ".rw2"
  !insertmacro RAT_UNCLAIM ".raf"
  !insertmacro RAT_UNCLAIM ".pef"
  !insertmacro RAT_UNCLAIM ".srw"
  !insertmacro RAT_UNCLAIM ".mrw"
  !insertmacro RAT_UNCLAIM ".x3f"

  DeleteRegValue HKCU "Software\Classes\.jpg\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.jpeg\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.jfif\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.png\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.apng\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.webp\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.gif\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.bmp\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.ico\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.svg\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.avif\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.tif\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.tiff\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.cdr\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.cmx\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.psd\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.psb\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.heic\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.heif\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.cr2\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.cr3\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.nef\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.arw\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.dng\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.orf\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.rw2\OpenWithProgids" "RatViewer.Image"
  DeleteRegValue HKCU "Software\Classes\.raf\OpenWithProgids" "RatViewer.Image"
!macroend
