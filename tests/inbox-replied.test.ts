import { describe, expect, it } from 'vitest'
import { findEdenReplies, type ReplyContext } from '../src/main/notifications/direct/replies'
import { edenTargets, emptyReplied, mergeFound, readReplied } from '../src/main/notifications/replied'
import { queryInbox } from '../src/main/notifications/query'
import type { InboxItem, InboxView } from '../src/shared/inbox'

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })

// 에덴 work_comments를 흉내 낸다. id=in.(...) 과 parent_id=in.(...)&user_id=eq.me 두 가지만 읽는다.
const rows = [
  { id: 'c1', work_id: 'w', user_id: 'fan', parent_id: null, content: '재밌어요', created_at: '2026-10-01T10:00:00Z' },
  { id: 'c2', work_id: 'w', user_id: 'fan2', parent_id: null, content: '최고', created_at: '2026-10-01T11:00:00Z' },
  { id: 'c3', work_id: 'w', user_id: 'fan', parent_id: 'c1', content: '또 왔어요', created_at: '2026-10-01T13:00:00Z' },
  { id: 'mine', work_id: 'w', user_id: 'me', parent_id: null, content: '공지', created_at: '2026-10-01T09:00:00Z' },
  { id: 'r1', work_id: 'w', user_id: 'me', parent_id: 'c1', content: '감사합니다!', created_at: '2026-10-01T12:00:00Z' }
]
const ctx = (): ReplyContext & { urls: string[] } => {
  const urls: string[] = []
  return {
    urls,
    send: async (url, init) => {
      expect(init.method).toBe('GET')
      urls.push(url)
      const u = new URL(url)
      const list = (key: string): string[] =>
        (u.searchParams.get(key) || '').replace(/^in\.\(|\)$/g, '').split(',')
      if (u.searchParams.has('id')) return json(rows.filter((r) => list('id').includes(r.id)))
      const me = (u.searchParams.get('user_id') || '').replace('eq.', '')
      return json(rows.filter((r) => r.user_id === me && r.parent_id && list('parent_id').includes(r.parent_id)))
    },
    cookie: async () => null,
    accountId: () => 'me',
    route: () => null
  }
}

describe('replies made on the Eden site', () => {
  it('counts my later reply in the same thread, and only a reply after the notified comment', async () => {
    const c = ctx()
    const found = await findEdenReplies(c, ['c1', 'c2', 'c3', 'mine', 'bad id'])
    // c1: 내가 12시에 답글. c3: 같은 묶음이지만 13시 댓글이라 그 뒤 내 답글이 없다. c2: 답글 없음.
    expect(found).toEqual({ c1: { at: '2026-10-01T12:00:00Z', content: '감사합니다!' } })
    // 띄어쓰기가 든 번호는 주소에 넣지 않는다.
    expect(c.urls.every((url) => !url.includes('bad'))).toBe(true)
  })

  it('needs a signed-in Eden account', async () => {
    await expect(findEdenReplies({ ...ctx(), accountId: () => null }, ['c1'])).rejects.toThrow('LOGIN_REQUIRED')
  })

  it('checks every stored Eden comment once, then only the newest, and keeps earlier records', () => {
    const stored = Array.from({ length: 310 }, (_, i) => ({
      id: 'eden:n:' + i,
      platform: 'eden',
      sourceType: i % 2 ? 'reply' : 'comment',
      commentId: 'c' + i,
      at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString()
    }))
    stored.push({ id: 'eden:like', platform: 'eden', sourceType: 'like', commentId: 'x', at: null } as never)
    const record = emptyReplied()
    expect(edenTargets(stored, record, true)).toHaveLength(310)
    const recent = edenTargets(stored, record, false)
    expect(recent).toHaveLength(300)
    expect(recent[0]).toEqual({ itemId: 'eden:n:309', commentId: 'c309' })

    record.items['eden:n:309'] = { at: 'x', content: 'NAIS3에서 보냄', via: 'app' }
    const added = mergeFound(record, recent, {
      c309: { at: 'y', content: '사이트' },
      c308: { at: '2026-10-01T00:00:00Z', content: '고마워요' }
    })
    expect(added).toBe(1)
    expect(record.items['eden:n:309'].via).toBe('app')
    expect(record.items['eden:n:308']).toEqual({ at: '2026-10-01T00:00:00Z', content: '고마워요', via: 'site' })
    expect(readReplied(JSON.parse(JSON.stringify(record)))).toEqual(record)
    expect(readReplied('garbage')).toEqual(emptyReplied())
  })

  it('shows the replied mark and filters to comments still waiting for a reply', () => {
    const base = {
      platform: 'eden' as const,
      event: 'comment' as const,
      sourceType: 'comment',
      title: '새 댓글',
      body: '좋아요',
      actor: { id: null, name: '독자' },
      work: { id: 'w', title: null, url: null },
      at: null,
      unread: null,
      url: null
    }
    const items = [
      { ...base, id: 'a', commentId: 'c1' },
      { ...base, id: 'b', commentId: 'c2' },
      { ...base, id: 'like', event: 'like' as const, sourceType: 'like', commentId: null }
    ] as InboxItem[]
    const view: InboxView = { enabled: true, mode: 'direct-api', collector: null, platforms: {}, items }
    const replied = { a: { at: '2026-10-01T12:00:00Z', content: '감사합니다!', via: 'site' as const } }
    const all = queryInbox(view, {}, Date.now(), undefined, {}, replied)
    expect(all.items.find((x) => x.id === 'a')?.replied).toEqual(replied.a)
    expect(all.items.find((x) => x.id === 'b')?.replied).toBeNull()
    const waiting = queryInbox(view, { unreplied: true }, Date.now(), undefined, {}, replied)
    expect(waiting.items.map((x) => x.id)).toEqual(['b'])
  })
})
