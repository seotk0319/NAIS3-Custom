# 그림으로 따라 하는 설치 안내

`node scripts/build-moa-visual-guide.mjs`를 저장소 루트에서 실행하면
`dist/MOA-VISUAL-GUIDE.html`을 생성합니다.

설치 내용의 기준은 루트의 `MOA-START-HERE.md`입니다. 단계별 그림 UI는 버튼 이름을 설명하는 도식이며 실제 스크린샷이 아닙니다.
완료 체크는 안내서의 브라우저 저장소에만 저장하고, 계정 연결이나 실제 설치 상태를 자동 판정하지 않습니다.

`setup-journey.png`는 내장 image_gen으로 만든 개념 일러스트입니다. 프롬프트는 `IMAGE-PROMPT.md`에 있습니다.
HTML은 이미지를 data URL로 포함하고 외부 스크립트·글꼴·스타일시트를 불러오지 않습니다.
네트워크 연결은 사용자가 다운로드 링크를 선택할 때 필요합니다.

기존 앱 설치 파일과 모아 ZIP은 바꾸지 않고, 같은 GitHub 릴리즈에 별도 안내서로 추가합니다.
