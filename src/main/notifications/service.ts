import { app, clipboard, shell } from 'electron'
import { join } from 'node:path'
import { startBridge } from './core/bridge.mjs'
import { queryInbox, sourceUrl } from './query'
import type { InboxQuery, InboxResult } from '../../shared/inbox'

let bridge: Awaited<ReturnType<typeof startBridge>> | null = null
let start: Promise<void> | null = null
let error: string | null = null

export function startInbox(): Promise<void> {
  if (!start)
    start = startBridge(join(app.getPath('userData'), 'creator-inbox'))
      .then((value) => {
        bridge = value
      })
      .catch((cause: NodeJS.ErrnoException) => {
        error =
          cause.code === 'EADDRINUSE'
            ? '알림 연결 포트를 다른 프로그램이 사용하고 있어요. 기존 모아 서버를 종료한 뒤 앱을 다시 열어주세요.'
            : '알림 저장소를 열지 못했어요. 기존 파일은 그대로 보존돼요.'
      })
  return start
}

async function ready(): Promise<NonNullable<typeof bridge>> {
  await startInbox()
  if (!bridge) throw new Error(error || '알림 수집기를 시작하지 못했어요.')
  return bridge
}

export async function getInbox(query: InboxQuery): Promise<InboxResult> {
  await startInbox()
  if (!bridge)
    return {
      ...queryInbox({
        enabled: false,
        connected: false,
        pairCode: null,
        mode: 'direct-api',
        collector: null,
        platforms: {},
        items: []
      }),
      available: false,
      error
    }
  return queryInbox(await bridge.store.view(), query)
}
export async function controlInbox(enabled: boolean): Promise<{ enabled: boolean }> {
  if (typeof enabled !== 'boolean') throw new Error('Invalid control')
  return (await ready()).store.control(enabled)
}
export async function setInboxInterval(
  minutes: number
): Promise<{ intervalMinutes: number; collecting: boolean; nextCollectionAt: string | null }> {
  return (await ready()).store.setInterval(minutes)
}
export async function copyInboxPairCode(): Promise<{ copied: boolean }> {
  const view = await (await ready()).store.view()
  if (!view.pairCode) return { copied: false }
  clipboard.writeText(view.pairCode)
  return { copied: true }
}
export async function openInboxSource(id: string): Promise<void> {
  const item = (await (await ready()).store.view()).items.find((item) => item.id === id)
  if (!item) throw new Error('알림을 찾을 수 없어요.')
  await shell.openExternal(sourceUrl(item))
}
export async function closeInbox(): Promise<void> {
  if (start) await start
  if (bridge) await bridge.close()
}
