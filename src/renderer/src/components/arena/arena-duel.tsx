import { Maximize2, Minimize2, SkipForward, ThumbsDown, Undo2 } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { STAGE_LABELS, type ArenaDuel, type ArenaRender } from '@shared/arena'
import { thumbnailUrl } from '../../lib/constants'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { ContextMenuItem } from '../ui/context-menu'
import {
  ArenaImage,
  Card,
  Chip,
  Kbd,
  Placeholder,
  ProgressBar,
  Question,
  SceneChip,
  Thumb
} from './arena-common'
import {
  comboThumbs,
  digitOf,
  useArenaKeys,
  useCellRatio,
  useComboText,
  useFitBox,
  gridStyle,
  useBestGrid
} from './arena-utils'

type QuadDuelT = Extract<ArenaDuel, { kind: 'quad' }>

/** 작가 태그 보기가 켜졌을 때만 이미지 아래에 붙는 줄 */
export function TagCaption({
  comboId,
  className
}: {
  comboId: number | undefined
  className?: string
}): React.JSX.Element | null {
  const show = useArenaStore((s) => s.showTags)
  const text = useComboText(comboId)
  if (!show || !text) return null
  return (
    <div
      title={text}
      className={cn(
        'truncate rounded-md bg-surface/95 px-2 py-1 font-mono text-[10.5px] leading-tight text-ink',
        className
      )}
    >
      {text}
    </div>
  )
}

// ───────────────────────── 2×2 대결 ─────────────────────────

export function QuadDuel({ duel }: { duel: QuadDuelT }): React.JSX.Element {
  const ratio = useCellRatio()
  const scene = useArenaStore((s) => s.snapshot?.session.slots[duel.slot]?.scene)
  const vote = useArenaStore((s) => s.vote)
  const skip = useArenaStore((s) => s.skip)
  const [worst, setWorst] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const ids = duel.comboIds

  const choose = (i: number): void => {
    if (i < 0 || i >= ids.length || picked != null || useArenaStore.getState().voting) return
    setPicked(i)
    void vote({
      kind: 'quad',
      best: ids[i],
      worst: worst != null && worst !== i ? ids[worst] : undefined
    })
  }
  const toggleWorst = (i: number): void => {
    if (i < 0 || i >= ids.length || picked != null) return
    setWorst((w) => (w === i ? null : i))
  }

  useArenaKeys((e) => {
    const d = digitOf(e)
    if (d != null && d <= ids.length) {
      if (e.shiftKey) toggleWorst(d - 1)
      else choose(d - 1)
      return true
    }
    if (e.key === 'Escape' && zoom != null) {
      setZoom(null)
      return true
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      void skip()
      return true
    }
    return false
  })

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <Card className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Question extra={<SceneChip slot={duel.slot} scene={scene} />}>
            가장 마음에 드는 그림을 골라요
          </Question>
          <div className="flex-1" />
          {zoom != null ? (
            <Button className="rounded-xl" onClick={() => setZoom(null)}>
              <Minimize2 size={14} />
              작게 보기 <Kbd>Esc</Kbd>
            </Button>
          ) : null}
        </div>
        {zoom == null ? (
          <QuadGrid
            ids={ids}
            slot={duel.slot}
            ratio={ratio}
            worst={worst}
            picked={picked}
            onPick={choose}
            onWorst={toggleWorst}
            onZoom={setZoom}
          />
        ) : (
          <QuadZoom
            ids={ids}
            slot={duel.slot}
            ratio={ratio}
            focus={zoom}
            worst={worst}
            picked={picked}
            onFocus={setZoom}
            onPick={choose}
          />
        )}
        <QuadFooter />
      </Card>
      <QuadSide />
    </div>
  )
}

function QuadGrid(props: {
  ids: number[]
  slot: number
  ratio: number
  worst: number | null
  picked: number | null
  onPick: (i: number) => void
  onWorst: (i: number) => void
  onZoom: (i: number) => void
}): React.JSX.Element {
  const [ref, g] = useBestGrid(4, props.ratio)
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      <div className="grid gap-3" style={gridStyle(g)}>
        {props.ids.map((id, i) => (
          <QuadCard
            key={id}
            index={i}
            comboId={id}
            slot={props.slot}
            worst={props.worst === i}
            picked={props.picked === i}
            onPick={props.onPick}
            onWorst={props.onWorst}
            onZoom={props.onZoom}
          />
        ))}
      </div>
    </div>
  )
}

