import { Copy, Download, LogIn, SlidersHorizontal, Sparkles, Star } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { comboString, type ArenaComboView } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { Card, TagsToggle, Thumb, TierChip } from './arena-common'
import {
  comboThumbs,
  consistencyLabel,
  copyText,
  sendComboToMain,
  sendNegativeToMain,
  useLimitGate,
  winRateText
} from './arena-utils'
import { Seg } from './arena-confirm'

function tagsOf(c: ArenaComboView): string {
  return c.text || comboString(c.pairs)
}

export function ArenaRanking(): React.JSX.Element {
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const sessionName = useArenaStore((s) => s.snapshot?.session.name ?? '')
  const showTags = useArenaStore((s) => s.showTags)
  const favorite = useArenaStore((s) => s.favorite)
  const setView = useArenaStore((s) => s.setView)
  const negative = useArenaStore((s) => s.snapshot?.session.target === 'negative')
  const [sort, setSort] = useState<'score' | 'fav'>('score')
  const [selId, setSelId] = useState<number | null>(null)

  const { ranked, list, thumbs } = useMemo(() => {
    const r = (combos ?? [])
      .filter((c) => !c.hidden && c.rank != null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    return {
      ranked: r,
      list: sort === 'fav' ? r.filter((c) => c.favorite) : r,
      thumbs: comboThumbs(renders ?? [])
    }
  }, [combos, renders, sort])

  if (!combos) {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <div>
          <b className="text-[15px]">세션을 고르면 순위가 보여요</b>
          <div className="mt-3">
            <Button className="rounded-xl" onClick={() => setView('sessions')}>
              지난 세션 보기
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const sel = list.find((c) => c.id === selId) ?? list[0] ?? null
  const favCount = ranked.filter((c) => c.favorite).length

  const exportTxt = (): void => {
    const text = list.map(tagsOf).join('\n') + '\n'
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = (sessionName || '그림체') + ' 태그 목록.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-3">
          <Seg
            value={sort}
            options={[
              ['score', '점수 순'],
              ['fav', '즐겨찾기 ' + favCount]
            ]}
            onChange={(v) => setSort(v as 'score' | 'fav')}
          />
          <div className="flex-1" />
          <TagsToggle />
          <Button className="rounded-xl" disabled={list.length === 0} onClick={exportTxt}>
            <Download size={14} />
            태그 목록 내보내기 (.txt)
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[20px] bg-paper p-1.5">
          {list.map((c) => (
            <RankRow
              key={c.id}
              combo={c}
              thumb={thumbs.get(c.id) ?? null}
              selected={sel?.id === c.id}
              showTags={showTags}
              negative={negative}
              onSelect={setSelId}
              onFavorite={favorite}
            />
          ))}
          {list.length === 0 && (
            <p className="py-16 text-center text-[13px] text-faint">
              {sort === 'fav'
                ? '즐겨찾기한 조합이 없어요'
                : '아직 순위가 없어요. 대결을 조금 해 봐요'}
            </p>
          )}
        </div>
      </div>
      {sel && (
        <Detail
          combo={sel}
          total={ranked.length}
          thumb={thumbs.get(sel.id) ?? null}
          negative={negative}
        />
      )}
    </div>
  )
}

const RankRow = memo(function RankRow({
  combo,
  thumb,
  selected,
  showTags,
  negative,
  onSelect,
  onFavorite
}: {
  combo: ArenaComboView
  thumb: string | null
  selected: boolean
  showTags: boolean
  negative: boolean
  onSelect: (id: number) => void
  onFavorite: (id: number, fav: boolean) => Promise<void>
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(combo.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(combo.id)}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors [contain-intrinsic-size:auto_60px] [content-visibility:auto]',
        selected ? 'bg-accent-soft' : 'hover:bg-surface/70',
        !combo.certain && 'outline-dashed outline-1 -outline-offset-1 outline-line'
      )}
      title={combo.certain ? undefined : '판이 적어서 순위가 바뀔 수 있어요'}
    >
      <Thumb path={thumb} className="size-11 rounded-lg" />
      <b className="w-12 shrink-0 text-[15px] tabular-nums">{combo.rank}위</b>
      {!negative && <TierChip tier={combo.tier} />}
      <span className="w-[120px] shrink-0 text-[12.5px] text-muted">
        {winRateText(combo.games, combo.winRate)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
        {showTags ? tagsOf(combo) : ''}
      </span>
      <button
        title={combo.favorite ? '즐겨찾기 빼기' : '즐겨찾기'}
        onClick={(e) => {
          e.stopPropagation()
          void onFavorite(combo.id, !combo.favorite)
        }}
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg hover:bg-surface-2',
          combo.favorite ? 'text-amber-500' : 'text-faint hover:text-ink'
        )}
      >
        <Star size={15} fill={combo.favorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
})

function Detail({
  combo,
  total,
  thumb,
  negative
}: {
  combo: ArenaComboView
  total: number
  thumb: string | null
  negative: boolean
}): React.JSX.Element {
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const stage = useArenaStore((s) => s.snapshot?.session.stage)
  const finalIds = useArenaStore((s) => s.snapshot?.session.state.finalIds)
  const model = useArenaStore((s) => s.snapshot?.session.config.params.model ?? '')
  const newRenders = useArenaStore((s) => s.snapshot?.progress.next?.newRenders ?? 0)
  const favorite = useArenaStore((s) => s.favorite)
  const advance = useArenaStore((s) => s.advance)
  const advancing = useArenaStore((s) => s.advancing)
  const setView = useArenaStore((s) => s.setView)
  const sessionName = useArenaStore((s) => s.snapshot?.session.name ?? '')
  const setRefineSeed = useArenaStore((s) => s.setRefineSeed)
  const setNegativeSeed = useArenaStore((s) => s.setNegativeSeed)
  const { gate, dialog } = useLimitGate()
  const shots = useMemo(
    () =>
      (renders ?? [])
        .filter((r) => r.comboId === combo.id && r.state === 'done' && r.filePath)
        .sort((a, b) => a.slot - b.slot),
    [renders, combo.id]
  )
  const tags = tagsOf(combo)
  const canTune =
    (stage === 'final' || stage === 'tune') &&
    (finalIds ? finalIds.includes(combo.id) : combo.stageReached === 'final')

  return (
    <Card className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex gap-4">
        <Thumb path={thumb} className="aspect-[3/4] w-[128px] rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {!negative && <TierChip tier={combo.tier} />}
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] font-semibold text-muted">
              {consistencyLabel(combo.consistency)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[14px] font-semibold text-muted">{total}개 중</span>
            <b className="text-[28px] font-bold tracking-tight">{combo.rank}위</b>
          </div>
          <span className="text-[12.5px] text-muted">
            {winRateText(combo.games, combo.winRate)}
          </span>
        </div>
      </div>

      {shots.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-muted">장면별</div>
          <div className="grid grid-cols-4 gap-1.5">
            {shots.map((r) => (
              <Thumb key={r.id} path={r.filePath} className="aspect-square w-full">
                <span className="absolute bottom-1 left-1 rounded bg-surface/95 px-1 text-[10px] font-semibold">
                  {r.slot + 1}
                </span>
              </Thumb>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
          <span className="font-semibold">작가 · 순서대로</span>
          <span>가중치</span>
        </div>
        {combo.pairs.map((p, i) => (
          <div
            key={p.tag + i}
            className="flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0"
          >
            <span className="w-4 text-[11.5px] font-semibold text-faint">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{p.tag}</span>
            <b className="tabular-nums text-accent">{p.weight.toFixed(1)}</b>
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <div className="grid grid-cols-3 gap-2">
        <Button
          className="h-10 rounded-xl"
          onClick={() => (negative ? sendNegativeToMain(tags) : sendComboToMain(tags))}
        >
          <LogIn size={14} />
          {negative ? '메인 네거티브에 넣기' : '메인에서 쓰기'}
        </Button>
        <Button className="h-10 rounded-xl" onClick={() => void copyText(tags)}>
          <Copy size={14} />
          태그 복사
        </Button>
        <Button
          className="h-10 rounded-xl"
          onClick={() => void favorite(combo.id, !combo.favorite)}
        >
          <Star
            size={14}
            fill={combo.favorite ? 'currentColor' : 'none'}
            className={combo.favorite ? 'text-amber-500' : ''}
          />
          즐겨찾기
        </Button>
      </div>
      {!negative && (
        <Button
          className="h-10 rounded-xl"
          onClick={() => {
            setNegativeSeed(null)
            setRefineSeed({ pairs: combo.pairs, label: sessionName + ' ' + combo.rank + '위' })
            setView('start')
          }}
        >
          <Sparkles size={14} />이 조합 미세 조정 · 순서·가중치 조금씩
        </Button>
      )}
      {canTune && (
        <Button
          variant="accent"
          size="lg"
          disabled={advancing}
          className="h-12 rounded-xl text-[15px]"
          onClick={() =>
            gate(
              newRenders,
              model,
              (limit) =>
                void advance({ tuneComboId: combo.id, limit }).then(
                  (ok) => ok && setView('session')
                )
            )
          }
        >
          <SlidersHorizontal size={15} />이 조합 다듬기
        </Button>
      )}
      {dialog}
    </Card>
  )
}
