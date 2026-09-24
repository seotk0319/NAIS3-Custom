import { decode as msgpackDecode } from '@msgpack/msgpack'

/**
 * generate-image-stream 응답 파서.
 * 포맷: [4바이트 길이(빅엔디언)][msgpack 메시지] 반복.
 * 이벤트: intermediate(step_ix, image) → 진행 미리보기, final(image) → 완성본.
 * (NAIS2 novelai-api.ts의 검증된 파싱 로직을 Node 환경으로 이식)
 */
export interface StreamHandlers {
  onProgress?: (stepIx: number, previewPng?: Buffer) => void
  signal?: AbortSignal
}

// Received chunks are queued and each byte is copied once, into the message it belongs
// to. Re-concatenating everything received on every chunk made one image cost hundreds
// of full-buffer copies and a matching amount of garbage.
class ChunkQueue {
  private chunks: Uint8Array[] = []
  // Consumed chunks are skipped by index, not shifted out, so tiny chunks stay linear.
  private head = 0
  size = 0
  push(chunk: Uint8Array): void {
    if (!chunk.length) return
    this.chunks.push(chunk)
    this.size += chunk.length
  }
  peekLength(): number {
    const head = new Uint8Array(4)
    let filled = 0
    for (let i = this.head; i < this.chunks.length && filled < 4; i++) {
      const chunk = this.chunks[i]
      const n = Math.min(4 - filled, chunk.length)
      head.set(chunk.subarray(0, n), filled)
      filled += n
    }
    return ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0
  }
  take(n: number): Uint8Array {
    const out = new Uint8Array(n)
    let filled = 0
    while (filled < n) {
      const chunk = this.chunks[this.head]
      const need = n - filled
      if (chunk.length <= need) {
        out.set(chunk, filled)
        filled += chunk.length
        this.head++
      } else {
        out.set(chunk.subarray(0, need), filled)
        this.chunks[this.head] = chunk.subarray(need)
        filled += need
      }
    }
    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
    this.size -= n
    return out
  }
}

export async function readImageStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers = {}
): Promise<Buffer> {
  const reader = body.getReader()
  const queue = new ChunkQueue()
  let finalImage: Buffer | null = null
  let apiError: string | null = null

  try {
    while (true) {
      if (handlers.signal?.aborted) {
        await reader.cancel()
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (value) {
        queue.push(value)

        while (queue.size >= 4) {
          const length = queue.peekLength()
          if (length === 0 || length > 50_000_000) {
            throw new Error(`잘못된 스트림 메시지 길이: ${length}`)
          }
          if (queue.size < 4 + length) break

          queue.take(4)
          const message = queue.take(length)

          const decoded = msgpackDecode(message) as Record<string, unknown>
          const eventType = decoded.event_type ?? decoded.event

          if (decoded.error || decoded.message) {
            apiError = String(decoded.error ?? decoded.message)
            await reader.cancel()
            throw new Error(`NAI 스트림 오류: ${apiError}`)
          }

          const image = decoded.image
          if (eventType === 'intermediate' && typeof decoded.step_ix === 'number') {
            handlers.onProgress?.(
              decoded.step_ix,
              image instanceof Uint8Array ? Buffer.from(image) : undefined
            )
          } else if (eventType === 'final' && image instanceof Uint8Array) {
            finalImage = Buffer.from(image)
          }
        }
      }
      if (done) break
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 이미 해제됨
    }
  }

  if (!finalImage) {
    throw new Error(apiError ?? '스트림에서 최종 이미지를 받지 못함')
  }
  return finalImage
}