const QuadCard = memo(function QuadCard({
  index,
  comboId,
  slot,
  worst,
  picked,
  onPick,
  onWorst,
  onZoom
}: {
  index: number
  comboId: number
  slot: number
  worst: boolean
  picked: boolean
  onPick: (i: number) => void
  onWorst: (i: number) => void
  onZoom: (i: number) => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group relative min-h-0 overflow-hidden rounded-2xl bg-surface-2 transition-shadow',
        worst && 'ring-2 ring-danger',
        picked && 'ring-[3px] ring-accent'
      )}
    >
      <button className="block size-full cursor-pointer" onClick={() => onPick(index)}>
        <ArenaImage
          comboId={comboId}
          slot={slot}
          full
          menuExtra={
            <ContextMenuItem onSelect={() => onWorst(index)}>
              <ThumbsDown size={13} className="text-danger" />
              {worst ? '제일 별로 표시 빼기' : '제일 별로로 표시'}
            </ContextMenuItem>
          }
        />
      </button>
      <span className="pointer-events-none absolute left-2.5 top-2.5 grid size-6 place-items-center rounded-md bg-surface/95 text-[12px] font-bold text-ink">
        {index + 1}
      </span>
      <button
        title="크게 보기"
        onClick={() => onZoom(index)}
        className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-md bg-surface/95 text-muted hover:text-ink"
      >
        <Maximize2 size={14} />
      </button>
      <div className="absolute inset-x-2.5 bottom-2.5 flex items-end gap-2">
        <button
          onClick={() => onWorst(index)}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold',
            worst ? 'bg-danger text-white' : 'bg-surface/95 text-muted hover:text-danger'
          )}
        >
          <ThumbsDown size={12} />
          제일 별로
        </button>
        <TagCaption comboId={comboId} className="min-w-0 flex-1" />
        {picked && (
          <span className="flex h-7 shrink-0 items-center rounded-lg bg-accent px-2.5 text-[12px] font-semibold text-white dark:text-paper">
            골랐어요
          </span>
        )}
      </div>
    </div>
  )
})

