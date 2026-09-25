import { ArrowLeft, ArrowUp, BarChart3, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FINAL_SIZE, MAIN_SIZE, REVIVE_COUNT, type ArenaComboView } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { Card, Thumb, TierChip } from './arena-common'
import { comboThumbs, useLimitGate, winRateText } from './arena-utils'

function byRank(a: ArenaComboView, b: ArenaComboView): number {
  return (a.rank ?? 1e9) - (b.rank ?? 1e9)
}

/** 한 단계의 대결이 끝났을 때 (또는 먼저 넘어가 보기) */
export function StageEnd(): React.JSX.Element {
  const stage = useArenaStore((s) => s.snapshot?.session.stage)
  if (stage === 'final') return <FinalEnd />
  if (stage === 'prelim' || stage === 'main') return <PrelimMainEnd stage={stage} />
  return <Stuck />
}

function Stuck(): React.JSX.Element {
  const refresh = useArenaStore((s) => s.refresh)
  return (
    <Card className="grid flex-1 place-items-center p-8">
      <div className="text-center">
        <b className="text-[15px]">다음 판을 준비하고 있어요</b>
        <p className="mt-1 text-[12.5px] text-muted">잠시 뒤에도 그대로면 새로 불러와 주세요</p>
        <Button className="mt-4 rounded-xl" onClick={() => void refresh()}>
          새로 불러오기
        </Button>
      </div>
    </Card>
  )
}

