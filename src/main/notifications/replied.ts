// 내가 단 답글 기록. NAIS3에서 보낸 답글과, 사이트(지금은 에덴)에서 직접 단 답글을 찾은 결과를
// 알림 id별로 남겨 둔다. 앱을 다시 켜도 "답글 완료" 표시가 남는다.
import type { InboxReplied } from '../../shared/inbox'

export interface RepliedRecord {
  items: Record<string, InboxReplied>
  /** 저장된 에덴 댓글 알림 전체를 한 번 훑은 시각. 그 뒤로는 최근 알림만 다시 본다. */
  edenFullAt?: string | null
}
export const emptyReplied = (): RepliedRecord => ({ items: {}, edenFullAt: null })

export function readReplied(value: unknown): RepliedRecord {
  const raw = value as Partial<RepliedRecord> | null
  if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object')
    return emptyReplied()
  const items: Record<string, InboxReplied> = {}
  for (const [id, entry] of Object.entries(raw.items)) {
    if (!entry || typeof entry.at !== 'string' || typeof entry.content !== 'string') continue
    items[id] = {
      at: entry.at,
      content: entry.content.slice(0, 1000),
      via: entry.via === 'site' ? 'site' : 'app'
    }
  }
  return { items, edenFullAt: typeof raw.edenFullAt === 'string' ? raw.edenFullAt : null }
}

export interface EdenStored {
  id: string
  platform: string
  sourceType?: string
  commentId?: string | null
  at?: string | null
}
/** 최근 알림만 다시 볼 때 확인하는 개수 */
export const EDEN_RECENT = 300

/**
 * 사이트에서 단 답글을 확인할 에덴 댓글 알림. 이미 답글 기록이 있는 알림은 뺀다.
 * 처음 한 번은 전부, 그 뒤로는 최근 것만 본다 (오래된 댓글에 지금 답글을 다는 일은 드물다).
 */
export function edenTargets(
  items: EdenStored[],
  record: RepliedRecord,
  full: boolean
): { itemId: string; commentId: string }[] {
  const list = items
    .filter(
      (x) =>
        x.platform === 'eden' &&
        (x.sourceType === 'comment' || x.sourceType === 'reply') &&
        !!x.commentId &&
        !record.items[x.id]
    )
    .sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0))
    .map((x) => ({ itemId: x.id, commentId: String(x.commentId) }))
  return full ? list : list.slice(0, EDEN_RECENT)
}

/** 찾은 답글(댓글 번호 기준)을 알림 id 기록에 넣는다. 새로 넣은 개수를 돌려준다. */
export function mergeFound(
  record: RepliedRecord,
  targets: { itemId: string; commentId: string }[],
  found: Record<string, { at: string; content: string }>
): number {
  let added = 0
  for (const t of targets) {
    const reply = found[t.commentId]
    if (!reply || record.items[t.itemId]) continue
    record.items[t.itemId] = { at: reply.at, content: reply.content, via: 'site' }
    added++
  }
  return added
}
