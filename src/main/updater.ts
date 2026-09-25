import electronUpdater from 'electron-updater'
import { app, shell } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { IpcEventMap, QueueStatus } from '../shared/types'
import { broadcast } from './ipc'
import { PROFILE, UPDATE_PROFILE_MARKER } from './profile'

// electron-updater는 CJS — ESM에서 named import가 깨질 수 있어 default에서 구조분해
const { autoUpdater } = electronUpdater

/**
 * 자동 업데이트는 이 저장소의 GitHub 릴리스만 본다.
 * (1.0.13에서 원본 NAIS3 저장소를 보던 업데이터를 뺐다 — 커스텀판이 원본으로 덮이지 않게 주소를 여기서 고정한다)
 */
const OWNER = 'seotk0319'
const REPO = 'NAIS3-Custom'
export const RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`

type UpdateStatus = IpcEventMap['update:status']

/**
 * 설치 파일로 설치된 앱인지. 포터블 복사본에서 설치 파일을 돌리면 다른 폴더에 새로 깔리므로
 * 포터블은 새 버전 알림과 릴리스 페이지 열기까지만 한다.
 */
function isInstalled(): boolean {
  return existsSync(join(dirname(process.execPath), 'Uninstall NAIS3 Custom.exe'))
}

let configured = false
let downloadedVersion: string | null = null
let installOnQuit = false
let last: UpdateStatus = { state: 'none' }

function emit(status: UpdateStatus): UpdateStatus {
  last = { current: app.getVersion(), portable: !isInstalled(), ...status }
  broadcast('update:status', last)
  return last
}

function configure(): void {
  if (configured) return
  configured = true
  autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
  autoUpdater.autoDownload = false
  // 받아둔 업데이트는 다음에 앱을 끌 때 조용히 설치된다 (버튼으로 바로 설치할 수도 있다)
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.on('download-progress', (p) => {
    emit({ state: 'downloading', version: last.version, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    emit({ state: 'downloaded', version: info.version })
  })
  // 오류는 check/download 쪽 catch에서 알린다. 리스너가 없으면 EventEmitter가 예외를 던진다
  autoUpdater.on('error', () => {})
  // 평소처럼 종료(알림 저장·DB 닫기)를 마친 마지막 순간에 설치 파일을 조용히 실행하고 다시 켠다
  app.on('will-quit', () => {
    if (installOnQuit) autoUpdater.quitAndInstall(true, true)
  })
}

/** 설정의 "업데이트 확인" 버튼 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return emit({ state: 'error', message: '개발 실행에서는 업데이트를 확인하지 않아요' })
  }
  if (downloadedVersion) return emit({ state: 'downloaded', version: downloadedVersion })
  configure()
  emit({ state: 'checking' })
  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo.version
    if (!result || !result.isUpdateAvailable || !version) return emit({ state: 'none' })
    return emit({ state: 'available', version })
  } catch (err) {
    return emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

/** 새 버전 받기. 포터블이면 릴리스 페이지를 연다 */
export function startUpdateDownload(): void {
  if (!isInstalled() || !configured) {
    void shell.openExternal(RELEASE_PAGE)
    emit({ ...last })
    return
  }
  emit({ state: 'downloading', version: last.version, percent: 0 })
  void autoUpdater.downloadUpdate().catch((err) => {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}

/** 받아둔 업데이트를 지금 설치 (생성이 도는 중이면 거절) */
export function installUpdateNow(queue: () => QueueStatus): { ok: boolean; busy?: boolean } {
  if (!downloadedVersion) return { ok: false }
  const { counts } = queue()
  if (counts.pending + counts.generating > 0) return { ok: false, busy: true }
  // 설치 파일은 앱을 번호 없이 다시 켠다 — 지금 프로필로 돌아오도록 적어 둔다 (profile.ts가 읽고 지운다)
  try {
    writeFileSync(
      join(app.getPath('appData'), UPDATE_PROFILE_MARKER),
      JSON.stringify({ profile: PROFILE, at: Date.now() })
    )
  } catch {
    /* 못 적으면 Custom 1로 켜진다 */
  }
  installOnQuit = true
  setImmediate(() => app.quit())
  return { ok: true }
}
