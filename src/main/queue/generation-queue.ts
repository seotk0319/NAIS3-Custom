import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type {
  GenerationRequest,
  QueueEnqueueBlockedReason,
  QueueEnqueueResult,
  QueueItem,
  QueueStatus
} from '../../shared/types'

/** 재시도 대상 HTTP 상태 — 전이성(rate-limit/서버 일시 오류)만. 4xx 클라이언트 오류는 제외 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 20000

export class AccountPausedError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs = 60000
  ) {
    super(message)
    this.name = 'AccountPausedError'
  }
}

export interface GenerationAccount {
  id: string
  name: string
  token: string
}

export interface GenerationQueueOptions {
  getAccounts?: () => GenerationAccount[]
  accelerationAvailable?: boolean
  isAccelerationEnabled?: () => boolean
  isAnlasSpendingEnabled?: () => boolean
}

interface InternalQueueItem extends QueueItem {
  /** 묶음이 접수될 때 확정한 작업자 집합. 토큰은 담지 않는다. */
  allowedAccountIds: string[]
}

type GenerateFn = (
  request: GenerationRequest,
  id: string,
  signal: AbortSignal,
  account: GenerationAccount
) => Promise<string>

/**
 * 메인 프로세스 상주 생성 스케줄러.
 * - 기본 모드: 첫 계정 하나만 써서 기존 직렬 큐와 동일하게 동작
 * - 가속 모드: 계정마다 동시 요청 1개를 허용하고, 빈 계정이 다음 pending을 가져감
 * - 이미 pending이 남은 동안에는 새 묶음을 받지 않아 씬 대량 생성 사이에 작업이 끼지 않음
 */
export class GenerationQueue extends EventEmitter {
  private static readonly MAX_TERMINAL_ITEMS = 500
  private items = new Map<string, InternalQueueItem>()
  private controllers = new Map<string, AbortController>()
  private activeAccounts = new Map<string, string>()
  private coolingAccounts = new Set<string>()
  private blockedAccounts = new Set<string>()
  private pausedAccounts = new Map<string, { reason: string; retryAt: number }>()
  private pauseTimer?: ReturnType<typeof setTimeout>
  private delayMs = 600
  private resetVersion = 0
  private roundRobinIndex = 0
  private pumping = false
  private terminalCounts = { done: 0, failed: 0, cancelled: 0 }
  private readonly getAccounts: () => GenerationAccount[]
  private readonly accelerationAvailable: boolean
  private readonly isAccelerationEnabled: () => boolean
  private readonly isAnlasSpendingEnabled: () => boolean

  constructor(
    private readonly generate: GenerateFn,
    options: GenerationQueueOptions = {}
  ) {
    super()
    // 기존 단위 테스트와 단일 계정 소비자는 옵션 없이도 정확히 직렬 동작한다.
    this.getAccounts =
      options.getAccounts ?? (() => [{ id: 'default', name: '계정 1', token: 'default' }])
    this.accelerationAvailable = options.accelerationAvailable ?? false
    this.isAccelerationEnabled = options.isAccelerationEnabled ?? (() => false)
    this.isAnlasSpendingEnabled = options.isAnlasSpendingEnabled ?? (() => true)
  }

  enqueue(request: GenerationRequest, count: number): string[] {
    return this.tryEnqueue(request, count).ids
  }

  tryEnqueue(request: GenerationRequest, count: number): QueueEnqueueResult {
    const requests: GenerationRequest[] = []
    for (let i = 0; i < count; i++) {
      requests.push(i === 0 ? request : { ...request, seed: (request.seed + i) % 4294967296 })
    }
    return this.enqueueRequests(requests)
  }

  enqueueMany(requests: GenerationRequest[]): string[] {
    return this.tryEnqueueMany(requests).ids
  }

  tryEnqueueMany(requests: GenerationRequest[]): QueueEnqueueResult {
    return this.enqueueRequests(requests)
  }

  private enqueueRequests(requests: GenerationRequest[]): QueueEnqueueResult {
    if (requests.length === 0) return { ids: [] }
    const accounts = this.accountsForNewBatch()
    const blockedReason = this.blockedReason(accounts)
    if (blockedReason) return { ids: [], blockedReason }

    const allowedAccountIds = accounts.map((account) => account.id)
    const ids: string[] = []
    for (const request of requests) {
      const id = randomUUID()
      this.items.set(id, {
        id,
        state: 'pending',
        request,
        allowedAccountIds: [...allowedAccountIds]
      })
      ids.push(id)
    }
    // 소비자는 첫 changed에서 묶음 전체가 pending인 원자적 스냅샷을 받는다.
    this.emitChanged()
    this.pump()
    return { ids }
  }

