import { Copy, Equal, Lock, TrendingDown, TrendingUp, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { comboString, hasArtistToken, insertArtists, type ArenaDuel } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { useGenerationStore } from '../../stores/generation-store'
import { useLayoutStore } from '../../stores/layout-store'
import { toast } from '../../stores/toast-store'
import { Button } from '../ui/button'
import { ArenaImage, Card, Chip, Kbd, Question, SceneChip } from './arena-common'
import { TagCaption } from './arena-duel'
import {
  copyText,
  digitOf,
  gridStyle,
  useArenaKeys,
  useBestGrid,
  useCellRatio
} from './arena-utils'

type NegDuelT = Extract<ArenaDuel, { kind: 'neg' }>

const JUDGES = [
  { rating: -1 as const, label: '나빠졌어요', icon: TrendingDown },
  { rating: 0 as const, label: '비슷해요', icon: Equal },
  { rating: 1 as const, label: '나아졌어요', icon: TrendingUp }
]

export function NegDuel({ duel }: { duel: NegDuelT }): React.JSX.Element {
  const ratio = useCellRatio()
  const [ref, g] = useBestGrid(2, ratio, 16)
  const scene = useArenaStore((s) => s.snapshot?.session.slots[duel.slot]?.scene)
  const fixed = useArenaStore((s) => s.snapshot?.session.config.fixedPositive)
  const negWeight = useArenaStore((s) => s.snapshot?.session.config.negWeight ?? 1)
  const canUndo = useArenaStore((s) => s.snapshot?.canUndo ?? false)
  const vote = useArenaStore((s) => s.vote)
  const undo = useArenaStore((s) => s.undo)
  const [picked, setPicked] = useState<number | null>(null)

  const judge = (k: number): void => {
    if (picked != null || useArenaStore.getState().voting) return
    setPicked(k)
    void vote({ kind: 'neg', rating: JUDGES[k].rating })
  }
  useArenaKeys((e) => {
    const d = digitOf(e)
    if (d != null && d <= 3 && !e.shiftKey) {
      judge(d - 1)
      return true
    }
    return false
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {fixed && fixed.length > 0 && (
          <Chip className="bg-paper" title={comboString(fixed)}>
            <Lock size={12} />
            긍정 고정 <b className="text-ink">{fixed[0].tag}</b>
            {fixed.length > 1 ? ' 외 ' + (fixed.length - 1) + '명' : ''}
          </Chip>
        )}
        <Chip className="bg-paper">
          네거티브 가중치 <b className="text-ink">{negWeight.toFixed(1)}</b>
        </Chip>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <Question extra={<SceneChip slot={duel.slot} scene={scene} />}>
          후보가 기준보다 나아졌나요?
        </Question>
        <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
          <div className="grid gap-4" style={gridStyle(g)}>
            {[duel.baseline, duel.candidate].map((id, i) => (
              <div key={id} className="relative min-h-0 overflow-hidden rounded-2xl bg-surface-2">
                <ArenaImage comboId={id} slot={duel.slot} full />
                <span
                  className={cn(
                    'absolute left-3 top-3 rounded-md px-2 py-0.5 text-[12px] font-semibold',
                    i === 0 ? 'bg-surface/95 text-ink' : 'bg-accent text-white dark:text-paper'
                  )}
                >
                  {i === 0 ? '기준' : '후보'}
                </span>
                {i === 1 && <TagCaption comboId={id} className="absolute inset-x-3 bottom-3" />}
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="ghost" size="sm" disabled={!canUndo} onClick={() => void undo()}>
            <Undo2 size={13} />
            되돌리기 <Kbd>Ctrl Z</Kbd>
          </Button>
          <div className="flex-1" />
          {JUDGES.map((j, k) => {
            const Icon = j.icon
            return (
              <Button
                key={j.label}
                size="lg"
                onClick={() => judge(k)}
                className={cn(
                  'h-12 min-w-[136px] rounded-xl',
                  k === 0 &&
                    'border-transparent bg-danger/10 font-semibold text-danger hover:bg-danger/15',
                  k === 2 &&
                    'border-transparent bg-accent-soft font-semibold text-accent hover:bg-accent-soft',
                  picked === k && 'ring-2 ring-accent'
                )}
              >
                <Icon size={15} />
                {j.label} <Kbd>{k + 1}</Kbd>
              </Button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function ratingText(score: number | null | undefined, rated: number | undefined): string {
  if (!rated) return '아직 안 봤어요'
  const s = score ?? 0
  const mood = s > 0.3 ? '대체로 나아졌어요' : s < -0.3 ? '대체로 나빠졌어요' : '비슷해요'
  return mood + ' · ' + rated + '판'
}

export function NegDone(): React.JSX.Element {
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const sessionName = useArenaStore((s) => s.snapshot?.session.name ?? '')
  const candidates = useMemo(
    () =>
      (combos ?? [])
        .filter((c) => c.source === 'candidate')
        .sort((a, b) => (b.negScore ?? -2) - (a.negScore ?? -2)),
    [combos]
  )
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const chosen = picked ?? new Set(candidates.filter((c) => (c.negScore ?? 0) > 0).map((c) => c.id))
  const toggle = (id: number): void => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }
  const tags = comboString(candidates.filter((c) => chosen.has(c.id)).flatMap((c) => c.pairs))

  const putInMain = (): void => {
    if (!tags) return
    const g = useGenerationStore.getState()
    const np = g.request.negativePrompt
    const next = hasArtistToken(np)
      ? insertArtists(np, tags)
      : np.trim()
        ? np.replace(/[\s,]+$/, '') + ', ' + tags
        : tags
    g.patchRequest({ negativePrompt: next })
    toast('메인 네거티브에 넣었어요', 'success')
    useLayoutStore.getState().setCenterMode('main')
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <Card className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div>
          <h2 className="text-[16px] font-bold tracking-tight">네거티브 후보를 다 봤어요</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {sessionName} · 나아졌다고 고른 작가가 먼저 골라져 있어요
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {candidates.map((c) => {
            const on = chosen.has(c.id)
            const s = c.negScore ?? 0
            return (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 border-b border-line py-2.5 text-[13px] last:border-b-0 [contain-intrinsic-size:auto_44px] [content-visibility:auto]"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(c.id)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.pairs.map((p) => p.tag).join(', ')}
                </span>
                <span
                  className={cn(
                    'text-[12px]',
                    !c.negRated
                      ? 'text-faint'
                      : s > 0.3
                        ? 'font-semibold text-accent'
                        : s < -0.3
                          ? 'text-danger'
                          : 'text-muted'
                  )}
                >
                  {ratingText(c.negScore, c.negRated)}
                </span>
              </label>
            )
          })}
          {candidates.length === 0 && (
            <p className="py-8 text-center text-[13px] text-faint">후보가 없어요</p>
          )}
        </div>
      </Card>
      <Card className="flex w-[380px] shrink-0 flex-col gap-4 p-5">
        <div>
          <h3 className="text-[15px] font-bold">쓸 작가 {chosen.size}명</h3>
          <p className="mt-0.5 text-[12px] text-muted">네거티브의 작가 조합 자리에 들어가요</p>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <p className="min-h-[48px] select-text break-all font-mono text-[12px] leading-relaxed">
            {tags || <span className="text-faint">왼쪽에서 작가를 골라요</span>}
          </p>
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!tags} onClick={() => void copyText(tags)}>
              <Copy size={13} />
              태그 복사
            </Button>
          </div>
        </div>
        <div className="flex-1" />
        <Button
          variant="accent"
          size="lg"
          disabled={!tags}
          className="h-12 rounded-xl text-[15px]"
          onClick={putInMain}
        >
          메인 네거티브에 넣기
        </Button>
      </Card>
    </div>
  )
}
