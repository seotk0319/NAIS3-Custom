# 모아 Chrome 확장

사용자 설치 방법은 저장소 루트의 [쉬운 설치 설명서](../../MOA-START-HERE.md)를 참고하세요.

이 디렉터리는 NAIS3 Custom과 함께 공개하는 확장의 소스입니다. 이전 독립형 대시보드 서버는 필요하지 않습니다.
배포에 필요한 파일만 포함하며 계정 정보, Chrome 프로필, 알림 DB와 내부 작업 문서는 포함하지 않습니다.

## 개발 / 패키징

저장소 루트에서 의존성을 설치한 뒤 실행하세요. Node.js 22 이상을 사용합니다.

```sh
npm run test:moa
npm run build:moa
```

`extension/lib`는 이 배포본의 API 모듈 원본입니다. 알림 분류를 바꿀 때는
`src/main/notifications/core/api/model.mjs`도 동일하게 반영해야 합니다.
패키징 스크립트가 두 파일의 일치와 worker/manifest 버전 일치를 검사합니다.
이전 독립형 프로젝트의 사본을 수정한 경우에는 이 디렉터리에 반영하고 다시 검사해야 합니다.

`MOA-START-HERE.md`를 수정한 뒤 `build:moa`를 실행하면 오프라인 HTML 안내서,
팝업 도움말인 `extension/guide.html`, 허용된 파일만 담은 ZIP이 생성됩니다.
버전을 올릴 때는 manifest, worker, 이 디렉터리의 package.json과 안내서 파일명을 맞춥니다.

0.3.11은 0.3.10의 수집 동작을 유지하면서 팝업의 저장 방식 설명을 바로잡고 설치 도움말을 추가한 배포본입니다.
계정 정보는 Chrome의 storage.local에, 알림은 사용자의 NAIS3 Custom 1 프로필에 저장합니다.
처음 연결에는 사용자가 자신의 NAIS에서 복사한 코드가 필요합니다.