function QuadZoom(props: {
  ids: number[]
  slot: number
  ratio: number
  focus: number
  worst: number | null
  picked: number | null
  onFocus: (i: number) => void
  onPick: (i: number) => void
}): React.JSX.Element {
  const [ref, box] = useFitBox(props.ratio)
  const i = props.focus
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl bg-surface-2',
            props.worst === i && 'ring-2 ring-danger',
            props.picked === i && 'ring-[3px] ring-accent'
          )}
          style={{ width: box.width, height: box.height }}
        >
          <button className="block size-full" onClick={() => props.onPick(i)}>
            <ArenaImage comboId={props.ids[i]} slot={props.slot} full />
          </button>
          <span className="pointer-events-none absolute left-3 top-3 grid size-7 place-items-center rounded-md bg-surface/95 text-[13px] font-bold">
            {i + 1}
          </span>
          <TagCaption comboId={props.ids[i]} className="absolute inset-x-3 bottom-3" />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2">
        <span className="mr-2 text-[12.5px] text-muted">
          <b className="text-ink">{i + 1}번</b>을 크게 보는 중 · 다른 칸을 누르면 바꿔 봐요
        </span>
        {props.ids.map((id, k) => (
          <button
            key={id}
            onClick={() => props.onFocus(k)}
            className={cn(
              'relative h-[92px] overflow-hidden rounded-lg bg-surface-2',
              k === i ? 'ring-2 ring-accent' : props.worst === k ? 'ring-2 ring-danger' : ''
            )}
            style={{ width: Math.round(92 * props.ratio) }}
          >
            <ArenaImage comboId={id} slot={props.slot} compact />
            <span className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-surface/95 text-[11px] font-bold">
              {k + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function QuadFooter(): React.JSX.Element {
  const stage = useArenaStore((s) => s.snapshot?.session.stage ?? 'prelim')
  const votes = useArenaStore((s) => s.snapshot?.progress.stageVotes ?? 0)
  const r = useArenaStore((s) => s.snapshot?.progress.renders)
  const canUndo = useArenaStore((s) => s.snapshot?.canUndo ?? false)
  const skip = useArenaStore((s) => s.skip)
  const undo = useArenaStore((s) => s.undo)
  const total = r ? r.done + r.queued + r.missing + r.failed : 0
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-[12.5px] text-muted">
        {STAGE_LABELS[stage]} {votes}판 · 생성 {r?.done.toLocaleString() ?? 0} /{' '}
        {total.toLocaleString()}
      </span>
      <div className="flex-1" />
      <Button className="rounded-xl" onClick={() => void skip()}>
        <SkipForward size={14} />
        건너뛰기 <Kbd>S</Kbd>
      </Button>
      <Button className="rounded-xl" disabled={!canUndo} onClick={() => void undo()}>
        <Undo2 size={14} />
        되돌리기 <Kbd>Ctrl Z</Kbd>
      </Button>
    </div>
  )
}

// ───────────────────────── 오른쪽 칸 ─────────────────────────

function QuadSide(): React.JSX.Element {
  const stage = useArenaStore((s) => s.snapshot?.session.stage ?? 'prelim')
  const progress = useArenaStore((s) => s.snapshot?.progress)
  const setPeek = useArenaStore((s) => s.setPeekStage)
  if (!progress) return <div />
  const nextName = stage === 'prelim' ? '본선' : '결선'
  const left = Math.max(0, progress.stageTarget - progress.stageVotes)
  const newRenders = progress.next?.newRenders ?? 0
  return (
    <Card className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
      <div>
        <div className="text-[12px] text-muted">{STAGE_LABELS[stage]}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <b className="text-[30px] font-bold tabular-nums tracking-tight">{progress.stageVotes}</b>
          <span className="text-[14px] font-semibold">판 했어요</span>
        </div>
        <ProgressBar
          className="mt-2"
          value={progress.stageTarget ? progress.stageVotes / progress.stageTarget : 0}
        />
        <p className="mt-2 text-[12.5px] text-muted">
          {progress.ready
            ? nextName + '으로 갈 준비가 됐어요'
            : '조합마다 세 번씩 보면 ' + nextName + '으로 가요 · 약 ' + left + '판 남았어요'}
        </p>
      </div>
      <LastVote />
      <Leaders />
      <div className="flex-1" />
      {progress.ready ? (
        <div className="flex flex-col gap-1.5">
          <Button
            variant="accent"
            size="lg"
            className="h-12 rounded-xl text-[15px]"
            onClick={() => setPeek(true)}
          >
            {nextName}으로 · 약 {newRenders.toLocaleString()}장
          </Button>
          <p className="text-center text-[11.5px] text-faint">더 겨루고 싶으면 계속 골라도 돼요</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button size="lg" className="h-11 rounded-xl" onClick={() => setPeek(true)}>
            지금 {nextName}으로
          </Button>
          <p className="text-center text-[11.5px] text-faint">
            지금까지의 순위로 {stage === 'prelim' ? '상위 30개' : '상위 8개'}를 올려요
          </p>
        </div>
      )}
    </Card>
  )
}

/** 직전 판. 고른 직후 1.2초 동안 "방금 N번을 골랐어요"로 보여준다 */
function LastVote(): React.JSX.Element | null {
  const last = useArenaStore((s) => s.lastVote)
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (!last) return
    const left = 1200 - (Date.now() - last.at)
    if (left <= 0) return
    const t0 = setTimeout(() => setFresh(true), 0)
    const t1 = setTimeout(() => setFresh(false), left)
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
    }
  }, [last])
  if (!last || last.duel.kind !== 'quad' || last.result.kind !== 'quad') return null
  const { comboIds, slot } = last.duel
  const { best, worst } = last.result
  const bestIdx = comboIds.indexOf(best)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className={cn(fresh ? 'font-semibold text-accent' : 'text-muted')}>
          {fresh ? '방금 ' + (bestIdx + 1) + '번을 골랐어요' : '직전 판 · 장면 ' + (slot + 1)}
        </span>
        {worst != null && (
          <span className="text-faint">{comboIds.indexOf(worst) + 1}번은 제일 별로</span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {comboIds.map((id) => (
          <div
            key={id}
            className={cn(
              'relative aspect-square overflow-hidden rounded-lg bg-surface-2',
              id === best && 'ring-2 ring-accent',
              id === worst && 'ring-2 ring-danger'
            )}
          >
            <ArenaImage comboId={id} slot={slot} compact />
            {id === best && (
              <span className="absolute bottom-1 left-1 rounded bg-surface/95 px-1 text-[10px] font-semibold text-accent">
                고름
              </span>
            )}
            {id === worst && (
              <span className="absolute bottom-1 left-1 rounded bg-surface/95 px-1 text-[10px] font-semibold text-danger">
                별로
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Leaders(): React.JSX.Element | null {
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const top = useMemo(() => {
    if (!combos || !renders) return []
    const thumbs = comboThumbs(renders)
    return combos
      .filter((c) => !c.hidden && c.rank != null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, rank: c.rank ?? 0, path: thumbs.get(c.id) ?? null }))
  }, [combos, renders])
  const count = useMemo(() => combos?.filter((c) => !c.hidden).length ?? 0, [combos])
  if (top.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>지금 앞서는 조합</span>
        <span className="text-faint">{count}개 중</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {top.map((t) => (
          <Thumb key={t.id} path={t.path} className="aspect-square w-full">
            <span className="absolute left-1 top-1 grid size-4 place-items-center rounded bg-surface/95 text-[10px] font-bold">
              {t.rank}
            </span>
          </Thumb>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────── 기다리는 중 ─────────────────────────

const WAIT_TITLE: Record<string, string> = {
  prelim: '가장 마음에 드는 그림을 골라요',
  main: '가장 마음에 드는 그림을 골라요',
  final: '어느 세트가 더 좋아요?',
  tune: '세기마다 한 장씩 만드는 중이에요',
  order: '어떤 순서가 제일 좋아요?',
  neg: '후보가 기준보다 나아졌나요?'
}

function pickWaitImages(renders: ArenaRender[], count: number): string[] {
  // 어떤 판이 먼저 열릴지는 메인이 정하므로, 완성본이 가장 많이 모인 장면을 보여준다
  const bySlot = new Map<number, string[]>()
  for (const r of renders) {
    if (r.state !== 'done' || !r.filePath) continue
    const list = bySlot.get(r.slot) ?? []
    list.push(r.filePath)
    bySlot.set(r.slot, list)
  }
  let best: string[] = []
  for (const list of bySlot.values()) if (list.length > best.length && list.length < 4) best = list
  return best.slice(0, count)
}

export function WaitView(): React.JSX.Element {
  const wait = useArenaStore((s) => s.snapshot?.wait ?? null)
  const stage = useArenaStore((s) => s.snapshot?.session.stage ?? 'prelim')
  const votes = useArenaStore((s) => s.snapshot?.voteCount ?? 0)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const ratio = useCellRatio()
  const [ref, g] = useBestGrid(4, ratio)
  const ready = wait?.ready ?? 0
  const needed = wait?.needed ?? 4
  const tiles = Math.min(4, Math.max(1, needed))
  const shown = Math.min(tiles, needed <= 4 ? ready : Math.floor((ready / Math.max(1, needed)) * 4))
  const images = useMemo(() => (renders ? pickWaitImages(renders, shown) : []), [renders, shown])
  const leftCount = Math.max(0, needed - ready)
  const secs = Math.max(10, leftCount * 8)
  const eta = secs >= 90 ? '약 ' + Math.round(secs / 60) + '분' : '약 ' + secs + '초'
  const idle = wait != null && wait.queued === 0
  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <Question
        extra={
          <Chip className="text-accent">
            {ready.toLocaleString()} / {needed.toLocaleString()}장 모였어요
          </Chip>
        }
      >
        {WAIT_TITLE[stage] ?? '이미지를 만드는 중이에요'}
      </Question>
      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
        <div className="grid gap-3" style={gridStyle(g)}>
          {Array.from({ length: 4 }, (_, i) =>
            i >= tiles ? (
              <div key={i} />
            ) : (
              <div key={i} className="relative min-h-0 overflow-hidden rounded-2xl">
                {images[i] ? (
                  <img
                    src={thumbnailUrl(images[i])}
                    decoding="async"
                    draggable={false}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Placeholder state={idle ? 'missing' : 'queued'} className="rounded-2xl" />
                )}
                <span className="absolute left-2.5 top-2.5 grid size-6 place-items-center rounded-md bg-surface/95 text-[12px] font-bold">
                  {i + 1}
                </span>
              </div>
            )
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div>
          <b className="text-[14px]">
            {idle
              ? '지금 만드는 이미지가 없어요'
              : (votes === 0 ? '첫 대결까지 ' : '다음 대결까지 ') + eta}
          </b>
          <p className="text-[12px] text-muted">
            {idle
              ? '위의 ‘남은 이미지 뽑기’를 누르면 이어서 만들어요'
              : '다 모이면 바로 대결이 열려요 · 나온 이미지는 먼저 채워져요'}
          </p>
        </div>
        <div className="flex-1" />
      </div>
    </Card>
  )
}
