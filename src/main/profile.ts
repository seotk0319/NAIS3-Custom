import { app } from 'electron'
import { readFileSync, unlinkSync } from 'fs'
import { basename, join } from 'path'

/** 자동 업데이트 직전에 적어 두는 프로필 번호 파일 (%APPDATA% 아래). 설치 파일은 앱을 번호 없이 다시 켠다 */
export const UPDATE_PROFILE_MARKER = 'NAIS3-Custom-update-profile.json'

/** 업데이트 설치 후 다시 켜진 경우(--updated) 업데이트 전 프로필로 돌아온다 */
function profileAfterUpdate(): number {
  if (!process.argv.includes('--updated')) return NaN
  const marker = join(app.getPath('appData'), UPDATE_PROFILE_MARKER)
  let raw: string
  try {
    raw = readFileSync(marker, 'utf8')
  } catch {
    return NaN
  }
  // 한 번 읽으면 내용이 깨져 있어도 지운다 (다음 실행에 다시 걸리지 않게)
  try {
    unlinkSync(marker)
  } catch {
    /* 지우지 못해도 30분 기준으로 무시된다 */
  }
  try {
    const { profile, at } = JSON.parse(raw) as { profile: number; at: number }
    // 오래된 기록은 무시 (설치가 실패하고 한참 뒤 켜진 경우)
    return Number.isInteger(profile) && Date.now() - at < 30 * 60_000 ? profile : NaN
  } catch {
    return NaN
  }
}

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
  const fromUpdate = profileAfterUpdate()
  if (Number.isInteger(fromUpdate) && fromUpdate > 0) return fromUpdate
  const m = /custom[ _-]*(\d+)/i.exec(basename(process.execPath))
  const fromExe = m ? Number(m[1]) : NaN
  return Number.isInteger(fromExe) && fromExe > 0 ? fromExe : 1
}

export const PROFILE = detectProfile()
/**
 * 내부 앱 이름. app.setName()에 쓰이고, 기본 이미지 저장 폴더(사진/<이름>)도 이 값을 따른다.
 * 기존 사용자의 저장 경로가 바뀌지 않도록 번호를 항상 유지한다.
 */
export const APP_NAME = `NAIS3 Custom ${PROFILE}`
/** 화면에 보이는 이름. 기본 프로필(1)은 번호 없이, 추가 프로필(2 이상)만 번호를 붙여 구분한다. */
export const APP_TITLE = PROFILE === 1 ? 'NAIS3 Custom' : APP_NAME
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
