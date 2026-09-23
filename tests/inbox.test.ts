import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../src/main/notifications/core/store.mjs'
import { refineNotification, workLink } from '../src/main/notifications/core/api/model.mjs'
import {
  queryInbox,
  sourceUrl,
  decodeLunaText,
  stripMarkup,
  displayText
} from '../src/main/notifications/query'
import type { InboxItem, InboxView } from '../src/shared/inbox'

const item = (id: string, event: InboxItem['event'] = 'comment'): InboxItem => ({
  id: `teapot:personal:${id}`,
  platform: 'teapot',
  event,
  sourceType: '댓글',
  title: '새 댓글',
  body: '작품 이야기',
  actor: { id: 'actor', name: '작성자' },
  work: { id: 'work', title: '테스트 작품', url: null },
  at: null,
  unread: null,
  url: 'https://teapotchat.com/notifications'
})
const view = (items: InboxItem[]): InboxView => ({
  enabled: true,
  mode: 'direct-api',
  collector: null,
  platforms: {},
  items
})
describe('creator inbox projection', () => {
  it('decodes Luna HTML entities as plain text and matches decoded searches without altering stored data', () => {
    const raw = {
      ...item('1'),
      platform: 'luna' as const,
      title: '&#039;작품&#039; &#x1f49c; &amp; &lt;b&gt;'
    }
    const result = queryInbox(view([raw]), { search: "'작품'" })
    expect(result.items[0].title).toBe("'작품' 💜 & <b>")
    expect(raw.title).toContain('&#039;')
    expect(decodeLunaText('&#99999999;')).toBe('&#99999999;')
  })
  it('recognizes cookie-only Luna and does not report a failed API as connected', () => {
    const result = queryInbox({
      ...view([]),
      collector: {
        lastSeen: new Date().toISOString(),
        version: '0.3.4',
        running: true,
        sessions: { rplay: { connected: true } }
      },
      platforms: {
        luna: { status: 'ok', lastSuccess: new Date().toISOString() },
        rplay: { status: 'error', detail: 'rplay: HTTP_500' }
      }
    })
    expect(result.platforms.find((p) => p.id === 'luna')?.connected).toBe(true)
    expect(result.platforms.find((p) => p.id === 'rplay')?.connected).toBe(false)
    expect(result.platforms.find((p) => p.id === 'rplay')?.detail).toBe('rplay: HTTP_500')
  })
  it('bounds large results and combines platform, event and text filters', () => {
    const items = Array.from({ length: 13500 }, (_, i) =>
      item(String(i), i % 2 ? 'comment' : 'reply')
    )
    const result = queryInbox(view(items), {
      platform: 'teapot',
      event: 'reply',
      search: '테스트 작품',
      page: 99999
    })
    expect(result.total).toBe(13500)
    expect(result.filtered).toBe(6750)
    expect(result.items.length).toBeLessThanOrEqual(80)
    expect(result.page).toBe(84)
    expect(result.events.reply).toBe(6750)
    expect(result.items.every((i) => i.event === 'reply')).toBe(true)
  })
  it('never sends raw source records to the renderer', () => {
    const raw = { ...item('1'), sourceData: { private: 'not-rendered' } }
    const result = queryInbox(view([raw]))
    expect(JSON.stringify(result)).not.toContain('not-rendered')
    expect(result.items[0].unread).toBeNull()
  })
  it('reports stale collector as offline even when stored accounts remain connected', () => {
    const result = queryInbox(
      {
        ...view([]),
        collector: {
          lastSeen: '2026-09-22T00:00:00Z',
          running: true,
          version: '0.3.4',
          sessions: { teapot: { connected: true } }
        }
      },
      {},
      Date.parse('2026-09-22T00:03:00Z')
    )
    expect(result.collectorOnline).toBe(false)
  })
  it('removes source markup for display and search while the stored text keeps it', () => {
    const raw = {
      ...item('1'),
      platform: 'babe' as const,
      title: '<b>나인</b>님이 제작자님의 캐릭터에 댓글을 남겼어요',
      body: '<p>첫 문단</p><p>둘째 문단</p>수식 a < b 는 그대로'
    }
    const result = queryInbox(view([raw]), { search: '나인님이 제작자' })
    expect(result.items[0].title).toBe('나인님이 제작자님의 캐릭터에 댓글을 남겼어요')
    expect(result.items[0].body).toBe('첫 문단\n둘째 문단\n수식 a < b 는 그대로')
    expect(raw.title).toContain('<b>')
    expect(stripMarkup('한 줄<br/>다음 줄')).toBe('한 줄\n다음 줄')
    expect(stripMarkup('<table><tr><td>왼쪽</td><td>오른쪽</td></tr></table>')).toBe('왼쪽 오른쪽')
    // A tag the source escaped on purpose stays visible text rather than disappearing.
    expect(displayText('&lt;b&gt;')).toBe('<b>')
  })
  it('counts unread across the filter and carries token expiry without the token', () => {
    const now = Date.parse('2026-09-22T08:00:00Z')
    const expiresAt = new Date(now + 4 * 60_000).toISOString()
    const result = queryInbox(
      {
        ...view([
          { ...item('1'), unread: true },
          { ...item('2'), unread: false },
          { ...item('3'), unread: null },
          { ...item('4'), event: 'admin' as const, unread: true }
        ]),
        collector: {
          lastSeen: new Date(now).toISOString(),
          version: '0.3.6',
          running: true,
          sessions: { teapot: { connected: true, expiresAt, canRenew: true } }
        },
        platforms: { teapot: { status: 'ok', lastSuccess: new Date(now).toISOString() } }
      },
      { event: 'comment' },
      now
    )
    expect(result.unread).toBe(1)
    expect(result.filtered).toBe(3)
    const teapot = result.platforms.find((p) => p.id === 'teapot')
    expect(teapot?.expiresAt).toBe(expiresAt)
    expect(teapot?.canRenew).toBe(true)
    const eden = result.platforms.find((p) => p.id === 'eden')
    expect(eden?.expiresAt).toBe(null)
    expect(eden?.canRenew).toBe(false)
  })
  it('rebuilds a missing work link for already stored rows without touching existing ones', () => {
    const stored = {
      ...item('1'),
      schemaVersion: 1,
      sourceId: '1',
      channel: 'personal',
      platform: 'genit' as const,
      classification: { evidence: 'source-type', warnings: [] },
      work: { id: '4f745fd3-ed32-455d-955b-f9aa31794000', title: '작품', url: null },
      url: null
    }
    const refined = refineNotification(stored) as typeof stored
    expect(refined.url).toBe('https://genit.ai/ko/contents/4f745fd3-ed32-455d-955b-f9aa31794000')
    expect(refined.work.url).toBe(refined.url)
    expect(stored.url).toBe(null)
    expect(sourceUrl(refined)).toBe(refined.url)
    // A row that already has its own link keeps it.
    const kept = refineNotification({ ...stored, url: 'https://genit.ai/ko/contents/other' })
    expect(kept.url).toBe('https://genit.ai/ko/contents/other')
    // A platform that has no work page, or an id of the wrong shape, stays linkless.
    expect(refineNotification({ ...stored, platform: 'crack' as const }).url).toBe(null)
    expect(refineNotification({ ...stored, work: { ...stored.work, id: 'not-a-uuid' } }).url).toBe(
      null
    )
    expect(workLink('neko', 'char_1788872106350_cpvotv0')).toBe(
      'https://www.nekochat.xyz/character/char_1788872106350_cpvotv0'
    )
  })
  it('filters by event group and unread state while counts keep describing the whole view', () => {
    const rows = [
      { ...item('c'), event: 'comment' as const, unread: true },
      { ...item('r'), event: 'reply' as const, unread: false },
      { ...item('n'), event: 'admin' as const, unread: null },
      { ...item('l1'), event: 'like' as const, unread: true },
      { ...item('l2'), event: 'like' as const, unread: false },
      { ...item('f'), event: 'follow' as const, unread: null }
    ]
    const conversation = queryInbox(view(rows), { event: 'conversation' })
    expect(conversation.items.map((x) => x.event).sort()).toEqual(['admin', 'comment', 'reply'])
    const reaction = queryInbox(view(rows), { event: 'reaction' })
    expect(reaction.items.map((x) => x.event).sort()).toEqual(['follow', 'like', 'like'])
    const unread = queryInbox(view(rows), { event: 'reaction', unread: true })
    expect(unread.items.map((x) => x.id)).toEqual(['teapot:personal:l1'])
    // Tabs show the size of each group, so the counts must not shrink with the filter.
    expect(unread.events.comment).toBe(1)
    expect(unread.events.like).toBe(2)
    // A single event still filters exactly as before.
    expect(queryInbox(view(rows), { event: 'like' }).filtered).toBe(2)
  })
  it('files a Babe character like under reactions, including rows stored before the rule', () => {
    const stored = {
      ...item('1'),
      schemaVersion: 1,
      sourceId: 'b1',
      channel: 'personal',
      platform: 'babe' as const,
      event: 'other' as const,
      sourceType: 'characterLike',
      classification: { evidence: 'unmapped', warnings: ['unmapped-type'] },
      sourceData: {
        id: 'b1',
        type: 'characterLike',
        title: '도령님이 제작자님의 캐릭터를 좋아해요',
        createdAt: '2026-09-23T01:00:00Z',
        isRead: false
      }
    }
    expect(refineNotification(stored).event).toBe('like')
  })
  it('drops the English event word Genit and Neko append to their titles, and only that', () => {
    const genit = (title: string): InboxItem => ({ ...item(title), platform: 'genit', title })
    const result = queryInbox(
      view([
        genit('「오빠.. 진짜 싫어..♡」 comment'),
        genit('comment 이벤트 안내'),
        genit('「작품」 like'),
        genit('테스트닉네임 · follow'),
        { ...genit('neko'), platform: 'neko', title: '「테스트 작품」 like' },
        { ...genit('unlike'), title: '「unlike」' }
      ])
    )
    expect(result.items.map((x) => x.title)).toEqual([
      '「오빠.. 진짜 싫어..♡」',
      'comment 이벤트 안내',
      '「작품」',
      '테스트닉네임',
      '「테스트 작품」',
      '「unlike」'
    ])
    expect(queryInbox(view([{ ...item('t'), title: '「작품」 comment' }])).items[0].title).toBe(
      '「작품」 comment'
    )
  })
  it('keeps reaction rows from repeating the actor and work in the body', () => {
    const babe: InboxItem = {
      ...item('b'),
      platform: 'babe',
      event: 'like',
      title: '독자A님이 제작자님의 캐릭터를 좋아해요',
      body: '테스트 캐릭터',
      actor: { id: null, name: '독자A' },
      work: { id: 'c1', title: null, url: null }
    }
    const eden: InboxItem = {
      ...item('e'),
      platform: 'eden',
      event: 'like',
      body: '독자B님이 "테스트 작품 2"을(를) 좋아합니다',
      actor: { id: null, name: '독자B' },
      work: { id: 'w1', title: '테스트 작품 2', url: null }
    }
    const teapotFollow: InboxItem = {
      ...item('f'),
      event: 'follow',
      body: '@reader_c님이 회원님을 팔로우하기 시작했습니다.',
      actor: { id: null, name: 'reader_c' },
      work: { id: null, title: null, url: null }
    }
    const milestone: InboxItem = {
      ...item('m'),
      event: 'like',
      body: "'테스트 작품 3' 좋아요 50개를 달성했어요!",
      actor: { id: null, name: 'reader_d' },
      work: { id: 'w2', title: null, url: null }
    }
    const comment: InboxItem = { ...item('c'), body: '작성자님 작품 잘 봤어요' }
    const [b, e, f, m, c] = queryInbox(view([babe, eden, teapotFollow, milestone, comment])).items
    expect([b.body, b.work.title]).toEqual(['', '테스트 캐릭터'])
    expect([e.body, e.work.title]).toEqual(['', '테스트 작품 2'])
    expect(f.body).toBe('')
    // Bodies that say something new stay: a milestone, and any comment.
    expect(m.body).toBe("'테스트 작품 3' 좋아요 50개를 달성했어요!")
    expect(c.body).toBe('작성자님 작품 잘 봤어요')
  })
  it('rejects non-HTTPS and credential-bearing source links', () => {
    for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://a:b@example.com/'])
      expect(() => sourceUrl({ ...item('1'), url })).toThrow()
    expect(sourceUrl(item('1'))).toBe('https://teapotchat.com/notifications')
  })
})

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function fixture(): Promise<{
  directory: string
  store: Awaited<ReturnType<typeof createStore>>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'nais-inbox-test-'))
  directories.push(directory)
  return { directory, store: await createStore(directory) }
}
const apiRow = (id: string, at: string | null = null): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  sourceId: id,
  platform: 'genit',
  event: 'comment',
  channel: 'personal',
  title: '제목',
  body: '내용',
  actor: { id: null, name: null },
  work: { id: null, title: null, url: null },
  at,
  readAt: at,
  unread: null,
  url: null,
  classification: { evidence: 'source-type', warnings: [] }
})
describe('inbox store', () => {
  it('saves the interval durably and opens no collection window on its own', async () => {
    const { directory, store } = await fixture()
    await store.setInterval(120)
    const reopened = await createStore(directory)
    expect((await reopened.view()).intervalMinutes).toBe(120)
    expect((await reopened.view()).collecting).toBe(false)
  })
  it('keeps notification identity across repeated batches and a restart', async () => {
    const { directory, store } = await fixture()
    const batch = {
      platform: 'genit',
      channel: 'personal',
      transport: 'direct-api',
      status: 'ok',
      items: [apiRow('1', '2026-09-22T01:00:00Z')]
    }
    expect(await store.ingest(batch)).toEqual({ accepted: 1, added: 1 })
    expect(await store.ingest(batch)).toEqual({ accepted: 1, added: 0 })
    const reopened = await createStore(directory)
    expect((await reopened.view()).items.map((x) => x.id)).toEqual(['genit:1'])
  })
  it('keeps a usable session expiry and drops everything else the collector reports', async () => {
    const { store } = await fixture()
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    await store.heartbeat({
      version: '1.0.23',
      running: true,
      sessions: {
        teapot: {
          connected: true,
          expiresAt,
          canRenew: true,
          refreshToken: 'must-never-be-stored'
        },
        eden: { connected: true, expiresAt: 'not-a-date', canRenew: 'yes' },
        nowhere: { connected: true }
      }
    })
    const sessions = (await store.view()).collector?.sessions
    expect(sessions?.teapot).toMatchObject({ expiresAt, canRenew: true })
    expect(sessions?.eden).toMatchObject({ expiresAt: null, canRenew: false })
    expect(Object.keys(sessions || {}).sort()).toEqual(['eden', 'teapot'])
    expect(JSON.stringify(sessions)).not.toContain('must-never-be-stored')
    // With nothing signed in, no collector is claimed at all.
    await store.heartbeat({ version: '1.0.23', running: true, sessions: {} })
    expect((await store.view()).collector).toBeNull()
  })
  it('accepts a batch whose timestamps cannot be read and names why a batch is refused', async () => {
    const { store } = await fixture()
    await store.ingest({
      platform: 'genit',
      channel: 'personal',
      transport: 'direct-api',
      status: 'ok',
      items: [apiRow('a', '2026-09-22T01:00:00Z'), apiRow('b', 'unknown'), apiRow('c', '')]
    })
    const items = (await store.view()).items
    expect(items).toHaveLength(3)
    expect(items.filter((x) => x.at === null)).toHaveLength(2)
    await expect(
      store.ingest({ platform: 'genit', transport: 'direct-api', items: [{ title: 'no id' }] })
    ).rejects.toThrow('Invalid notification ID')
  })
  it('forgets the retired extension without touching its old pairing file', async () => {
    const { directory } = await fixture()
    const pairing = JSON.stringify({
      pairCode: null,
      extensionOrigin: 'chrome-extension://' + 'a'.repeat(32),
      token: 'old'
    })
    await writeFile(join(directory, 'connection.json'), pairing)
    await writeFile(
      join(directory, 'inbox.json'),
      JSON.stringify({
        version: 1,
        items: {},
        snapshots: {},
        platforms: {},
        enabled: true,
        collector: {
          lastSeen: new Date().toISOString(),
          version: '0.3.12',
          running: true,
          sessions: { eden: { connected: true } }
        }
      })
    )
    const view = await (await createStore(directory)).view()
    expect(view.collector).toBeNull()
    expect(JSON.stringify(view)).not.toContain('chrome-extension')
    expect(await readFile(join(directory, 'connection.json'), 'utf8')).toBe(pairing)
  })
})
