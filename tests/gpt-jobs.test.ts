import { describe, expect, it, vi } from 'vitest'
import type { GptJob } from '../src/shared/gpt'

const calls: number[] = []
vi.mock('../src/main/gpt/auth', () => ({
  GptAuthError: class extends Error {},
  getCredentials: async () => ({ accessToken: 't', accountId: 'a' })
}))
vi.mock('../src/main/images/storage', () => ({
  saveGeneratedImage: async () => ({
    id: 1,
    filePath: 'C:/x/gpt.png',
    thumbnail: '',
    kind: 'gpt',
    seed: 0,
    createdAt: '',
    virtualFolderId: null
  })
}))
vi.mock('../src/main/db', () => ({ getDb: () => ({}) }))
vi.mock('../src/main/gpt/client', async () => {
  const real =
    await vi.importActual<typeof import('../src/main/gpt/client')>('../src/main/gpt/client')
  return {
    ...real,
    requestImage: async () => {
      calls.push(Date.now())
      if (calls.length === 1) throw new real.GptHttpError('slow down', 429, 10)
      return { png: Buffer.from('png'), revisedPrompt: 'ok', sent: {} }
    }
  }
})

describe('gpt jobs', () => {
  it('waits and resends when ChatGPT says to slow down, then saves the image', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { generate, initGpt, listJobs } = await import('../src/main/gpt/service')
    const seen: GptJob['state'][] = []
    initGpt(
      (jobs) => seen.push(jobs[0]?.state),
      () => undefined
    )
    await generate(
      {
        prompt: 'cup',
        refs: [],
        size: 'auto',
        quality: 'low',
        model: 'gpt-5.6-luna',
        mode: 'direct'
      },
      1
    )
    await vi.waitFor(() => expect(seen).toContain('retrying'))
    await vi.advanceTimersByTimeAsync(6000)
    await vi.waitFor(() => expect(listJobs()[0].state).toBe('done'))
    expect(calls).toHaveLength(2)
    expect(listJobs()[0]).toMatchObject({ filePath: 'C:/x/gpt.png', attempt: 2 })
    vi.useRealTimers()
  })

  it('starts every requested image at once, with no cap', async () => {
    const { generate, listJobs } = await import('../src/main/gpt/service')
    const before = listJobs().length
    const { ids } = await generate(
      {
        prompt: 'cup',
        refs: [],
        size: 'auto',
        quality: 'low',
        model: 'gpt-5.6-luna',
        mode: 'direct'
      },
      30
    )
    expect(ids).toHaveLength(30)
    expect(listJobs().length - before).toBe(30)
  })
})
