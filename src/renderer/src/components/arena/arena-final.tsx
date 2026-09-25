import { ChevronLeft, ChevronRight, LayoutGrid, Minimize2, Undo2 } from 'lucide-react'
import { memo, useState } from 'react'
import type { ArenaDuel } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { ArenaImage, Card, Chip, Kbd, ProgressBar, Question } from './arena-common'
import { TagCaption } from './arena-duel'
import {
  digitOf,
  gridStyle,
  useArenaKeys,
  useBestGrid,
  useCellRatio,
  useFitBox
} from './arena-utils'

type SetDuel = Extract<ArenaDuel, { kind: 'set' }>

const WINNER = ['a', 'same', 'b'] as const

export function FinalDuel({ duel }: { duel: SetDuel }): React.JSX.Element {
  const ratio = useCellRatio()
  const vote = useArenaStore((s) => s.vote)
  const canUndo = useArenaStore((s) => s.snapshot?.canUndo ?? false)
  const undo = useArenaStore((s) => s.undo)
  const scenes = useArenaStore((s) => s.snapshot?.session.slots)
  const [zoom, setZoom] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  const choose = (k: number): void => {
    if (picked != null || useArenaStore.getState().voting) return
    setPicked(k)
    void vote({ kind: 'set', winner: WINNER[k] })
  }
  const move = (d: number): void =>
    setZoom((z) => (z == null ? z : (z + d + duel.slots.length) % duel.slots.length))

  useArenaKeys((e) => {
    const n = digitOf(e)
    if (n != null && n <= 3 && !e.shiftKey) {
      choose(n - 1)
      return true
    }
    if (zoom != null) {
      if (e.key === 'Escape') {
        setZoom(null)
        return true
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        move(e.key === 'ArrowLeft' ? -1 : 1)
        return true
      }
    }
    return false
  })

  const left = Math.max(0, duel.total - duel.index)
  const slot = zoom != null ? duel.slots[zoom] : null

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Question
          extra={
            slot != null ? (
              <Chip title={scenes?.[slot]?.scene}>장면 {slot + 1} · 시드 고정</Chip>
            ) : (
              <Chip>
                <LayoutGrid size={13} />
                장면 12개 · 같은 자리는 같은 장면 · 같은 시드
              </Chip>
            )
          }
        >
          어느 세트가 더 좋아요?
        </Question>
        <div className="flex-1" />
        {zoom != null && (
          <>
            <Button size="icon" className="rounded-xl" onClick={() => move(-1)}>
              <ChevronLeft size={15} />
            </Button>
            <Button size="icon" className="rounded-xl" onClick={() => move(1)}>
              <ChevronRight size={15} />
            </Button>
            <Button className="rounded-xl" onClick={() => setZoom(null)}>
              <Minimize2 size={14} />
              세트로 보기 <Kbd>Esc</Kbd>
            </Button>
          </>
        )}
      </div>

      {slot == null ? (
        <div className="flex min-h-0 flex-1 gap-5">
          {(['a', 'b'] as const).map((side, i) => (
            <div key={side} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <span className={cn('text-[13px] font-semibold', picked === i * 2 && 'text-accent')}>
                {side === 'a' ? '왼쪽 세트' : '오른쪽 세트'}
              </span>
              <SetGrid
                comboId={side === 'a' ? duel.a : duel.b}
                slots={duel.slots}
                ratio={ratio}
                picked={picked === i * 2}
                onCell={setZoom}
              />
              <TagCaption comboId={side === 'a' ? duel.a : duel.b} className="bg-surface" />
            </div>
          ))}
        </div>
      ) : (
        <ZoomPair a={duel.a} b={duel.b} slot={slot} ratio={ratio} />
      )}

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[13px] font-semibold">{left}판 남았어요</span>
        <ProgressBar value={duel.total ? duel.index / duel.total : 0} className="w-28" />
        <span className="text-[12px] text-faint">결과가 뚜렷하면 일찍 끝나요</span>
        <Button variant="ghost" size="sm" disabled={!canUndo} onClick={() => void undo()}>
          <Undo2 size={13} />
          되돌리기 <Kbd>Ctrl Z</Kbd>
        </Button>
        <div className="flex-1" />
        {(['왼쪽 세트', '비슷해요', '오른쪽 세트'] as const).map((label, k) => (
          <Button
            key={label}
            size="lg"
            onClick={() => choose(k)}
            className={cn(
              'h-12 min-w-[128px] rounded-xl',
              k !== 1 &&
                'border-transparent bg-accent-soft font-semibold text-accent hover:bg-accent-soft',
              picked === k && 'ring-2 ring-accent'
            )}
          >
            {label} <Kbd>{k + 1}</Kbd>
          </Button>
        ))}
      </div>
    </Card>
  )
}

const SetGrid = memo(function SetGrid({
  comboId,
  slots,
  ratio,
  picked,
  onCell
}: {
  comboId: number
  slots: number[]
  ratio: number
  picked: boolean
  onCell: (index: number) => void
}): React.JSX.Element {
  const [ref, box] = useFitBox((ratio * 4) / 3)
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-start justify-center">
      <div
        className={cn(
          'grid grid-cols-4 grid-rows-3 gap-2 rounded-xl',
          picked && 'ring-[3px] ring-accent ring-offset-4 ring-offset-paper'
        )}
        style={{ width: box.width, height: box.height }}
      >
        {slots.slice(0, 12).map((slot, i) => (
          <button
            key={slot}
            onClick={() => onCell(i)}
            className="min-h-0 overflow-hidden rounded-lg bg-surface-2"
            title={'장면 ' + (slot + 1) + ' 크게 보기'}
          >
            <ArenaImage comboId={comboId} slot={slot} compact />
          </button>
        ))}
      </div>
    </div>
  )
})

function ZoomPair({
  a,
  b,
  slot,
  ratio
}: {
  a: number
  b: number
  slot: number
  ratio: number
}): React.JSX.Element {
  const [ref, g] = useBestGrid(2, ratio, 16)
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      <div className="grid gap-4" style={gridStyle(g)}>
        {[a, b].map((id, i) => (
          <div key={id} className="relative min-h-0 overflow-hidden rounded-2xl bg-surface-2">
            <ArenaImage comboId={id} slot={slot} full />
            <span className="absolute left-3 top-3 rounded-md bg-surface/95 px-2 py-0.5 text-[12px] font-semibold">
              {i === 0 ? '왼쪽 세트' : '오른쪽 세트'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
