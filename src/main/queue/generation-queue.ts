import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { GenerationRequest, QueueItem, QueueStatus } from '../../shared/types'

/**
 * 생성 큐. 메인 프로세스 상주 — 렌더러가 리로드/크래시해도 큐는 살아있다.
 *
 * NAIS2에서 고치는 버그들의 구조적 해결 지점:
 * - 예약 취소 후 재예약 시 UI와 실제 큐 상태 불일치 → 큐가 단일 진실 공급원, UI는 'changed' 구독만
 * - 씬 모드에서 생성 지연시간 미적용 → 지연은 큐 루프 한 곳에서만 적용
 */
/** 재시도 대상 HTTP 상태 — 전이성(rate-limit/서버 일시 오류)만. 4xx 클라이언트 오류는 제외 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
/** 전이성 오류 최대 재시도 횟수 (초기 시도 제외) */
const MAX_RETRIES = 3
/** 백오프 기준·상한 (ms) — 실제 대기는 지수 백오프 + 지터, Retry-After가 더 크면 그걸 따름 */
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 20000

export class GenerationQueue extends EventEmitter {
  private static readonly MAX_TERMINAL_ITEMS = 500
  private items = new Map<string, QueueItem>()
  private controllers = new Map<string, AbortController>()
  private running = false
  private delayMs = 600
  private resetVersion = 0
  private terminalCounts = { done: 0, failed: 0, cancelled: 0 }

  constructor(
    private readonly generate: (
      request: GenerationRequest,
      id: string,
      signal: AbortSignal
    ) => Promise<string>
  ) {
    super()
  }

