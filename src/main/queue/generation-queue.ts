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
export class GenerationQueue extends EventEmitter {
  private items = new Map<string, QueueItem>()
  private controllers = new Map<string, AbortController>()
  private running = false
  private delayMs = 600
  private resetVersion = 0

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
        item.state = 'cancelled'
        this.releaseHeavyFields(item)
      } else if (item && item.state === 'generating') {
        this.controllers.get(id)?.abort()
      }
    }
    this.emitChanged()
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
    this.emitChanged()
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms
  }

  status(): QueueStatus {
    return {
      items: [...this.items.values()].map((item) => this.toStatusItem(item)),
      running: this.running,
      delayMs: this.delayMs
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
          const filePath = await this.generate(next.request, next.id, controller.signal)
          if (version !== this.resetVersion || !this.items.has(next.id)) break
          next.filePath = filePath
          next.state = 'done'
        } catch (e) {
          if (version !== this.resetVersion || !this.items.has(next.id)) break
          if (controller.signal.aborted || isAbortError(e)) {
            next.state = 'cancelled'
          } else {
            next.state = 'failed'
            next.error = e instanceof Error ? e.message : String(e)
          }
        } finally {
          this.controllers.delete(next.id)
        }
        if (version !== this.resetVersion || !this.items.has(next.id)) break
        this.releaseHeavyFields(next)
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || e.message.toLowerCase().includes('abort'))
  )
}
