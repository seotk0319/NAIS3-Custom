import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createStore } from '../src/main/notifications/core/store.mjs'
import { queryInbox } from '../src/main/notifications/query'
import {
  CAPTURE_SCRIPT,
  captureComplete,
  cookieBelongs,
  cookieNames,
  loginSignal,
  startWatch,
  sessionReady
} from '../src/main/notifications/direct/platforms'
import type { InboxItem, InboxView } from '../src/shared/inbox'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('noticing a finished sign-in without touching the page', () => {
  const eden = 'https://www.eden-chat.com/'
  const cookie = (name: string, domain = '.eden-chat.com'): { name: string; domain: string } => ({
    name,
    domain
  })
  it('reads only platform cookie names and ignores analytics', () => {
    const names = cookieNames('eden', [
      cookie('sb-x-auth-token.0'),
      cookie('sb-x-auth-token.0'),
      cookie('_ga'),
      cookie('_ga_ABC'),
      cookie('session', '.rplay.live')
    ])
    expect(names).toBe('sb-x-auth-token.0')
  })
  it('fires when the tab comes back from Google, and not before the page settles', () => {
    let watch = startWatch(0)
    const step = (names: string, urls: string[], now: number): boolean => {
      const result = loginSignal('eden', watch, { names, urls }, now)
      watch = result.watch
      return result.fire
    }
    expect(step('csrf', [eden], 2_000)).toBe(false)
    expect(step('csrf', [eden], 6_000)).toBe(false) // baseline taken here
    expect(step('csrf', [eden], 8_000)).toBe(false)
    expect(step('csrf', ['https://accounts.google.com/o/oauth2/v2/auth?x=1'], 10_000)).toBe(false)
    // Back on the platform, but the first attempt waits until 15 s after the tab opened.
    expect(step('csrf', [eden + 'callback'], 12_000)).toBe(false)
    expect(step('csrf', [eden], 16_000)).toBe(true)
    // One trip to Google yields one attempt.
    expect(step('csrf', [eden], 40_000)).toBe(false)
  })
  it('fires once a new cookie has stayed put, and spaces out further attempts', () => {
    let watch = startWatch(0)
    const step = (names: string, now: number): boolean => {
      const result = loginSignal('eden', watch, { names, urls: [eden] }, now)
      watch = result.watch
      return result.fire
    }
    step('csrf', 6_000)
    expect(step('csrf', 20_000)).toBe(false)
    expect(step('csrf\nrefresh', 21_000)).toBe(false)
    expect(step('csrf\nrefresh', 23_000)).toBe(false)
    expect(step('csrf\nrefresh', 24_000)).toBe(true)
    // Still changed but just tried: the next quiet check waits 15 s.
    expect(step('csrf\nrefresh', 30_000)).toBe(false)
    expect(step('csrf\nrefresh', 39_000)).toBe(true)
  })
})
async function openStore(
  directory?: string
): Promise<{ directory: string; store: Awaited<ReturnType<typeof createStore>> }> {
  const dir = directory || (await mkdtemp(join(tmpdir(), 'nais-direct-test-')))
  if (!directory) directories.push(dir)
  return { directory: dir, store: await createStore(dir) }
}

describe('in-app sign-in capture', () => {
  it('moves a cookie only to the platform that owns its domain', () => {
    expect(cookieBelongs('eden', '.eden-chat.com')).toBe(true)
    expect(cookieBelongs('eden', 'api.eden-chat.com')).toBe(true)
    expect(cookieBelongs('babe', 'babechatapi.com')).toBe(true)
    // Look-alike and foreign domains never ride along.
    expect(cookieBelongs('eden', 'evil-eden-chat.com')).toBe(false)
    expect(cookieBelongs('eden', 'eden-chat.com.evil.io')).toBe(false)
    expect(cookieBelongs('eden', '.rplay.live')).toBe(false)
  })

  it('waits for the credentials each platform needs before ending a capture', () => {
    const bearer = { headers: { authorization: 'Bearer x' } }
    const renewal = { renewal: { kind: 'rplay', refreshToken: 'r'.repeat(20) } }
    expect(captureComplete('rplay', { ...bearer, ...renewal, routes: {} })).toBe(false)
    expect(
      captureComplete('rplay', {
        ...bearer,
        ...renewal,
        routes: { '/account/getuser': 'https://api.rplay.live/account/getuser?requestorOid=1' }
      })
    ).toBe(true)
    expect(captureComplete('eden', bearer)).toBe(false)
    // Elyn's three-day bearer is only worth adopting with the cookie that renews it.
    expect(captureComplete('elyn', bearer)).toBe(false)
    expect(
      captureComplete('elyn', { ...bearer, renewal: { kind: 'elyn', refreshToken: 'e' } })
    ).toBe(true)
    expect(captureComplete('genit', { headers: {} })).toBe(true)
    expect(captureComplete('eden', undefined)).toBe(false)
    expect(sessionReady('teapot', { ...bearer, queries: [] })).toBe(false)
    expect(sessionReady('elyn', bearer)).toBe(true)
  })

  it('stays inert on a sign-in page and starts the capture on a platform page', () => {
    const run = (hostname: string): { posted: unknown[]; queue: unknown } => {
      const posted: unknown[] = []
      const window = {
        addEventListener: () => undefined,
        postMessage: (message: unknown) => posted.push(message),
        fetch: () => Promise.resolve()
      }
      const context: Record<string, unknown> = {
        location: { hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
        window,
        XMLHttpRequest: class XMLHttpRequest {},
        Headers,
        URL,
        URLSearchParams
      }
      context.globalThis = context
      runInNewContext(CAPTURE_SCRIPT, context)
      return { posted, queue: (context as { __moaCaptured?: unknown }).__moaCaptured }
    }
    const google = run('accounts.google.com')
    expect(google.posted).toEqual([])
    expect(google.queue).toBeUndefined()
    const eden = run('www.eden-chat.com')
    expect(eden.queue).toEqual([])
    expect(eden.posted).toEqual([{ source: 'moa-api-start' }])
  })
})

describe('platform selection', () => {
  it('remembers a platform turned off and leaves it out of the inbox, not the store', async () => {
    const { directory, store } = await openStore()
    await store.select('crack', false)
    expect(
      (await store.heartbeat({ version: 'x', running: true, sessions: {} })).selection
    ).toEqual({
      crack: false
    })
    await expect(store.select('nowhere', false)).rejects.toThrow('Invalid selection')
    const { store: reopened } = await openStore(directory)
    const view = await reopened.view()
    expect(view.selection).toEqual({ crack: false })

    const row = (id: string, platform: InboxItem['platform']): InboxItem => ({
      id,
      platform,
      event: 'comment',
      sourceType: '댓글',
      title: '새 댓글',
      body: '',
      actor: { id: null, name: null },
      work: { id: null, title: null, url: null },
      at: null,
      unread: true,
      url: null
    })
    const inbox: InboxView = {
      ...view,
      items: [row('e1', 'eden'), row('c1', 'crack'), row('c2', 'crack')]
    }
    const result = queryInbox(inbox)
    expect(result.items.map((x) => x.id)).toEqual(['e1'])
    expect([result.total, result.unread, result.events.comment]).toEqual([1, 1, 1])
    const crack = result.platforms.find((p) => p.id === 'crack')!
    expect([crack.selected, crack.count]).toEqual([false, 2])
  })
})
