import { app, shell } from 'electron'
import { join } from 'node:path'
import { createStore, type InboxStore } from './core/store.mjs'
import { displayText, queryInbox, sourceUrl } from './query'
import { createDirectCollector } from './direct/collector'
import { isDirectPlatform } from './direct/platforms'
import type {
  InboxConnectResult,
  InboxQuery,
  InboxReplyResult,
  InboxReplyTarget,
  InboxResult
} from '../../shared/inbox'
import { REPLY_MAX, ReplyError } from './direct/babe-reply'
import { canReply, type ReplyItem } from './direct/replies'
import {
  catalogFrom,
  emptyCatalog,
  hasUnknownWork,
  platformKey,
  rememberCatalog,
  safeImage,
  worksNeedingImage,
  type PlatformImages,
  type WorkCatalog
} from './work-images'
import { readFile, writeFile } from 'node:fs/promises'

let store: InboxStore | null = null
let direct: ReturnType<typeof createDirectCollector> | null = null
let start: Promise<void> | null = null
let error: string | null = null

// 썸네일 기준표(베이비챗 작품 이름·이미지). 파일로 남겨 두고 6시간마다 새로 읽는다.
// 기준표에 없는 작품이 알림에 보이면(새 작품) 15분 간격으로 일찍 새로 받는다.
// 실패하면 10분 동안 다시 시도하지 않는다 (베이비챗을 안 쓰는 사람도 조회가 느려지지 않게).
const CATALOG_TTL = 6 * 60 * 60_000
const CATALOG_EARLY = 15 * 60_000
const CATALOG_BACKOFF = 10 * 60_000
let catalog: WorkCatalog = emptyCatalog()
let catalogLoaded = false
let catalogRefresh: Promise<void> | null = null
let catalogFailedAt = 0
const catalogFile = (): string => join(app.getPath('userData'), 'creator-inbox', 'babe-works.json')
function refreshCatalog(): Promise<void> | null {
  if (!direct || catalogRefresh || Date.now() - catalogFailedAt < CATALOG_BACKOFF) return catalogRefresh
  catalogRefresh = direct
    .babeWorks()
    .then(async (list) => {
      const next = catalogFrom(list)
      // 작품이 0개인 응답도 정상일 수 있다(새 계정). 그대로 받아 두고 시각만 갱신한다.
      catalog = next
      await writeFile(catalogFile(), JSON.stringify(next))
    })
    .catch(() => {
      catalogFailedAt = Date.now()
    })
    .finally(() => {
      catalogRefresh = null
    })
  return catalogRefresh
}
async function workCatalog(): Promise<WorkCatalog> {
  if (!catalogLoaded) {
    catalogLoaded = true
    try {
      const saved = JSON.parse(await readFile(catalogFile(), 'utf8')) as WorkCatalog
      if (saved && typeof saved.byName === 'object' && typeof saved.byId === 'object') {
        catalog = saved
        rememberCatalog(saved)
      }
    } catch {
      // 처음이거나 손상된 파일이면 새로 받는다.
    }
  }
  const age = catalog.fetchedAt ? Date.now() - Date.parse(catalog.fetchedAt) : Infinity
  if (age > CATALOG_TTL) {
    const run = refreshCatalog()
    // 첫 조회는 기준표를 받을 때까지 잠깐 기다린다. 이후엔 이전 표로 바로 답한다.
    if (!catalog.fetchedAt && run) await run
  }
  return catalog
}
function noticeUnknownWorks(items: InboxQueryItems): void {
  const age = catalog.fetchedAt ? Date.now() - Date.parse(catalog.fetchedAt) : Infinity
  if (age > CATALOG_EARLY && hasUnknownWork(items, catalog)) void refreshCatalog()
}
type InboxQueryItems = Parameters<typeof hasUnknownWork>[0]

