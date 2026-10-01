import { ChevronRight, Lock, LockOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { useGenerationStore } from '../stores/generation-store'
import { useGptStore } from '../stores/gpt-store'
import { usePrivacyStore } from '../stores/privacy-store'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const TRACK = 330
const KNOB = 50
const PAD = 5
const MAX = TRACK - KNOB - PAD * 2

/** 움직임 감시 + 잠금 화면. App에서 한 번만 그린다 */
export function PrivacyLock(): React.JSX.Element | null {
  const enabled = usePrivacyStore((s) => s.enabled)
  const minutes = usePrivacyStore((s) => s.minutes)
  const lockOnHide = usePrivacyStore((s) => s.lockOnHide)
  const locked = usePrivacyStore((s) => s.locked)

  // 마지막 움직임 시각. 다른 앱을 쓰는 동안엔 이 창에 입력이 없으니 그 시간도 쉬는 시간으로 센다
  const last = useRef(0)
  useEffect(() => {
    if (!enabled) return
    last.current = Date.now()
    const bump = (): void => {
      last.current = Date.now()
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const ev of events) window.addEventListener(ev, bump, { passive: true, capture: true })
    const timer = window.setInterval(() => {
      const st = usePrivacyStore.getState()
      if (!st.locked && Date.now() - last.current >= st.minutes * 60000) st.lock('idle')
    }, 2000)
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump, { capture: true })
      window.clearInterval(timer)
    }
  }, [enabled, minutes])

  useEffect(() => {
    if (!enabled || !lockOnHide) return
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') usePrivacyStore.getState().lock('hidden')
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [enabled, lockOnHide])

  // Ctrl+L 바로 잠그기, 잠긴 동안엔 다른 단축키·입력을 모두 막는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = usePrivacyStore.getState()
      if (st.locked) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (
        st.enabled &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'l'
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        st.lock('manual')
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  if (!locked) return null
  return <LockScreen onUnlocked={() => (last.current = Date.now())} />
}

function LockScreen({ onUnlocked }: { onUnlocked: () => void }): React.JSX.Element {
  const minutes = usePrivacyStore((s) => s.minutes)
  const reason = usePrivacyStore((s) => s.reason)
  const unlock = usePrivacyStore((s) => s.unlock)
  const pending = useGenerationStore((s) =>
    s.queue ? s.queue.counts.pending + s.queue.counts.generating : 0
  )
  const gpt = useGptStore(
    (s) => s.jobs.filter((j) => j.state === 'running' || j.state === 'retrying').length
  )
  const remaining = pending + gpt
  const [now, setNow] = useState(() => new Date())
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [opening, setOpening] = useState(false)
  const [shown, setShown] = useState(false)
  const start = useRef<number | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10000)
    const f = requestAnimationFrame(() => setShown(true))
    return () => {
      window.clearInterval(t)
      cancelAnimationFrame(f)
    }
  }, [])

  const finish = (): void => {
    setOpening(true)
    window.setTimeout(() => {
      onUnlocked()
      unlock()
    }, 320)
  }

  const message =
    reason === 'manual'
      ? '바로 잠그기로 화면을 가렸어요'
      : reason === 'hidden'
        ? '창을 내려서 화면을 가렸어요'
        : minutes + '분 동안 움직임이 없어서 화면을 가렸어요'
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')

  return (
    <div
      className={cn(
        'fixed inset-0 z-[10000] flex select-none flex-col items-center justify-center transition-opacity duration-300',
        shown && !opening ? 'opacity-100' : 'opacity-0'
      )}
      style={{
        backdropFilter: 'blur(56px) saturate(0.5) brightness(0.8)',
        background: 'rgba(20,20,36,0.22)'
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="text-[92px] font-light leading-none tracking-[-0.04em] text-white tabular-nums [text-shadow:0_2px_30px_rgba(0,0,0,0.25)]">
        {hh}:{mm}
      </div>
      <div className="mt-2.5 text-[18px] font-medium text-white/90">
        {now.getMonth() + 1}월 {now.getDate()}일 {WEEK[now.getDay()]}요일
      </div>

      <div className="mt-14 w-[380px] rounded-[28px] bg-white/75 px-6 pb-5 pt-6 text-center shadow-[0_20px_60px_rgba(20,20,60,0.25)] ring-1 ring-white/60 backdrop-blur-xl dark:bg-[#1c1c24]/80 dark:ring-white/10">
        <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-accent-soft text-accent">
          {opening ? <LockOpen size={30} strokeWidth={2} /> : <Lock size={30} strokeWidth={2} />}
        </div>
        <div className="mt-3.5 text-[19px] font-extrabold tracking-tight text-ink">잠겨 있어요</div>
        <div className="mt-1.5 text-[13px] text-muted">{message}</div>

        <div
          className="relative mx-auto mt-5 h-[60px] overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/10"
          style={{ width: TRACK }}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full bg-accent-soft',
              !dragging && 'transition-[width] duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)]'
            )}
            style={{ width: KNOB + PAD * 2 + x }}
          />
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-[14px] font-semibold text-faint"
            style={{ opacity: Math.max(0, 1 - (x / MAX) * 1.6) }}
          >
            밀어서 잠금 해제
          </div>
          <div
            role="slider"
            aria-label="밀어서 잠금 해제"
            aria-valuemin={0}
            aria-valuemax={MAX}
            aria-valuenow={Math.round(x)}
            className={cn(
              'absolute grid cursor-grab place-items-center rounded-full bg-accent text-white shadow-[0_4px_14px_rgba(91,91,214,0.4)] active:cursor-grabbing dark:text-paper',
              !dragging && 'transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)]'
            )}
            style={{
              left: PAD,
              top: PAD,
              width: KNOB,
              height: KNOB,
              transform: 'translateX(' + x + 'px)'
            }}
            onPointerDown={(e) => {
              if (opening) return
              start.current = e.clientX - x
              setDragging(true)
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (start.current === null) return
              setX(Math.max(0, Math.min(MAX, e.clientX - start.current)))
            }}
            onPointerUp={() => {
              if (start.current === null) return
              start.current = null
              setDragging(false)
              if (x > MAX * 0.88) {
                setX(MAX)
                finish()
              } else setX(0)
            }}
            onPointerCancel={() => {
              start.current = null
              setDragging(false)
              setX(0)
            }}
          >
            <ChevronRight size={22} strokeWidth={2.2} />
          </div>
        </div>

        {remaining > 0 && (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white/60 px-3 py-1.5 text-[12px] text-muted dark:bg-white/10">
            <i className="size-[7px] animate-pulse rounded-full bg-emerald-500" />
            생성은 계속 진행 중 · 남은 {remaining.toLocaleString()}장
          </div>
        )}
      </div>
    </div>
  )
}
