import { create } from 'zustand'
import type { QueueStatus } from '@shared/types'
import { useGenerationStore } from '../stores/generation-store'

/**
 * 지금 도는 생성 묶음 하나의 진행 상황. 대기열은 세션 누적 완료 수만 알려주므로,
 * 대기열이 비어 있다가 일이 들어온 순간을 시작점으로 잡고 거기서부터 센다.
 * 새 묶음은 이전 묶음의 대기 항목이 남아 있으면 들어오지 않으므로(accepting) 묶음끼리 섞이지 않는다.
 */
export interface QueueRun {
  /** 이번 묶음의 전체 장수 (완료·실패·취소 + 남은 것) */
  total: number
  done: number
  failed: number
  cancelled: number
  /** 대기 + 생성 중 */
  remaining: number
  /** 이번 묶음에 들어온 씬 수와 그중 남은 일이 없는 씬 수 */
  sceneTotal: number
  sceneDone: number
  /** 씬별 이번 묶음 장수 (카드의 "생성 중 12 / 20") */
  perScene: Map<number, number>
  /** 최근 완료 속도로 잡은 분당 장수. 두 장 이상 끝나기 전에는 null */
  perMinute: number | null
}

const RATE_WINDOW = 30

type Base = { done: number; failed: number; cancelled: number }
let base: Base | null = null
let scenes = new Set<number>()
let perScene = new Map<number, number>()
let doneTimes: number[] = []
let lastDone = 0

export const useQueueRun = create<{ run: QueueRun | null }>(() => ({ run: null }))

function active(q: QueueStatus): number {
  return q.counts.pending + q.counts.generating
}

function update(q: QueueStatus | null): void {
  if (!q) return
  const now = active(q)
  if (now === 0) {
    if (base) {
      base = null
      scenes = new Set()
      perScene = new Map()
      doneTimes = []
      useQueueRun.setState({ run: null })
    }
    return
  }
  if (!base || q.counts.done < base.done) {
    // 새 묶음 시작 (또는 F5로 대기열이 초기화돼 누적 수가 줄어든 경우)
    base = { done: q.counts.done, failed: q.counts.failed, cancelled: q.counts.cancelled }
    scenes = new Set()
    perScene = new Map()
    doneTimes = []
    lastDone = q.counts.done
  }
  // 묶음은 처음 들어올 때 전부 pending으로 보인다. 그때 본 씬과 장수를 기억해 둔다.
  const liveByScene = new Map<number, number>()
  for (const item of q.items) {
    const id = item.request.sceneId
    if (id == null || (item.state !== 'pending' && item.state !== 'generating')) continue
    liveByScene.set(id, (liveByScene.get(id) ?? 0) + 1)
  }
  for (const [id, n] of liveByScene) {
    scenes.add(id)
    if (n > (perScene.get(id) ?? 0)) perScene.set(id, n)
  }
  const t = Date.now()
  for (let i = lastDone; i < q.counts.done; i++) doneTimes.push(t)
  lastDone = q.counts.done
  if (doneTimes.length > RATE_WINDOW) doneTimes = doneTimes.slice(-RATE_WINDOW)

  const done = q.counts.done - base.done
  const failed = q.counts.failed - base.failed
  const cancelled = q.counts.cancelled - base.cancelled
  let sceneDone = 0
  for (const id of scenes) if (!liveByScene.has(id)) sceneDone++
  const span = doneTimes.length >= 2 ? doneTimes[doneTimes.length - 1] - doneTimes[0] : 0
  useQueueRun.setState({
    run: {
      total: done + failed + cancelled + now,
      done,
      failed,
      cancelled,
      remaining: now,
      sceneTotal: scenes.size,
      sceneDone,
      perScene: new Map(perScene),
      perMinute: span > 0 ? ((doneTimes.length - 1) / span) * 60000 : null
    }
  })
}

update(useGenerationStore.getState().queue)
useGenerationStore.subscribe((s, prev) => {
  if (s.queue !== prev.queue) update(s.queue)
})

/** "약 5시간 21분" */
export function formatEta(minutes: number): string {
  const m = Math.max(1, Math.round(minutes))
  if (m < 60) return `약 ${m}분`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `약 ${h}시간 ${rest}분` : `약 ${h}시간`
}