// 플랫폼 작품 이미지 캐시. 찾은 이미지는 3일, 없던 작품은 1일 뒤 다시 확인한다.
// 조회가 막히지 않게 뒤에서 한 번에 최대 60개, 동시에 3개씩 채운다.
const FOUND_TTL = 3 * 24 * 60 * 60_000
const MISSING_TTL = 24 * 60 * 60_000
let platformImages: Record<string, { url: string | null; at: string }> = {}
let platformLoaded = false
let filling: Promise<void> | null = null
const platformFile = (): string => join(app.getPath('userData'), 'creator-inbox', 'work-thumbs.json')
async function loadPlatformImages(): Promise<void> {
  if (platformLoaded) return
  platformLoaded = true
  try {
    const saved = JSON.parse(await readFile(platformFile(), 'utf8')) as typeof platformImages
    if (saved && typeof saved === 'object') {
      platformImages = saved
      for (const entry of Object.values(saved)) if (entry?.url) safeImage(entry.url)
    }
  } catch {
    // 처음이면 비어 있다.
  }
}
function platformImageMap(): PlatformImages {
  return Object.fromEntries(Object.entries(platformImages).map(([k, e]) => [k, e.url]))
}
function stale(key: string): boolean {
  const entry = platformImages[key]
  if (!entry) return true
  return Date.now() - Date.parse(entry.at) > (entry.url ? FOUND_TTL : MISSING_TTL)
}
function fillPlatformImages(items: InboxQueryItems): boolean {
  if (filling || !direct) return !!filling
  const todo = worksNeedingImage(items, catalog)
    .filter((w) => stale(platformKey(w.platform, w.workId)))
    .slice(0, 60)
  if (!todo.length) return false
  const collector = direct
  filling = (async () => {
    const queue = [...todo]
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let w = queue.shift(); w; w = queue.shift()) {
          const key = platformKey(w.platform, w.workId)
          try {
            const url = await collector.workImage(w.platform, w.workId)
            if (url) safeImage(url)
            platformImages[key] = { url, at: new Date().toISOString() }
          } catch {
            // 로그인 만료·네트워크 오류는 기록하지 않고 다음 조회 때 다시 시도한다.
          }
        }
      })
    )
    await writeFile(platformFile(), JSON.stringify(platformImages)).catch(() => undefined)
  })().finally(() => {
    filling = null
  })
  return true
}

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
  const view = await store.view()
  await loadPlatformImages()
  const result = queryInbox(view, query, Date.now(), await workCatalog(), platformImageMap())
  noticeUnknownWorks(view.items)
  result.thumbnailsPending = fillPlatformImages(view.items)
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

const REPLY_MESSAGES: Record<string, string> = {
  LOGIN_REQUIRED: '이 플랫폼 로그인이 풀렸어요. 연결 관리에서 다시 로그인해 주세요.',
  COMMENT_NOT_FOUND: '원래 댓글을 찾지 못했어요. 작성자가 지웠을 수 있어요.',
  OWN_COMMENT: '내가 쓴 댓글이에요. 다른 사람 댓글에만 답글을 달 수 있어요.',
  BAD_CONTENT: `답글은 1자 이상 ${REPLY_MAX}자 이하로 써주세요.`,
  BAD_TARGET: '이 알림에는 원래 댓글 정보가 없어 답글을 달 수 없어요.',
  REPLY_UNSUPPORTED: '이 알림은 아직 앱에서 답글을 달 수 없어요.'
}

function replyMessage(error: unknown, fallback: string): string {
  const code = error instanceof ReplyError ? error.code : ''
  const status = error instanceof ReplyError && error.status ? ` (${error.status})` : ''
  return REPLY_MESSAGES[code] || `${fallback}${status}. 잠시 뒤 다시 해주세요.`
}

type StoredItem = {
  id: string
  platform: string
  sourceType?: string
  event?: string
  title?: string
  body?: string
  at?: string | null
  actor?: { name?: string | null }
  work?: { id?: string | null }
  commentId?: string | null
  url?: string | null
}

async function replyItem(id: string): Promise<ReplyItem> {
  const s = await ready()
  if (!direct) throw new ReplyError('LOGIN_REQUIRED')
  const raw = (await s.view()).items.find((x) => x.id === id) as StoredItem | undefined
  if (!raw) throw new ReplyError('COMMENT_NOT_FOUND')
  const item: ReplyItem = {
    platform: raw.platform,
    sourceType: String(raw.sourceType || ''),
    event: String(raw.event || ''),
    title: displayText(raw.title || ''),
    body: displayText(raw.body || ''),
    at: raw.at || null,
    actor: { name: raw.actor?.name || null },
    work: { id: raw.work?.id || null },
    commentId: raw.commentId || null,
    url: raw.url || null
  }
  if (!canReply(item)) throw new ReplyError('REPLY_UNSUPPORTED')
  return item
}

/** 보내기 전에 답글을 달 원래 댓글을 찾아 보여준다. */
export async function previewReply(id: string): Promise<InboxReplyTarget> {
  try {
    const item = await replyItem(id)
    const target = await direct!.resolveReply(item.platform as never, item)
    return { ok: true, message: '', author: target.author, content: target.content, at: target.at }
  } catch (error) {
    return { ok: false, message: replyMessage(error, '원래 댓글을 불러오지 못했어요') }
  }
}

/** 알림이 가리키는 원래 댓글에 답글을 단다. 올리기 직전까지 모든 확인은 본체에서 한다. */
export async function replyInbox(id: string, content: string): Promise<InboxReplyResult> {
  try {
    const item = await replyItem(id)
    await direct!.reply(item.platform as never, item, content)
    return { ok: true, message: '답글을 달았어요.' }
  } catch (error) {
    return { ok: false, message: replyMessage(error, '답글을 달지 못했어요') }
  }
}
