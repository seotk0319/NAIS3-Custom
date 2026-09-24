import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encode } from '@msgpack/msgpack'
import { readImageStream } from '../src/main/nai/stream'
import { createPreviewGate } from '../src/main/nai/preview-gate'
import { serveImageFile } from '../src/main/images/serve'

const frame = (message: Record<string, unknown>): Uint8Array => {
  const body = encode(message)
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setUint32(0, body.length)
  out.set(body, 4)
  return out
}
const joined = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const streamOf = (bytes: Uint8Array, sizes: (i: number) => number): ReadableStream<Uint8Array> => {
  let at = 0,
    i = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close()
      const n = sizes(i++)
      controller.enqueue(bytes.slice(at, at + n))
      at += n
    }
  })
}
const pixels = (n: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255)

describe('image stream reader', () => {
  const previews = [pixels(40_000, 1), pixels(40_000, 2), pixels(40_000, 3)]
  const final = pixels(300_000, 9)
  const bytes = joined([
    ...previews.map((image, step) => frame({ event_type: 'intermediate', step_ix: step, image })),
    frame({ event_type: 'final', image: final })
  ])

  it('returns the same steps and final image however the response is chunked', async () => {
    for (const sizes of [
      () => bytes.length,
      () => 1,
      (i: number) => (i % 7) + 1,
      () => 16_384,
      () => 65_537
    ]) {
      const steps: [number, number][] = []
      const result = await readImageStream(streamOf(bytes, sizes), {
        onProgress: (step, preview) => steps.push([step, preview?.length ?? 0])
      })
      expect(steps).toEqual([
        [0, 40_000],
        [1, 40_000],
        [2, 40_000]
      ])
      expect(Buffer.compare(result, Buffer.from(final))).toBe(0)
    }
  })

  it('rejects an impossible message length and an error message from the server', async () => {
    await expect(readImageStream(streamOf(new Uint8Array(8), () => 8))).rejects.toThrow(
      '잘못된 스트림 메시지 길이: 0'
    )
    const failed = frame({ error: 'quota' })
    await expect(readImageStream(streamOf(failed, () => 3))).rejects.toThrow(
      'NAI 스트림 오류: quota'
    )
    const noFinal = frame({ event_type: 'intermediate', step_ix: 0, image: pixels(10, 0) })
    await expect(readImageStream(streamOf(noFinal, () => 5))).rejects.toThrow('최종 이미지')
  })
})

describe('step preview gate', () => {
  it('sends nothing while the window is hidden and at most one preview per interval', () => {
    let now = 0
    const gate = createPreviewGate(250, () => now)
    expect(gate.allow(false)).toBe(false)
    expect(gate.allow(true)).toBe(true)
    now = 100
    expect(gate.allow(true)).toBe(false)
    now = 260
    expect(gate.allow(true)).toBe(true)
    now = 900
    expect(gate.allow(false)).toBe(false)
    expect(gate.allow(true)).toBe(true)
  })
})

describe('image file protocol', () => {
  const directories: string[] = []
  afterEach(async () => {
    for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true })
  })
  it('serves an image whose full path is past the 259-character Windows limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nais-serve-'))
    directories.push(root)
    const name = '작가조합 전용 _ 14인 1명 제외 랜덤 조합 8143 (제외_ sample artist placeholder)'
    const folder = join(
      root,
      'NAIS3_scene_long_parent_folder_for_windows_path_limit',
      'nai_v5_artist_mix_pool15_drop1_random_order_weight_01_12_asset_preset',
      name
    )
    await mkdir(folder, { recursive: true })
    const file = join(folder, name + '.png')
    expect(file.length).toBeGreaterThan(259)
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from(pixels(5_000, 4))
    ])
    await writeFile(file, png)
    const response = serveImageFile(file)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), png)).toBe(0)
    expect(serveImageFile(join(folder, 'missing.png')).status).toBe(404)
    expect(serveImageFile(folder).status).toBe(404)
  })
})
