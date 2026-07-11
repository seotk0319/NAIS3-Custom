import { shell } from 'electron'

const RELEASE_PAGE = 'https://github.com/seotk0319/NAIS3-Custom/releases/latest'

/** 커스텀 빌드는 자동 교체하지 않고 사용자가 요청할 때 릴리스 페이지만 연다. */
export function startUpdateDownload(): void {
  void shell.openExternal(RELEASE_PAGE)
}
