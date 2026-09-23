import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Electron's cookie session and OS encryption are the only parts replaced here; routes,
// renewal and normalization run for real.
const electron = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      fetch: (url: string, init: RequestInit) => electron.fetch(url, init),
      setUserAgent: () => undefined,
      cookies: {
        get: async () => [],
        set: async () => undefined,
        remove: async () => undefined,
        flushStore: async () => undefined
      }
    })
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('sealed:' + value),
    decryptString: (value: Buffer) => value.toString().replace(/^sealed:/, '')
  }
}))

import { createDirectCollector } from '../src/main/notifications/direct/collector'
import { profileUpdate } from '../src/main/notifications/direct/engine.mjs'

const directories: string[] = []
afterEach(async () => {
  electron.fetch.mockReset()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const teaToken = (claims: Record<string, unknown>): string =>
  'test.' +
  Buffer.from(
    JSON.stringify({
      iss: 'https://securetoken.google.com/chat-ai-7a275',
      aud: 'chat-ai-7a275',
      sub: 'test-self',
      ...claims
    })
  ).toString('base64url') +
  '.test'

describe('in-app collector', () => {
  it('renews an expired bearer once mid-collection and keeps every secret out of the inbox', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nais-collector-test-'))
    directories.push(directory)
    const now = Math.floor(Date.now() / 1000)
    const stale = 'Bearer ' + teaToken({ exp: now + 3600 }),
      fresh = 'Bearer ' + teaToken({ exp: now + 7200 })
    const profile = profileUpdate('teapot', {
      origin: 'https://firestore.googleapis.com',
      headers: { authorization: stale },
      renewal: {
        kind: 'firebase',
        apiKey: 'A'.repeat(39),
        refreshToken: 'firebase-refresh-secret-value'
      }
    })
    const sealed = join(directory, 'direct-sessions.bin')
    await writeFile(
      sealed,
      'sealed:' +
        JSON.stringify({
          version: 1,
          userAgent: null,
          platforms: { teapot: { profile, connectedAt: new Date().toISOString() } },
          checkpoints: {},
          lastRun: {}
        })
    )
    let renewals = 0
    const firestore: string[] = []
    electron.fetch.mockImplementation(async (url, init) => {
      if (url.startsWith('https://securetoken.googleapis.com/v1/token?key=')) {
        renewals++
        return json({ id_token: fresh.slice(7), refresh_token: 'rotated-firebase-token' })
      }
      if (url.startsWith('https://firestore.googleapis.com/v1/')) {
        const auth = (init.headers as Record<string, string>).authorization
        firestore.push(auth)
        return auth === fresh ? json([]) : json({ error: { message: 'invalid auth' } }, 401)
      }
      throw new Error('UNEXPECTED_REQUEST ' + url)
    })
    const batches: Record<string, unknown>[] = []
    const collector = createDirectCollector({
      directory,
      profileDir: join(directory, 'browser-profile'),
      version: 'test',
      store: {
        ingest: async (batch) => {
          batches.push(structuredClone(batch))
          return { accepted: 0, added: 0 }
        },
        heartbeat: async () => ({ enabled: true, selection: {} })
      }
    })
    await collector.collect()
    await collector.stop()

    expect(renewals).toBe(1)
    expect(firestore.slice(0, 2)).toEqual([stale, fresh])
    expect(batches.some((b) => b.platform === 'teapot' && b.status === 'login')).toBe(false)
    expect(batches.some((b) => b.platform === 'teapot' && b.channel === 'personal')).toBe(true)
    // The rotated session is what survives a restart, still sealed on disk.
    const stored = JSON.parse((await readFile(sealed)).toString().replace(/^sealed:/, '')).platforms
      .teapot.profile
    expect(stored.renewal.refreshToken).toBe('rotated-firebase-token')
    expect(stored.headers.authorization).toBe(fresh)
    const inbox = JSON.stringify(batches)
    for (const secret of [
      'firebase-refresh-secret-value',
      'rotated-firebase-token',
      fresh.slice(7)
    ])
      expect(inbox).not.toContain(secret)
  })

  it('leaves a platform the person turned off alone', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nais-collector-test-'))
    directories.push(directory)
    const profile = profileUpdate('neko', {
      origin: 'https://www.nekochat.xyz',
      headers: { authorization: 'neko-test' }
    })
    await writeFile(
      join(directory, 'direct-sessions.bin'),
      'sealed:' +
        JSON.stringify({
          version: 1,
          userAgent: null,
          platforms: { neko: { profile, connectedAt: new Date().toISOString() } },
          checkpoints: {},
          lastRun: {}
        })
    )
    electron.fetch.mockImplementation(async () =>
      json({ notifications: [], pagination: { hasMore: false } })
    )
    const collector = createDirectCollector({
      directory,
      profileDir: join(directory, 'browser-profile'),
      version: 'test',
      store: {
        ingest: async () => ({ accepted: 0, added: 0 }),
        heartbeat: async () => ({ enabled: true, selection: { neko: false } })
      }
    })
    await collector.collect()
    await collector.stop()
    expect(electron.fetch).not.toHaveBeenCalled()
  })
})
