; NAIS3 Custom — 설치 시 프로필(Custom 1 / Custom 2) 선택 + --profile 바로가기 생성
!include nsDialogs.nsh
!include LogicLib.nsh

!macro customPageAfterChangeDir
  Page custom ProfilePageCreate ProfilePageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Var Profile2Checkbox
Var Profile2State

Function ProfilePageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 6u 100% 40u "설치할 프로필 개수를 선택하세요.$\r$\n기본으로 NAIS3 Custom 1 프로필이 설치됩니다. 두 개를 나눠서 동시에 쓰실 분만 아래를 체크하세요."
  Pop $0
  ${NSD_CreateCheckbox} 0 54u 100% 14u "NAIS3 Custom 2 (두 번째 프로필)도 함께 설치"
  Pop $Profile2Checkbox
  ${NSD_CreateLabel} 0 80u 100% 40u "프로필끼리 데이터와 설정이 완전히 분리되어, 두 개를 동시에 켜서 서로 다른 작업을 할 수 있습니다."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ProfilePageLeave
  ${NSD_GetState} $Profile2Checkbox $Profile2State
FunctionEnd
!endif

!macro customInstall
  ; Custom 1 바로가기 (항상 생성)
  CreateShortcut "$DESKTOP\NAIS3 Custom 1.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--profile=1" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateShortcut "$SMPROGRAMS\NAIS3 Custom 1.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--profile=1" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ; Custom 2 바로가기 (설치 시 체크한 경우에만)
  ${If} $Profile2State == 1
    CreateShortcut "$DESKTOP\NAIS3 Custom 2.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--profile=2" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    CreateShortcut "$SMPROGRAMS\NAIS3 Custom 2.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--profile=2" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\NAIS3 Custom 1.lnk"
  Delete "$SMPROGRAMS\NAIS3 Custom 1.lnk"
  Delete "$DESKTOP\NAIS3 Custom 2.lnk"
  Delete "$SMPROGRAMS\NAIS3 Custom 2.lnk"
!macroend