  cancel(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id)
      if (item?.state === 'pending') {
        this.markTerminal(item, 'cancelled')
        this.releaseHeavyFields(item)
      } else if (item?.state === 'generating') {
        this.controllers.get(id)?.abort()
      }
    }
    this.pruneTerminalItems()
    this.emitChanged()
    this.pump()
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
    for (const controller of this.controllers.values()) controller.abort()
    for (const item of this.items.values()) this.releaseHeavyFields(item)
    this.controllers.clear()
    this.activeAccounts.clear()
    this.coolingAccounts.clear()
    this.blockedAccounts.clear()
    this.pausedAccounts.clear()
    clearTimeout(this.pauseTimer)
    this.items.clear()
    this.terminalCounts = { done: 0, failed: 0, cancelled: 0 }
    this.emitChanged()
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms
  }

  /** 계정 추가/삭제 또는 가속 토글 뒤 UI와 대기열을 즉시 다시 계산한다. */
  refreshConfiguration(): void {
    if (this.isAnlasSpendingEnabled()) this.pausedAccounts.clear()
    this.emitChanged()
    this.pump()
  }

  isAccountBusy(id: string): boolean {
    return this.activeAccounts.has(id) || this.coolingAccounts.has(id)
  }

  status(): QueueStatus {
    let pending = 0
    let generating = 0
    for (const item of this.items.values()) {
      if (item.state === 'pending') pending++
      else if (item.state === 'generating') generating++
    }
    const allAccounts = this.getAccounts().filter((account) => account.id && account.token.trim())
    const accounts = this.accelerationEnabled() ? allAccounts : allAccounts.slice(0, 1)
    const busyAccountCount = allAccounts.filter((account) => this.isAccountBusy(account.id)).length
    const availableSlots = accounts.filter((account) => this.isAccountIdle(account.id)).length
    return {
      items: [...this.items.values()].map((item) => this.toStatusItem(item)),
      running: pending > 0 || generating > 0,
      delayMs: this.delayMs,
      counts: { pending, generating, ...this.terminalCounts },
      accelerationAvailable: this.accelerationAvailable,
      accelerationEnabled: this.accelerationEnabled(),
      anlasSpendingEnabled: this.isAnlasSpendingEnabled(),
      pausedAccounts: [...this.pausedAccounts]
        .filter(([id]) => allAccounts.some((a) => a.id === id))
        .map(([id, state]) => ({ id, ...state })),
      accountCount: allAccounts.length,
      busyAccountCount,
      availableSlots,
      accepting: pending === 0 && availableSlots > 0
    }
  }

  private accountsForNewBatch(): GenerationAccount[] {
    for (const [id, state] of this.pausedAccounts) {
      if (state.retryAt <= Date.now()) this.pausedAccounts.delete(id)
    }
    const accounts = this.getAccounts().filter((account) => account.id && account.token.trim())
    return this.accelerationEnabled() ? accounts : accounts.slice(0, 1)
  }

  private accelerationEnabled(): boolean {
    return this.accelerationAvailable && this.isAccelerationEnabled()
  }

  private blockedReason(accounts: GenerationAccount[]): QueueEnqueueBlockedReason | undefined {
    if (accounts.length === 0) return 'no-account'
    if (this.nextPending()) return 'pending'
    if (!accounts.some((account) => this.isAccountIdle(account.id))) return 'busy'
    return undefined
  }

  private isAccountIdle(id: string): boolean {
    return (
      !this.activeAccounts.has(id) &&
      !this.coolingAccounts.has(id) &&
      !this.blockedAccounts.has(id) &&
      !this.pausedAccounts.has(id)
    )
  }

  /** 가능한 계정 수만큼 즉시 채운다. 완료 콜백도 이 함수를 다시 호출한다. */
  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    const version = this.resetVersion
    try {
      for (;;) {
        if (version !== this.resetVersion) break
        const dispatch = this.nextDispatchable()
        if (!dispatch) {
          if (this.failOrphanedPending()) continue
          break
        }
        const { item, account } = dispatch
        item.state = 'generating'
        item.accountId = account.id
        const controller = new AbortController()
        this.controllers.set(item.id, controller)
        this.activeAccounts.set(account.id, item.id)
        this.emitChanged()
        void this.execute(item, account, controller, version)
      }
    } finally {
      this.pumping = false
      this.schedulePausedWake()
    }
  }

  private schedulePausedWake(): void {
    clearTimeout(this.pauseTimer)
    if (!this.nextPending() || !this.pausedAccounts.size) return
    const at = Math.min(...[...this.pausedAccounts.values()].map((s) => s.retryAt))
    this.pauseTimer = setTimeout(
      () => {
        for (const [id, state] of this.pausedAccounts) {
          if (state.retryAt <= Date.now()) this.pausedAccounts.delete(id)
        }
        this.emitChanged()
        this.pump()
      },
      Math.max(100, at - Date.now())
    )
    this.pauseTimer.unref?.()
  }

  private nextDispatchable(): { item: InternalQueueItem; account: GenerationAccount } | undefined {
    const accounts = this.getAccounts().filter((account) => account.id && account.token.trim())
    if (accounts.length === 0) return undefined
    for (const item of this.items.values()) {
      if (item.state !== 'pending') continue
      for (let offset = 0; offset < accounts.length; offset++) {
        const index = (this.roundRobinIndex + offset) % accounts.length
        const account = accounts[index]
        if (!item.allowedAccountIds.includes(account.id) || !this.isAccountIdle(account.id))
          continue
        this.roundRobinIndex = (index + 1) % accounts.length
        return { item, account }
      }
    }
    return undefined
  }

  private async execute(
    item: InternalQueueItem,
    account: GenerationAccount,
    controller: AbortController,
    version: number
  ): Promise<void> {
    try {
      const filePath = await this.generateWithRetry(item, account, controller)
      if (version !== this.resetVersion || !this.items.has(item.id)) return
      item.filePath = filePath
      this.markTerminal(item, 'done')
    } catch (error) {
      if (version !== this.resetVersion || !this.items.has(item.id)) return
      if (controller.signal.aborted || isAbortError(error)) {
        this.markTerminal(item, 'cancelled')
      } else if (error instanceof AccountPausedError) {
        if (!this.isAnlasSpendingEnabled()) this.pausedAccounts.set(account.id, {
          reason: error.message,
          retryAt: Date.now() + error.retryAfterMs
        })
        item.state = 'pending'
        delete item.accountId
        delete item.error
      } else {
        item.error = error instanceof Error ? error.message : String(error)
        if (isAccountFatalError(error)) this.blockedAccounts.add(account.id)
        this.markTerminal(item, 'failed')
      }
    } finally {
      this.controllers.delete(item.id)
      if (this.activeAccounts.get(account.id) === item.id) this.activeAccounts.delete(account.id)
      item.retrying = false
      if (version !== this.resetVersion || !this.items.has(item.id)) return

      if (item.state !== 'pending') this.releaseHeavyFields(item)
      this.pruneTerminalItems()
      const shouldDelay = this.delayMs > 0 && !!this.nextPending()
      if (shouldDelay) this.coolingAccounts.add(account.id)
      this.emitChanged()

      // 다른 빈 계정은 이 계정의 지연을 기다리지 않고 즉시 다음 작업을 가져간다.
      this.pump()
      if (shouldDelay) {
        const delay = this.delayMs
        setTimeout(() => {
          if (version !== this.resetVersion) return
          this.coolingAccounts.delete(account.id)
          this.emitChanged()
          this.pump()
        }, delay)
      }
    }
  }

  private async generateWithRetry(
    item: InternalQueueItem,
    account: GenerationAccount,
    controller: AbortController
  ): Promise<string> {
    const { signal } = controller
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.generate(item.request, item.id, signal, account)
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error
        if (attempt >= MAX_RETRIES || !isRetryableError(error)) throw error
        item.retrying = true
        this.emitChanged()
        await abortableSleep(retryDelayMs(error, attempt), signal)
        item.retrying = false
        if (signal.aborted) throw abortError()
        this.emitChanged()
      }
    }
  }

  private nextPending(): InternalQueueItem | undefined {
    for (const item of this.items.values()) {
      if (item.state === 'pending') return item
    }
    return undefined
  }

  /** 삭제되었거나 인증 오류로 정지된 계정만 허용하는 작업은 영원히 pending으로 남기지 않는다. */
  private failOrphanedPending(): boolean {
    const usableIds = new Set(
      this.getAccounts()
        .filter(
          (account) => account.id && account.token.trim() && !this.blockedAccounts.has(account.id)
        )
        .map((account) => account.id)
    )
    let changed = false
    for (const item of this.items.values()) {
      if (item.state !== 'pending') continue
      if (item.allowedAccountIds.some((id) => usableIds.has(id))) continue
      item.error = '사용 가능한 NAI 계정이 없어 생성이 중단됐습니다'
      this.markTerminal(item, 'failed')
      this.releaseHeavyFields(item)
      changed = true
    }
    if (changed) {
      this.pruneTerminalItems()
      this.emitChanged()
    }
    return changed
  }

  private emitChanged(): void {
    this.emit('changed', this.status())
  }

  private toStatusItem(item: InternalQueueItem): QueueItem {
    const { allowedAccountIds: _allowedAccountIds, ...publicItem } = item
    const request = { ...item.request }
    delete request.source
    return { ...publicItem, request }
  }

  private releaseHeavyFields(item: InternalQueueItem): void {
    delete item.request.source
    delete item.request.extraCharRefs
  }

  private markTerminal(item: InternalQueueItem, state: 'done' | 'failed' | 'cancelled'): void {
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

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
  )
}

function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  return typeof status === 'number' && RETRYABLE_STATUS.has(status)
}

function isAccountFatalError(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  return status === 401 || status === 402 || status === 403
}

function retryDelayMs(error: unknown, attempt: number): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
  const jittered = backoff + backoff * 0.25 * Math.random()
  const retryAfter = (error as { retryAfterMs?: number })?.retryAfterMs ?? 0
  return Math.max(jittered, retryAfter)
}