  enqueue(request: GenerationRequest, count: number): string[] {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const id = randomUUID()
      // 배치는 장마다 시드+i — 같은 시드 N장(동일 그림 N장) 방지, 시드 고정 시에도 각 장 재현 가능
      const req = i === 0 ? request : { ...request, seed: (request.seed + i) % 4294967296 }
      this.items.set(id, { id, state: 'pending', request: req })
      ids.push(id)
    }
    this.emitChanged()
    void this.run()
    return ids
  }

  /**
   * 여러 요청을 "한 번에" 큐에 넣는다 (씬 일괄 예약 생성용).
   * 각 요청은 자체 seed를 그대로 쓰며, 전체를 단일 배치로 추가하고 emitChanged/run은 1회만.
   * 렌더러가 항목마다 IPC를 왕복하지 않으므로 큐가 순차로 차오르지 않고, 취소 1번으로 전부 정리된다.
   */
  enqueueMany(requests: GenerationRequest[]): string[] {
    const ids: string[] = []
    for (const request of requests) {
      const id = randomUUID()
      this.items.set(id, { id, state: 'pending', request })
      ids.push(id)
    }
    this.emitChanged()
    void this.run()
    return ids
  }

  cancel(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id)
      if (item && item.state === 'pending') {
        this.markTerminal(item, 'cancelled')
        this.releaseHeavyFields(item)
      } else if (item && item.state === 'generating') {
        this.controllers.get(id)?.abort()
      }
    }
    this.pruneTerminalItems()
    this.emitChanged()
  }

  /** 삭제되는 씬에 연결된 pending/generating 항목을 한 번에 취소한다. */
  cancelScenes(sceneIds: number[]): void {
    if (sceneIds.length === 0) return
    const targets = new Set(sceneIds)
    const ids = [...this.items.values()]
      .filter((item) => item.request.sceneId !== undefined && targets.has(item.request.sceneId))
      .map((item) => item.id)
    this.cancel(ids)
  }

  reset(): void {
    this.resetVersion++
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    for (const item of this.items.values()) {
      this.releaseHeavyFields(item)
    }
    this.controllers.clear()
    this.items.clear()
    this.terminalCounts = { done: 0, failed: 0, cancelled: 0 }
    this.emitChanged()
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms
  }

  status(): QueueStatus {
    let pending = 0
    let generating = 0
    for (const item of this.items.values()) {
      if (item.state === 'pending') pending++
      else if (item.state === 'generating') generating++
    }
    return {
      items: [...this.items.values()].map((item) => this.toStatusItem(item)),
      running: this.running,
      delayMs: this.delayMs,
      counts: { pending, generating, ...this.terminalCounts }
    }
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    const version = this.resetVersion
    try {
      let next: QueueItem | undefined
      while (version === this.resetVersion && (next = this.nextPending())) {
        next.state = 'generating'
        const controller = new AbortController()
        this.controllers.set(next.id, controller)
        this.emitChanged()
        try {
          const filePath = await this.generateWithRetry(next, controller)
          if (version !== this.resetVersion || !this.items.has(next.id)) break
          next.filePath = filePath
          this.markTerminal(next, 'done')
        } catch (e) {
          if (version !== this.resetVersion || !this.items.has(next.id)) break
          if (controller.signal.aborted || isAbortError(e)) {
            this.markTerminal(next, 'cancelled')
          } else {
            next.error = e instanceof Error ? e.message : String(e)
            this.markTerminal(next, 'failed')
          }
        } finally {
          this.controllers.delete(next.id)
          next.retrying = false
        }
        if (version !== this.resetVersion || !this.items.has(next.id)) break
        this.releaseHeavyFields(next)
        this.pruneTerminalItems()
        this.emitChanged()
        if (version === this.resetVersion && this.nextPending()) {
          await sleep(this.delayMs)
        }
      }
    } finally {
      this.running = false
      this.emitChanged()
      if (this.nextPending()) {
        void this.run()
      }
    }
  }

  /**
   * 전이성 오류(429/5xx)면 백오프 후 재시도. 취소는 즉시 중단하고,
   * 재시도 대기 중엔 retrying 플래그로 UI에 알린다 (state는 'generating' 유지).
   * 같은 controller를 재시도 내내 공유하므로 대기 중 취소도 정상 반영된다.
   */
  private async generateWithRetry(item: QueueItem, controller: AbortController): Promise<string> {
    const { signal } = controller
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.generate(item.request, item.id, signal)
      } catch (e) {
        if (signal.aborted || isAbortError(e)) throw e
        if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e
        item.retrying = true
        this.emitChanged()
        await abortableSleep(retryDelayMs(e, attempt), signal)
        item.retrying = false
        if (signal.aborted) throw abortError()
        this.emitChanged()
      }
    }
  }

  private nextPending(): QueueItem | undefined {
    for (const item of this.items.values()) {
      if (item.state === 'pending') return item
    }
    return undefined
  }

  private emitChanged(): void {
    this.emit('changed', this.status())
  }

  private toStatusItem(item: QueueItem): QueueItem {
    const request = { ...item.request }
    delete request.source
    return { ...item, request }
  }

  private releaseHeavyFields(item: QueueItem): void {
    delete item.request.source
    delete item.request.extraCharRefs
  }

  private markTerminal(item: QueueItem, state: 'done' | 'failed' | 'cancelled'): void {
    if (item.state === 'done' || item.state === 'failed' || item.state === 'cancelled') return
    item.state = state
    this.terminalCounts[state]++
  }

  private pruneTerminalItems(): void {
    let terminal = 0
    for (const item of this.items.values()) {
      if (item.state === 'done' || item.state === 'failed' || item.state === 'cancelled') terminal++
    }
    let remove = terminal - GenerationQueue.MAX_TERMINAL_ITEMS
    if (remove <= 0) return
    for (const [id, item] of this.items) {
      if (item.state !== 'done' && item.state !== 'failed' && item.state !== 'cancelled') continue
      this.items.delete(id)
      if (--remove === 0) break
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 취소 시 즉시 깨어나는 sleep — 백오프 대기 중 사용자가 취소하면 곧바로 반환 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || e.message.toLowerCase().includes('abort'))
  )
}

/** 전이성(재시도 가능) 오류인지 — NaiHttpError.status가 429/5xx 계열일 때만 */
function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: number })?.status
  return typeof status === 'number' && RETRYABLE_STATUS.has(status)
}

/** 재시도 대기 시간 — 지수 백오프 + 지터, 서버가 준 Retry-After가 더 크면 그걸 존중 */
function retryDelayMs(e: unknown, attempt: number): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
  const jittered = backoff + backoff * 0.25 * Math.random()
  const retryAfter = (e as { retryAfterMs?: number })?.retryAfterMs ?? 0
  return Math.max(jittered, retryAfter)
}
