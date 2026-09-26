import { formatWeight } from '@shared/arena'
import { Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ArenaDuel } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { ArenaImage, Card, Kbd, Question, SceneChip } from './arena-common'
import { digitOf, gridStyle, useArenaKeys, useBestGrid, useCellRatio } from './arena-utils'

type TuneDuelT = Extract<ArenaDuel, { kind: 'tune' }>
type OrderDuelT = Extract<ArenaDuel, { kind: 'order' }>

/** 지금 순서와 비교해 옮긴 작가 하나와 몇 칸 옮겼는지 (+ = 앞으로) */
function movedArtist(base: string[], order: string[]): { tag: string; by: number } | null {
  let best: { tag: string; by: number } | null = null
  for (const tag of order) {
    const by = base.indexOf(tag) - order.indexOf(tag)
    if (by === 0) continue
    if (!best || Math.abs(by) > Math.abs(best.by) || (Math.abs(by) === Math.abs(best.by) && by > 0))
      best = { tag, by }
  }
  return best
}

/** 네 장 한 줄 + 아래 이름표. 세기·순서 고르기가 같이 쓴다 */
function FourRow({
  ids,
  slot,
  picked,
  onPick,
  labels
}: {
  ids: number[]
  slot: number
  picked: number | null
  onPick: (i: number) => void
  labels: ReactNode[]
}): React.JSX.Element {
  const ratio = useCellRatio()
  const n = Math.max(1, ids.length)
  // 칸마다 이름표 줄(약 60px)을 뺀 높이로 맞춘다
  const [ref, g] = useBestGrid(n, ratio, 12, 60)
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      <div className="grid gap-3" style={gridStyle(g, 60)}>
        {ids.map((id, i) => (
          <div key={id} className="flex min-w-0 flex-col gap-2">
            <button
              onClick={() => onPick(i)}
              className={cn(
                'relative overflow-hidden rounded-2xl bg-surface-2',
                picked === i && 'ring-[3px] ring-accent'
              )}
              style={{ height: g.cellH }}
            >
              <ArenaImage comboId={id} slot={slot} full />
            </button>
            <div className="flex min-h-[44px] items-start gap-2 px-0.5">
              <div className="min-w-0 flex-1">{labels[i]}</div>
              <Kbd className="mt-1">{i + 1}</Kbd>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function useChooser(ids: number[], kind: 'tune' | 'order'): [number | null, (i: number) => void] {
  const vote = useArenaStore((s) => s.vote)
  const [picked, setPicked] = useState<number | null>(null)
  const choose = (i: number): void => {
    if (i < 0 || i >= ids.length || picked != null || useArenaStore.getState().voting) return
    setPicked(i)
    void vote({ kind, chosen: ids[i] })
  }
  useArenaKeys((e) => {
    const d = digitOf(e)
    if (d != null && !e.shiftKey && d <= ids.length) {
      choose(d - 1)
      return true
    }
    return false
  })
  return [picked, choose]
}

function Footer({ hint }: { hint: ReactNode }): React.JSX.Element {
  const canUndo = useArenaStore((s) => s.snapshot?.canUndo ?? false)
  const undo = useArenaStore((s) => s.undo)
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Button className="rounded-xl" disabled={!canUndo} onClick={() => void undo()}>
        <Undo2 size={14} />
        되돌리기 <Kbd>Ctrl Z</Kbd>
      </Button>
      <div className="min-w-0 flex-1">{hint}</div>
      <span className="text-[12px] text-faint">
        마음에 드는 장을 누르거나 <Kbd>1</Kbd> – <Kbd>4</Kbd>
      </span>
    </div>
  )
}

export function TuneDuel({ duel }: { duel: TuneDuelT }): React.JSX.Element {
  const scene = useArenaStore((s) => s.snapshot?.session.slots[duel.slot]?.scene)
  const tune = useArenaStore((s) => s.snapshot?.session.state.tune)
  const ids = duel.options.map((o) => o.comboId)
  const [picked, choose] = useChooser(ids, 'tune')
  const done = (tune?.artists ?? []).filter((a) => a !== duel.artist && tune?.chosen[a] != null)
  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <Question
        extra={
          <>
            <SceneChip slot={duel.slot} scene={scene} />
            <span className="text-[12.5px] text-muted">
              {duel.step} / {duel.total}
            </span>
          </>
        }
      >
        {duel.artist}, 어느 세기가 제일 좋아요?
      </Question>
      <FourRow
        ids={ids}
        slot={duel.slot}
        picked={picked}
        onPick={choose}
        labels={duel.options.map((o) => (
          <div key={o.comboId} className="flex items-baseline gap-2">
            <b className="text-[20px] font-bold tabular-nums">{formatWeight(o.weight)}</b>
            {Math.abs(o.weight - duel.current) < 0.001 && (
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">
                지금 값
              </span>
            )}
          </div>
        ))}
      />
      <Footer
        hint={
          done.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">고른 세기</span>
              {done.map((a) => (
                <span key={a} className="rounded-md bg-surface px-2 py-0.5 text-[12px]">
                  {a}{' '}
                  <b className="text-accent">
                    {tune?.chosen[a] != null ? formatWeight(tune.chosen[a]) : null}
                  </b>
                </span>
              ))}
            </div>
          ) : null
        }
      />
    </Card>
  )
}

export function OrderDuel({ duel }: { duel: OrderDuelT }): React.JSX.Element {
  const scene = useArenaStore((s) => s.snapshot?.session.slots[duel.slot]?.scene)
  const ids = duel.options.map((o) => o.comboId)
  const [picked, choose] = useChooser(ids, 'order')
  const base = duel.options[0]?.order ?? []
  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <Question extra={<SceneChip slot={duel.slot} scene={scene} />}>
        어떤 순서가 제일 좋아요?
      </Question>
      <FourRow
        ids={ids}
        slot={duel.slot}
        picked={picked}
        onPick={choose}
        labels={duel.options.map((o, i) => {
          const mv = i === 0 ? null : movedArtist(base, o.order)
          return (
            <div key={o.comboId} className="flex flex-col gap-1.5" title={o.order.join(' → ')}>
              <span className="text-[12.5px] font-semibold">
                {i === 0 ? (
                  <span className="rounded-md bg-surface px-1.5 py-0.5 text-ink">지금 순서</span>
                ) : mv ? (
                  <>
                    <span className="text-accent">{mv.tag}</span>{' '}
                    {mv.by > 0 ? '앞으로 ' + mv.by + '칸' : '뒤로 ' + -mv.by + '칸'}
                  </>
                ) : null}
              </span>
              <div className="flex flex-wrap gap-1">
                {o.order.map((tag, k) => (
                  <span
                    key={tag}
                    className={cn(
                      'max-w-[120px] truncate rounded-md px-1.5 py-0.5 text-[11px]',
                      mv?.tag === tag
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'bg-surface-2 text-ink'
                    )}
                  >
                    <b className="mr-0.5 text-muted">{k + 1}</b>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      />
      <Footer
        hint={
          <span className="text-[12px] text-muted">
            다듬은 세기 그대로 순서만 한 곳씩 바꿨어요 · 작가는 앞에 둘수록 크게 들어가요
          </span>
        }
      />
    </Card>
  )
}
