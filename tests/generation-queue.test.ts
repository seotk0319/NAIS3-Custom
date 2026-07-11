import { describe, expect, it, vi } from 'vitest'
import { GenerationQueue } from '../src/main/queue/generation-queue'
import type { GenerationRequest } from '../src/shared/types'

const sourceImage = {
  imageBase64: 'source-base64',
  maskBase64: 'mask-base64',
  strength: 0.7,
  noise: 0.1
}

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: '1girl',
    negativePrompt: 'lowres',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: 123,
    variety: false,
    qualityToggle: true,
    ucPreset: 0,
    characterPrompts: [],
    useCoords: false,
    ...overrides
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('GenerationQueue', () => {
  it('strips request.source from status and changed broadcasts while preserving lightweight fields', async () => {
    const queue = new GenerationQueue(() => new Promise<string>(() => undefined))
    const changed = vi.fn()
    queue.on('changed', changed)

    const [id] = queue.enqueue(
      request({
        source: sourceImage,
        sceneId: 42,
        extraCharRefs: [{ filePath: 'char.png', refType: 'character', strength: 1, fidelity: 0.5 }]
      }),
      1
    )
    await tick()

    const item = queue.status().items.find((i) => i.id === id)
    expect(item?.request.source).toBeUndefined()
    expect(item?.request.sceneId).toBe(42)
    expect(item?.request.prompt).toBe('1girl')

    for (const call of changed.mock.calls) {
      const payload = JSON.stringify(call[0])
      expect(payload).not.toContain('source-base64')
      expect(payload).not.toContain('mask-base64')
    }
  })

  it('releases source and extraCharRefs on done, failed, and cancelled terminal items', async () => {
    const done = deferred<string>()
    const failed = deferred<string>()
    const queue = new GenerationQueue(
      vi.fn().mockReturnValueOnce(done.promise).mockReturnValueOnce(failed.promise)
    )
    queue.setDelayMs(0)
    const doneRequest = request({
      source: sourceImage,
      extraCharRefs: [{ filePath: 'a.png', refType: 'style', strength: 1, fidelity: 1 }]
    })
    const failedRequest = request({
      source: sourceImage,
      extraCharRefs: [{ filePath: 'b.png', refType: 'character', strength: 1, fidelity: 1 }]
    })
    const cancelRequest = request({
      source: sourceImage,
      extraCharRefs: [{ filePath: 'c.png', refType: 'costume', strength: 1, fidelity: 1 }]
    })
    const [doneId, failedId, cancelId] = queue.enqueueMany([
      doneRequest,
      failedRequest,
      cancelRequest
    ])

    queue.cancel([cancelId])
    done.resolve('done.png')
    await vi.waitFor(() =>
      expect(queue.status().items.find((i) => i.id === doneId)?.state).toBe('done')
    )

    await vi.waitFor(() =>
      expect(queue.status().items.find((i) => i.id === failedId)?.state).toBe('generating')
    )
    failed.reject(new Error('boom'))
    await vi.waitFor(() =>
      expect(queue.status().items.find((i) => i.id === failedId)?.state).toBe('failed')
    )

    for (const id of [doneId, failedId, cancelId]) {
      const item = queue.status().items.find((i) => i.id === id)
      expect(item?.request.source).toBeUndefined()
      expect(item?.request.extraCharRefs).toBeUndefined()
    }
    for (const originalRequest of [doneRequest, failedRequest, cancelRequest]) {
      expect(originalRequest.source).toBeUndefined()
      expect(originalRequest.extraCharRefs).toBeUndefined()
    }
  })

  it('cleans heavy fields immediately when cancelling a pending item', () => {
    const queue = new GenerationQueue(() => new Promise<string>(() => undefined))
    const [generatingId, pendingId] = queue.enqueueMany([
      request({ source: sourceImage }),
      request({
        source: sourceImage,
        extraCharRefs: [{ filePath: 'pending.png', refType: 'delta', strength: 1, fidelity: 1 }]
      })
    ])

    queue.cancel([pendingId])

    const pending = queue.status().items.find((i) => i.id === pendingId)
    expect(queue.status().items.find((i) => i.id === generatingId)?.state).toBe('generating')
    expect(pending?.state).toBe('cancelled')
    expect(pending?.request.source).toBeUndefined()
    expect(pending?.request.extraCharRefs).toBeUndefined()
  })

  it('reset aborts active controllers, empties immediately, and ignores late completion', async () => {
    const active = deferred<string>()
    let signal: AbortSignal | undefined
    const queue = new GenerationQueue((_request, _id, abortSignal) => {
      signal = abortSignal
      return active.promise
    })

    queue.enqueueMany([request({ source: sourceImage }), request({ source: sourceImage })])
    await vi.waitFor(() => expect(signal).toBeDefined())

    queue.reset()

    expect(signal?.aborted).toBe(true)
    expect(queue.status().items).toEqual([])

    active.resolve('late.png')
    await tick()

    expect(queue.status().items).toEqual([])
    expect(queue.status().running).toBe(false)
  })

  it('keeps enqueueMany atomic enqueue snapshot and serial generation order', async () => {
    const generationOrder: string[] = []
    const queue = new GenerationQueue(async (_request, id) => {
      generationOrder.push(id)
      return `${id}.png`
    })
    queue.setDelayMs(0)
    const changed = vi.fn()
    queue.on('changed', changed)

    const ids = queue.enqueueMany([
      request({ seed: 1 }),
      request({ seed: 2 }),
      request({ seed: 3 })
    ])

    expect(ids).toHaveLength(3)
    expect(changed).toHaveBeenCalled()
    expect(changed.mock.calls[0][0].items.map((item: { id: string }) => item.id)).toEqual(ids)
    expect(changed.mock.calls[0][0].items.map((item: { state: string }) => item.state)).toEqual([
      'pending',
      'pending',
      'pending'
    ])

    await vi.waitFor(() => {
      expect(queue.status().items.map((item) => item.state)).toEqual(['done', 'done', 'done'])
    })
    expect(generationOrder).toEqual(ids)
    expect(queue.status().items.map((item) => item.filePath)).toEqual(ids.map((id) => `${id}.png`))
  })

  it('cancels pending and generating items for deleted scenes only', async () => {
    const active = deferred<string>()
    let activeSignal: AbortSignal | undefined
    const queue = new GenerationQueue((_request, _id, signal) => {
      activeSignal = signal
      return active.promise
    })
    const [generating, pendingSameScene, untouched] = queue.enqueueMany([
      request({ sceneId: 7 }),
      request({ sceneId: 7 }),
      request({ sceneId: 8 })
    ])
    await vi.waitFor(() => expect(activeSignal).toBeDefined())

    queue.cancelScenes([7])

    expect(activeSignal?.aborted).toBe(true)
    expect(queue.status().items.find((item) => item.id === pendingSameScene)?.state).toBe(
      'cancelled'
    )
    expect(queue.status().items.find((item) => item.id === untouched)?.state).toBe('pending')
    expect(queue.status().items.find((item) => item.id === generating)?.state).toBe('generating')
  })

  it('bounds retained terminal items while preserving cumulative counts', async () => {
    const queue = new GenerationQueue(async (_request, id) => `${id}.png`)
    queue.setDelayMs(0)
    queue.enqueueMany(Array.from({ length: 600 }, (_, seed) => request({ seed })))

    await vi.waitFor(() => expect(queue.status().counts.done).toBe(600), { timeout: 10_000 })

    const status = queue.status()
    expect(status.items).toHaveLength(500)
    expect(status.items.every((item) => item.state === 'done')).toBe(true)
    expect(status.counts).toMatchObject({ done: 600, pending: 0, generating: 0 })
  })
})
