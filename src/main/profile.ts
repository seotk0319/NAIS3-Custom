import { app } from 'electron'
import { basename, join } from 'path'

/**
 * NAIS3 Custom 프로필 (Custom 1/2 분리 실행):
 * - 실행 파일명 "NAIS3 Custom N.exe" 또는 --profile=N 인자에서 프로필 번호를 얻는다.
 * - 프로필별로 userData를 분리해 DB·설정·저장 경로가 서로 독립.
 *   requestSingleInstanceLock()의 잠금도 userData 기준이므로 프로필끼리 동시 실행이 가능하다.
 * - 인자/파일명에 프로필이 없으면 Custom 1을 기본값으로 사용한다.
 * - 원본 NAIS3 userData 경로는 절대 공유하지 않는다.
 */
function detectProfile(): number {
  const arg = process.argv.find((a) => a.startsWith('--profile='))
  const fromArg = arg ? Number(arg.split('=')[1]) : NaN
  if (Number.isInteger(fromArg) && fromArg > 0) return fromArg
  const m = /custom[ _-]*(\d+)/i.exec(basename(process.execPath))
  const fromExe = m ? Number(m[1]) : NaN
  return Number.isInteger(fromExe) && fromExe > 0 ? fromExe : 1
}

export const PROFILE = detectProfile()
export const APP_TITLE = `NAIS3 Custom ${PROFILE}`
export const APP_USER_MODEL_ID = `com.sunanakgo.nais3.custom${PROFILE}`

/**
 * 작업표시줄/창 아이콘 색반전 여부. 짝수 프로필(Custom 2, 4, ...)은 반전 아이콘을 써서
 * 여러 프로필을 동시에 켰을 때 작업표시줄에서 한눈에 구분되게 한다.
 * (프로필 0/홀수 = 원본 아이콘, 짝수 = 반전 아이콘)
 */
export const SHOULD_INVERT_ICON = PROFILE > 0 && PROFILE % 2 === 0

/** 반드시 requestSingleInstanceLock()·DB 초기화보다 먼저 호출 */
export function initProfilePaths(): void {
  app.setPath('userData', join(app.getPath('appData'), `NAIS3-Custom-${PROFILE}`))
}