function PrelimMainEnd({ stage }: { stage: 'prelim' | 'main' }): React.JSX.Element {
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const mainIds = useArenaStore((s) => s.snapshot?.session.state.mainIds)
  const reviveIds = useArenaStore((s) => s.snapshot?.reviveIds ?? [])
  const progress = useArenaStore((s) => s.snapshot?.progress)
  const hasDuel = useArenaStore((s) => s.snapshot?.duel != null)
  const model = useArenaStore((s) => s.snapshot?.session.config.params.model ?? '')
  const advancing = useArenaStore((s) => s.advancing)
  const advance = useArenaStore((s) => s.advance)
  const setPeek = useArenaStore((s) => s.setPeekStage)
  const [revive, setRevive] = useState<number[]>([])
  const { gate, dialog } = useLimitGate()

  const prelim = stage === 'prelim'
  const size = prelim ? MAIN_SIZE : FINAL_SIZE
  const { top, pool, byId, thumbs } = useMemo(() => {
    const list = (combos ?? []).filter((c) => !c.hidden)
    const inStage = prelim || !mainIds ? list : list.filter((c) => mainIds.includes(c.id))
    const sorted = [...inStage].sort(byRank)
    return {
      top: sorted.slice(0, size),
      pool: list.length,
      byId: new Map(list.map((c) => [c.id, c])),
      thumbs: comboThumbs(renders ?? [])
    }
  }, [combos, renders, mainIds, prelim, size])

  const newRenders = (progress?.next?.newRenders ?? 0) + (prelim ? revive.length * 4 : 0)
  const ready = progress?.ready ?? false
  const nextName = prelim ? '본선' : '결선'
  const title = ready
    ? (prelim ? '예선' : '본선') + '이 끝났어요. 상위 ' + size + '개가 ' + nextName + '에 올라가요'
    : '지금까지의 순위로 상위 ' + size + '개를 ' + nextName + '에 올려요'
  const sub = prelim
    ? '조합 ' +
      pool +
      '개를 ' +
      (progress?.stageVotes ?? 0) +
      '판 동안 봤어요 · 본선은 조합마다 장면 4개, 이미 있는 장면은 다시 써요'
    : '본선 ' + (progress?.stageVotes ?? 0) + '판 · 결선은 장면 12개 세트끼리 겨뤄요'

  const start = (): void =>
    gate(
      newRenders,
      model,
      (limit) => void advance({ reviveIds: prelim ? revive : undefined, limit })
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-[12.5px] text-muted">{sub}</p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">
          {top.map((c) => (
            <Thumb key={c.id} path={thumbs.get(c.id)} className="aspect-square w-full rounded-xl">
              <span
                className={cn(
                  'absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-md px-1 text-[11px] font-bold',
                  (c.rank ?? 99) <= FINAL_SIZE && prelim
                    ? 'bg-accent text-white dark:text-paper'
                    : 'bg-surface/95 text-ink'
                )}
              >
                {c.rank}
              </span>
            </Thumb>
          ))}
        </div>
        {prelim && reviveIds.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <b className="text-[14px]">패자부활</b>
              <span className="text-[12px] text-muted">
                아깝게 떨어진 조합이에요 · {REVIVE_COUNT}개까지 골라 올릴 수 있어요
              </span>
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
              {reviveIds.map((id) => {
                const c = byId.get(id)
                const on = revive.includes(id)
                const wins =
                  c?.winRate != null
                    ? Math.round(c.games * (c.winRate <= 1 ? c.winRate : c.winRate / 100))
                    : null
                return (
                  <div
                    key={id}
                    className={cn(
                      'flex gap-3 rounded-2xl border bg-paper p-2.5',
                      on ? 'border-accent' : 'border-transparent'
                    )}
                  >
                    <Thumb path={thumbs.get(id)} className="size-[84px] rounded-xl">
                      <span className="absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-md bg-surface/95 px-1 text-[11px] font-bold">
                        {c?.rank}
                      </span>
                    </Thumb>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <b className="text-[13px]">
                        {c ? (wins != null ? c.games + '판 ' + wins + '승' : c.games + '판') : ''}
                      </b>
                      <span className="text-[11.5px] text-muted">탈락선 바로 아래예요</span>
                      <div className="flex-1" />
                      <Button
                        size="sm"
                        variant={on ? 'default' : 'ghost'}
                        className={cn('self-start rounded-lg', on ? 'text-accent' : 'bg-surface')}
                        disabled={!on && revive.length >= REVIVE_COUNT}
                        onClick={() =>
                          setRevive((r) => (on ? r.filter((x) => x !== id) : [...r, id]))
                        }
                      >
                        {on ? <Check size={13} /> : <ArrowUp size={13} />}
                        {on ? '올렸어요' : '올리기 +4장'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <p className="mt-5 flex items-center gap-1.5 text-[12px] text-faint">
          <BarChart3 size={13} />
          떨어진 조합도 순위 탭에 그대로 남아요
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {hasDuel && (
          <Button className="h-11 rounded-xl" onClick={() => setPeek(false)}>
            <ArrowLeft size={14} />
            대결로 돌아가기
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-[12px] text-muted">
          {prelim && revive.length > 0 ? '패자부활 ' + revive.length + '개 포함 · ' : ''}새 이미지
          약 {newRenders.toLocaleString()}장
        </span>
        <Button
          variant="accent"
          size="lg"
          disabled={advancing}
          className="h-12 min-w-[220px] rounded-xl text-[15px]"
          onClick={start}
        >
          {nextName} 시작 · 약 {newRenders.toLocaleString()}장
        </Button>
      </div>
      {dialog}
    </div>
  )
}

function FinalEnd(): React.JSX.Element {
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const finalIds = useArenaStore((s) => s.snapshot?.session.state.finalIds)
  const newRenders = useArenaStore((s) => s.snapshot?.progress.next?.newRenders ?? 0)
  const model = useArenaStore((s) => s.snapshot?.session.config.params.model ?? '')
  const showTags = useArenaStore((s) => s.showTags)
  const advancing = useArenaStore((s) => s.advancing)
  const advance = useArenaStore((s) => s.advance)
  const { gate, dialog } = useLimitGate()
  const { list, thumbs } = useMemo(() => {
    const all = combos ?? []
    const ids = finalIds ?? []
    const l = (
      ids.length
        ? all.filter((c) => ids.includes(c.id))
        : all.filter((c) => c.stageReached === 'final')
    )
      .slice()
      .sort(byRank)
    return { list: l, thumbs: comboThumbs(renders ?? []) }
  }, [combos, renders, finalIds])
  const [picked, setPicked] = useState<number | null>(null)
  const chosen = picked ?? list[0]?.id ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <h2 className="text-[18px] font-bold tracking-tight">
          결선이 끝났어요. 다듬을 조합을 골라요
        </h2>
        <p className="mt-1 text-[12.5px] text-muted">
          작가 한 명씩 세기를 네 가지로 바꿔 보며 골라요 · 1위가 먼저 골라져 있어요
        </p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {list.map((c) => {
            const on = c.id === chosen
            return (
              <button
                key={c.id}
                onClick={() => setPicked(c.id)}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl border-2 bg-paper p-2.5 text-left transition-colors',
                  on ? 'border-accent' : 'border-transparent hover:border-line'
                )}
              >
                <Thumb path={thumbs.get(c.id)} className="aspect-square w-full rounded-xl" />
                <div className="flex items-center gap-2 px-0.5">
                  <b className="text-[15px]">{c.rank}위</b>
                  <TierChip tier={c.tier} />
                  <span className="text-[12px] text-muted">{winRateText(c.games, c.winRate)}</span>
                </div>
                {showTags && (
                  <p className="line-clamp-2 px-0.5 font-mono text-[10.5px] text-muted">{c.text}</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <span className="text-[12px] text-muted">작가마다 새 이미지 3장 · 확인용 12장</span>
        <Button
          variant="accent"
          size="lg"
          disabled={advancing || chosen == null}
          className="h-12 min-w-[220px] rounded-xl text-[15px]"
          onClick={() =>
            chosen != null &&
            gate(newRenders, model, (limit) => void advance({ tuneComboId: chosen, limit }))
          }
        >
          다듬기 시작 · 약 {newRenders.toLocaleString()}장
        </Button>
      </div>
      {dialog}
    </div>
  )
}
