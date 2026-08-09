!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎安装视频修复助手"
!define MUI_WELCOMEPAGE_TEXT "修复无法打开的 MP4 与 MOV 视频。$\r$\n$\r$\n所有处理均在本机离线完成，原视频始终保持不变。$\r$\n$\r$\n点击“下一步”继续。"
!define MUI_FINISHPAGE_TITLE "视频修复助手已准备就绪"
!define MUI_FINISHPAGE_TEXT "安装已完成。现在可以添加损坏的视频并开始诊断。"
!define MUI_FINISHPAGE_RUN_TEXT "立即打开视频修复助手"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customHeader
  BrandingText "视频修复助手 · 本地离线处理"
!macroend
