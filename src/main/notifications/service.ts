import { app, shell } from 'electron'
import { join } from 'node:path'
import { createStore, type InboxStore } from './core/store.mjs'
import { queryInbox, sourceUrl } from './query'
import { createDirectCollector } from './direct/collector'
import { isDirectPlatform } from './direct/platforms'
import type { InboxConnectResult, InboxQuery, InboxResult } from '../../shared/inbox'

let store: InboxStore | null = null
let direct: ReturnType<typeof createDirectCollector> | null = null
let start: Promise<void> | null = null
let error: string | null = null

export function startInbox(): Promise<void> {
  if (!start)
    start = createStore(join(app.getPath('userData'), 'creator-inbox'))
      .then((value) => {
        store = value
        direct = createDirectCollector({
          directory: join(app.getPath('userData'), 'creator-inbox'),
          profileDir: join(app.getPath('userData'), 'moa-login', 'browser-profile'),
          store: value,
          version: app.getVersion()
        })
        direct.start()
      })
      .catch(() => {
        error = '알림 저장소를 열지 못했어요. 기존 파일은 그대로 보존돼요.'
      })
  return start
}

async function ready(): Promise<InboxStore> {
  await startInbox()
  if (!store) throw new Error(error || '알림 수집기를 시작하지 못했어요.')
  return store
}

export async function getInbox(query: InboxQuery): Promise<InboxResult> {
  await startInbox()
  if (!store)
    return {
      ...queryInbox({
        enabled: false,
        mode: 'direct-api',
        collector: null,
        platforms: {},
        items: []
      }),
      available: false,
      error
    }
  const result = queryInbox(await store.view(), query)
  if (!direct) return result
  const status = await direct.status()
  return {
    ...result,
    directError: status.error ? directMessage(status.error) : null,
    platforms: result.platforms.map((p) => {
      const own = status.platforms[p.id]
      return own
        ? {
            ...p,
            appConnected: own.connected,
            awaitingLogin: own.awaitingLogin,
            loginWindowOpen: own.windowOpen,
            connecting: own.connecting
          }
        : p
    })
  }
}

const DIRECT_MESSAGES: Record<string, string> = {
  BROWSER_NOT_FOUND: '크롬이나 엣지를 찾지 못했어요. 둘 중 하나를 설치한 뒤 다시 눌러주세요.',
  BROWSER_ALREADY_OPEN: 'NAIS3 로그인 창이 이미 열려 있어요. 그 창을 닫은 뒤 다시 눌러주세요.',
  BROWSER_START_TIMEOUT: '로그인 창을 열지 못했어요. 잠시 뒤 다시 눌러주세요.',
  ENCRYPTION_UNAVAILABLE: '이 PC에서 로그인 정보를 암호화할 수 없어서 저장하지 않았어요.',
  UNSUPPORTED_SESSION_STORE: '로그인 정보 파일을 읽지 못했어요. 파일은 그대로 두었어요.',
  CONNECT_IN_PROGRESS: '이미 연결을 확인하고 있어요.'
}
const directMessage = (code: string): string =>
  DIRECT_MESSAGES[code] || '로그인 정보를 처리하지 못했어요. (' + code.slice(0, 160) + ')'

export async function connectInboxPlatform(platform: string): Promise<InboxConnectResult> {
  await ready()
  if (!direct || !isDirectPlatform(platform)) throw new Error('Invalid platform')
  const result = await direct.connect(platform)
  if (result.state === 'connected')
    return {
      state: 'connected',
      message: result.detail
        ? '연결했지만 첫 수집에서 오류가 났어요. ' + result.detail.slice(0, 200)
        : '연결했어요. 이제 NAIS3가 직접 알림을 모아요.'
    }
  if (result.state === 'login-required')
    return {
      state: 'login-required',
      message: '로그인 창을 열었어요. 창에서 로그인하면 알아서 연결돼요.'
    }
  return { state: 'error', message: directMessage(result.detail || 'UNKNOWN') }
}
export async function disconnectInboxPlatform(platform: string): Promise<{ ok: true }> {
  await ready()
  if (!direct || !isDirectPlatform(platform)) throw new Error('Invalid platform')
  await direct.disconnect(platform)
  return { ok: true }
}
export async function selectInboxPlatform(
  platform: string,
  selected: boolean
): Promise<{ ok: true }> {
  if (typeof selected !== 'boolean') throw new Error('Invalid selection')
  await (await ready()).select(platform, selected)
  return { ok: true }
}
export async function controlInbox(enabled: boolean): Promise<{ enabled: boolean }> {
  if (typeof enabled !== 'boolean') throw new Error('Invalid control')
  return (await ready()).control(enabled)
}
export async function setInboxInterval(
  minutes: number
): Promise<{ intervalMinutes: number; collecting: boolean; nextCollectionAt: string | null }> {
  return (await ready()).setInterval(minutes)
}
export async function openInboxSource(id: string): Promise<void> {
  const item = (await (await ready()).view()).items.find((item) => item.id === id)
  if (!item) throw new Error('알림을 찾을 수 없어요.')
  await shell.openExternal(sourceUrl(item))
}
export async function closeInbox(): Promise<void> {
  if (start) await start
  if (direct) await direct.stop()
}
