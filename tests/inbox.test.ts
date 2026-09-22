import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { startBridge } from '../src/main/notifications/core/bridge.mjs'
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
  connected: true,
  pairCode: null,
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
  it('never sends pairing code or raw source records to the renderer', () => {
    const raw = { ...item('1'), sourceData: { private: 'not-rendered' } }
    const result = queryInbox({ ...view([raw]), pairCode: 'not-rendered' })
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
    expect(
      refineNotification({ ...stored, work: { ...stored.work, id: 'not-a-uuid' } }).url
    ).toBe(null)
    expect(workLink('neko', 'char_1788872106350_cpvotv0')).toBe(
      'https://www.nekochat.xyz/character/char_1788872106350_cpvotv0'
    )
  })
  it('rejects non-HTTPS and credential-bearing source links', () => {
    for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://a:b@example.com/'])
      expect(() => sourceUrl({ ...item('1'), url })).toThrow()
    expect(sourceUrl(item('1'))).toBe('https://teapotchat.com/notifications')
  })
})

const directories: string[] = []
const servers: Awaited<ReturnType<typeof startBridge>>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function fixture(): Promise<{
  directory: string
  server: Awaited<ReturnType<typeof startBridge>>
  url: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'nais-inbox-test-'))
  directories.push(directory)
  const server = await startBridge(directory, 0)
  servers.push(server)
  return { directory, server, url: `http://127.0.0.1:${server.port}` }
}
describe('embedded collector bridge', () => {
  it('saves the interval durably and sends a waiting gate to the existing collector', async () => {
    const { directory, server, url } = await fixture()
    await server.store.setInterval(120)
    expect((await server.store.view()).intervalMinutes).toBe(120)
    await expect(server.store.setInterval(0)).rejects.toThrow()
    const state = await server.store.view()
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'chrome-extension://' + 'a'.repeat(32)
    }
    const pair = await fetch(url + '/api/pair', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: state.pairCode })
    })
    const { token } = (await pair.json()) as { token: string }
    const auth = { ...headers, 'X-Moa-Key': token }
    const heartbeat = () =>
      fetch(url + '/api/heartbeat', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ version: '0.3.4' })
      }).then((r) => r.json())
    expect((await heartbeat()).enabled).toBe(true)
    for (const platform of [
      'eden',
      'babe',
      'luna',
      'elyn',
      'neko',
      'teapot',
      'crack',
      'rplay',
      'genit'
    ]) {
      await fetch(url + '/api/ingest', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          platform,
          items: [],
          channel: 'api-status',
          transport: 'direct-api',
          status: 'login'
        })
      })
    }
    expect((await heartbeat()).enabled).toBe(false)
    expect((await server.store.view()).enabled).toBe(true)
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    const reopened = await startBridge(directory, 0)
    servers.push(reopened)
    expect((await reopened.store.view()).intervalMinutes).toBe(120)
    expect((await reopened.store.view()).collecting).toBe(false)
  })
  it('preserves pairing and notification identity across restart, with authenticated ingestion', async () => {
    const { directory, server, url } = await fixture()
    const state = await server.store.view()
    const origin = 'chrome-extension://' + 'a'.repeat(32)
    const headers = { 'Content-Type': 'application/json', Origin: origin }
    const pair = await fetch(url + '/api/pair', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: state.pairCode })
    })
    expect(pair.status).toBe(200)
    const { token } = (await pair.json()) as { token: string }
    const notification = {
      ...item('1'),
      schemaVersion: 1,
      sourceId: '1',
      channel: 'personal',
      kind: 'comment',
      stableId: true,
      readAt: null,
      classification: { evidence: 'source_type', warnings: [] }
    }
    const batch = {
      platform: 'teapot',
      channel: 'personal',
      transport: 'direct-api',
      status: 'ok',
      items: [notification]
    }
    const request = {
      method: 'POST',
      headers: { ...headers, 'X-Moa-Key': token },
      body: JSON.stringify(batch)
    }
    expect((await fetch(url + '/api/ingest', request)).status).toBe(200)
    expect((await fetch(url + '/api/ingest', request)).status).toBe(200)
    expect((await server.store.view()).items).toHaveLength(1)
    expect((await fetch(url + '/api/ingest', { ...request, headers })).status).toBe(403)
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    const reopened = await startBridge(directory, 0)
    servers.push(reopened)
    expect((await reopened.store.view()).connected).toBe(true)
    expect((await reopened.store.view()).items[0].id).toBe(notification.id)
    const beat = await fetch(`http://127.0.0.1:${reopened.port}/api/heartbeat`, {
      method: 'POST',
      headers: { ...headers, 'X-Moa-Key': token },
      body: JSON.stringify({ version: '0.3.4', sessions: { teapot: { connected: true } } })
    })
    expect(beat.status).toBe(200)
  })
  it('rejects cross-site access, DNS rebinding hosts and unpaired origins', async () => {
    const { url } = await fixture()
    expect(
      (await fetch(url + '/api/state', { headers: { Origin: 'https://evil.example' } })).status
    ).toBe(403)
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      request(url + '/api/state', { headers: { Host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
        .on('error', reject)
        .end()
    })
    expect(invalidHost).toBe(403)
    expect(
      (await fetch(url + '/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status
    ).toBe(403)
    expect(
      (
        await fetch(url + '/api/ingest', {
          method: 'OPTIONS',
          headers: { Origin: 'chrome-extension://' + 'b'.repeat(32) }
        })
      ).status
    ).toBe(403)
  })
  it('keeps a usable session expiry and drops everything else the collector sends', async () => {
    const { url, server } = await fixture()
    const opened = await server.store.view()
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'chrome-extension://' + 'c'.repeat(32)
    }
    const pair = await fetch(url + '/api/pair', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: opened.pairCode })
    })
    const { token } = (await pair.json()) as { token: string }
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    const beat = await fetch(url + '/api/heartbeat', {
      method: 'POST',
      headers: { ...headers, 'X-Moa-Key': token },
      body: JSON.stringify({
        version: '0.3.6',
        sessions: {
          teapot: {
            connected: true,
            expiresAt,
            canRenew: true,
            refreshToken: 'must-never-be-stored'
          },
          eden: { connected: true, expiresAt: 'not-a-date', canRenew: 'yes' }
        }
      })
    })
    expect(beat.status).toBe(200)
    const sessions = (await server.store.view()).collector?.sessions
    expect(sessions?.teapot?.expiresAt).toBe(expiresAt)
    expect(sessions?.teapot?.canRenew).toBe(true)
    expect(sessions?.eden?.expiresAt).toBe(null)
    expect(sessions?.eden?.canRenew).toBe(false)
    expect(JSON.stringify(sessions)).not.toContain('must-never-be-stored')
  })
  it('accepts a batch whose timestamps cannot be read and names why a batch is refused', async () => {
    const { url, server } = await fixture()
    const opened = await server.store.view()
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'chrome-extension://' + 'd'.repeat(32)
    }
    const pair = await fetch(url + '/api/pair', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: opened.pairCode })
    })
    const { token } = (await pair.json()) as { token: string }
    const auth = { ...headers, 'X-Moa-Key': token }
    const row = (id: string, at: string | null): Record<string, unknown> => ({
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
    const accepted = await fetch(url + '/api/ingest', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        platform: 'genit',
        channel: 'personal',
        transport: 'direct-api',
        status: 'ok',
        items: [row('a', '2026-09-22T01:00:00Z'), row('b', 'unknown'), row('c', '')]
      })
    })
    expect(accepted.status).toBe(200)
    const items = (await server.store.view()).items
    expect(items).toHaveLength(3)
    expect(items.filter((x) => x.at === null)).toHaveLength(2)
    // A refusal must say which rule it broke, so the collector cannot only report a bare 400.
    const refused = await fetch(url + '/api/ingest', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platform: 'genit', transport: 'direct-api', items: [{ title: 'no id' }] })
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ reason: 'Invalid notification ID' })
  })
  it('does not touch the store when the port is owned by another process', async () => {
    const { directory, server } = await fixture()
    const before = await readFile(join(directory, 'connection.json'))
    await expect(startBridge(directory, server.port)).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(await readFile(join(directory, 'connection.json'))).toEqual(before)
  })
})
