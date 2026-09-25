import { ArrowRightLeft, ImageDown, Plus, Search, Trash2, X } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import type { ArenaArtist, ArenaArtistParseItem, ArenaArtistStat } from '@shared/arena'
import { droppedImagePaths, hasImageDrop } from '../../lib/image-drag'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { toast } from '../../stores/toast-store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Input, Textarea } from '../ui/input'
import { Card } from './arena-common'
import { Seg } from './arena-confirm'

type List = 'liked' | 'avoided'

const POSITION: Record<string, string> = {
  front: '앞에 둘 때 좋아요',
  back: '뒤에 둘 때 좋아요',
  any: '순서 상관없어요'
}

function effectText(e: number | null | undefined): string {
  if (e == null) return '아직 몰라요'
  const n = Math.round(e)
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + '%p'
}

export function ArenaArtists(): React.JSX.Element {
  const artists = useArenaStore((s) => s.artists)
  const stats = useArenaStore((s) => s.snapshot?.artistStats)
  const move = useArenaStore((s) => s.artistsMove)
  const remove = useArenaStore((s) => s.artistsRemove)
  const update = useArenaStore((s) => s.artistsUpdate)
  const [list, setList] = useState<List>('liked')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const statMap = useMemo(() => new Map((stats ?? []).map((s) => [s.tag, s])), [stats])
  const counts = useMemo(
    () => ({
      liked: artists.filter((a) => a.list === 'liked').length,
      avoided: artists.filter((a) => a.list === 'avoided').length
    }),
    [artists]
  )
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return artists
      .filter((a) => a.list === list && (!q || a.tag.includes(q)))
      .sort((a, b) => {
        const ea = statMap.get(a.tag)?.effect
        const eb = statMap.get(b.tag)?.effect
        if (ea == null && eb == null) return a.tag.localeCompare(b.tag)
        if (ea == null) return 1
        if (eb == null) return -1
        return eb - ea
      })
  }, [artists, list, query, statMap])
  const suggest = useMemo(
    () =>
      artists
        .filter((a) => a.list === 'liked')
        .map((a) => ({ a, s: statMap.get(a.tag) }))
        .filter((x) => x.s?.effect != null && x.s.effect <= -8)
        .sort((x, y) => (x.s?.effect ?? 0) - (y.s?.effect ?? 0)),
    [artists, statMap]
  )

  const sel = [...selected].filter((t) => rows.some((r) => r.tag === t))
  const toggle = (tag: string): void => {
    const next = new Set(selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    setSelected(next)
  }
  const other: List = list === 'liked' ? 'avoided' : 'liked'
  const otherName = other === 'liked' ? '좋아하는' : '피하고 싶은'

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-3">
          <Seg
            value={list}
            options={[
              ['liked', '좋아하는 작가 ' + counts.liked],
              ['avoided', '피하고 싶은 작가 ' + counts.avoided]
            ]}
            onChange={(v) => {
              setList(v as List)
              setSelected(new Set())
            }}
          />
          <div className="relative w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="작가 이름 검색"
              className="h-9 rounded-xl border-transparent bg-paper pl-8"
            />
          </div>
          <Button className="h-9 rounded-xl" onClick={() => setAdding(true)}>
            <Plus size={14} />
            작가 추가
          </Button>
          <div className="flex-1" />
          {sel.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[12.5px] font-semibold">{sel.length}명 골랐어요</span>
              <Button
                size="sm"
                onClick={() => void move(sel, other).then(() => setSelected(new Set()))}
              >
                <ArrowRightLeft size={13} />
                {otherName} 목록으로
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={() => void remove(sel).then(() => setSelected(new Set()))}
              >
                <Trash2 size={13} />
                지우기
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setSelected(new Set())}
              >
                <X size={14} />
              </Button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[20px] bg-paper px-2 pb-2">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-paper px-2 py-2.5 text-[11.5px] text-faint">
            <span className="w-4" />
            <span className="min-w-0 flex-1">작가</span>
            <span className="w-[76px]">고정 가중치</span>
            <span className="w-[110px]">있으면 이길 확률</span>
            <span className="w-[92px]">선호 가중치</span>
            <span className="w-[112px]">순서</span>
            <span className="w-[64px]" />
          </div>
          {rows.map((a) => (
            <ArtistRow
              key={a.tag}
              artist={a}
              stat={statMap.get(a.tag)}
              checked={selected.has(a.tag)}
              otherName={otherName}
              onToggle={toggle}
              onMove={(tag) => void move([tag], other)}
              onRemove={(tag) => void remove([tag])}
              onWeight={(tag, w) => void update(tag, { fixedWeight: w })}
            />
          ))}
          {rows.length === 0 && (
            <p className="py-16 text-center text-[13px] text-faint">
              {query ? '찾는 작가가 없어요' : '아직 작가가 없어요. ‘작가 추가’로 넣어 봐요'}
            </p>
          )}
        </div>
        <p className="shrink-0 text-[11.5px] text-faint">
          효과와 선호 가중치는 지금 세션의 대결로 추정해요 · 판이 쌓일수록 정확해져요
        </p>
      </div>

      <Card className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto p-5">
        <div>
          <h3 className="text-[15px] font-bold">네거티브 후보 추천</h3>
          <p className="mt-0.5 text-[12px] text-muted">좋아하는 작가 중 자주 진 작가예요</p>
        </div>
        {suggest.length === 0 ? (
          <p className="py-6 text-[12.5px] text-faint">
            지금은 옮길 작가가 없어요. 판이 쌓이면 알려 드려요
          </p>
        ) : (
          <div className="flex flex-col">
            {suggest.map(({ a, s }) => (
              <div
                key={a.tag}
                className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <b className="truncate text-[13px]">{a.tag}</b>
                    <span className="text-[12px] font-semibold text-danger">
                      {effectText(s?.effect)}
                    </span>
                  </div>
                  <span className="text-[11.5px] text-muted">
                    자주 진 작가예요 · {s?.appearances ?? 0}개 조합에 나왔어요
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {suggest.length > 0 && (
          <Button
            variant="accent"
            size="lg"
            className="h-12 rounded-xl text-[14px]"
            onClick={() =>
              void move(
                suggest.map((x) => x.a.tag),
                'avoided'
              )
            }
          >
            {suggest.length}명 피하고 싶은 목록으로 옮기기
          </Button>
        )}
      </Card>
      <AddArtistsDialog open={adding} onOpenChange={setAdding} defaultList={list} />
    </div>
  )
}

const ArtistRow = memo(function ArtistRow({
  artist,
  stat,
  checked,
  otherName,
  onToggle,
  onMove,
  onRemove,
  onWeight
}: {
  artist: ArenaArtist
  stat: ArenaArtistStat | undefined
  checked: boolean
  otherName: string
  onToggle: (tag: string) => void
  onMove: (tag: string) => void
  onRemove: (tag: string) => void
  onWeight: (tag: string, w: number | null) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const effect = stat?.effect ?? null
  const bar = effect == null ? 0 : Math.min(50, (Math.abs(effect) / 20) * 50)
  const commit = (): void => {
    setEditing(false)
    const t = draft.trim()
    if (!t) return onWeight(artist.tag, null)
    const n = Number(t)
    if (!Number.isFinite(n) || n <= 0) return toast('가중치는 0보다 큰 숫자로 적어 주세요', 'error')
    onWeight(artist.tag, Math.round(n * 10) / 10)
  }
  return (
    <div className="group flex items-center gap-3 border-b border-line px-2 py-2 text-[13px] last:border-b-0 [contain-intrinsic-size:auto_44px] [content-visibility:auto]">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(artist.tag)}
        className="size-4 accent-[var(--color-accent)]"
      />
      <span className="min-w-0 flex-1 truncate font-medium">{artist.tag}</span>
      <span className="w-[76px]">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder="없음"
            className="h-7 w-[64px] px-2"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(artist.fixedWeight != null ? artist.fixedWeight.toFixed(1) : '')
              setEditing(true)
            }}
            className={cn(
              'h-7 rounded-md px-2 tabular-nums hover:bg-surface-2',
              artist.fixedWeight != null ? 'font-semibold text-accent' : 'text-faint'
            )}
            title="눌러서 고정 가중치 바꾸기 · 비우면 고정 안 해요"
          >
            {artist.fixedWeight != null ? artist.fixedWeight.toFixed(1) : '없음'}
          </button>
        )}
      </span>
      <span className="flex w-[110px] items-center gap-2">
        <span
          className={cn(
            'w-[46px] shrink-0 tabular-nums',
            effect == null
              ? 'text-[12px] text-faint'
              : effect < 0
                ? 'font-semibold text-danger'
                : 'font-semibold'
          )}
        >
          {effectText(effect)}
        </span>
        {effect != null && (
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className={cn(
                'absolute top-0 h-full rounded-full',
                effect < 0 ? 'bg-danger' : 'bg-accent'
              )}
              style={
                effect < 0 ? { right: '50%', width: bar + '%' } : { left: '50%', width: bar + '%' }
              }
            />
          </span>
        )}
      </span>
      <span
        className={cn(
          'w-[92px] tabular-nums',
          stat?.preferredWeight ? '' : 'text-[12px] text-faint'
        )}
      >
        {stat?.preferredWeight
          ? stat.preferredWeight.low.toFixed(1) + ' – ' + stat.preferredWeight.high.toFixed(1)
          : '아직 몰라요'}
      </span>
      <span
        className={cn('w-[112px] text-[12px]', stat?.positionHint ? 'text-muted' : 'text-faint')}
      >
        {stat?.positionHint ? POSITION[stat.positionHint] : '아직 몰라요'}
      </span>
      <span className="flex w-[64px] justify-end gap-0.5">
        <button
          title={otherName + ' 목록으로 옮기기'}
          onClick={() => onMove(artist.tag)}
          className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-ink"
        >
          <ArrowRightLeft size={14} />
        </button>
        <button
          title="지우기"
          onClick={() => onRemove(artist.tag)}
          className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
})

// ───────────────────────── 작가 추가 ─────────────────────────

function AddArtistsDialog({
  open,
  onOpenChange,
  defaultList
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultList: List
}): React.JSX.Element {
  const add = useArenaStore((s) => s.artistsAdd)
  const [text, setText] = useState('')
  const [list, setList] = useState<List>(defaultList)
  const [items, setItems] = useState<ArenaArtistParseItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(() => {
      if (!text.trim()) {
        setItems([])
        return
      }
      void window.nais
        .invoke('arena:artistsParse', { text })
        .then(({ items: parsed }) => alive && setItems(parsed))
        .catch(() => alive && setItems([]))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [text, open])

  const fresh = items.filter((i) => i.status === 'new')

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const paths = droppedImagePaths(e)
    const fallback = e.dataTransfer.getData('nais/file-path')
    if (fallback && !paths.includes(fallback)) paths.push(fallback)
    for (const filePath of paths) {
      try {
        const { text: prompt } = await window.nais.invoke('arena:promptFromImage', { filePath })
        if (prompt.trim()) setText((t) => (t.trim() ? t.replace(/\s+$/, '') + '\n' : '') + prompt)
        else toast('이미지에서 프롬프트를 찾지 못했어요', 'info')
      } catch {
        toast('이미지를 읽지 못했어요', 'error')
      }
    }
  }

  const submit = async (): Promise<void> => {
    if (fresh.length === 0) return
    setBusy(true)
    const added = await add(
      fresh.map((i) => i.name),
      list
    )
    setBusy(false)
    if (added > 0) {
      toast(added + '명을 추가했어요', 'success')
      setText('')
      setItems([])
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setList(defaultList)
        onOpenChange(o)
      }}
    >
      <DialogContent
        className={cn('max-w-[560px] p-6', dragOver && 'border-accent')}
        onDragOver={(e) => {
          if (!hasImageDrop(e) && !e.dataTransfer.types.includes('nais/file-path')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <DialogTitle className="text-[17px] font-bold">작가 추가</DialogTitle>
        <DialogDescription className="mt-1 text-[13px]">
          작가 태그만 골라 담아요 · 라이브러리 이미지를 끌어다 놓으면 그 프롬프트를 읽어요
        </DialogDescription>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="프롬프트를 통째로 붙여 넣어도 돼요"
          className="mt-4 rounded-xl bg-paper text-[12.5px]"
        />
        <div className="mt-3 max-h-[180px] min-h-[64px] overflow-y-auto rounded-xl bg-paper p-3">
          {items.length === 0 ? (
            <p className="flex items-center gap-2 text-[12.5px] text-faint">
              <ImageDown size={14} />
              붙여 넣은 글에서 찾은 작가가 여기에 보여요
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {items.map((i) => (
                <span
                  key={i.name}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px]',
                    i.status === 'new' && 'bg-surface font-medium text-ink',
                    i.status === 'exists' && 'border border-line text-muted',
                    i.status === 'notArtist' && 'border border-dashed border-line text-faint'
                  )}
                >
                  <span className={i.status === 'notArtist' ? 'line-through' : undefined}>
                    {i.name}
                  </span>
                  {i.status === 'exists' && <span className="text-[11px]">이미 있어요</span>}
                  {i.status === 'notArtist' && <span className="text-[11px]">일반 태그</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[12.5px] text-muted">넣을 곳</span>
          <Seg
            value={list}
            options={[
              ['liked', '좋아하는 작가'],
              ['avoided', '피하고 싶은 작가']
            ]}
            onChange={(v) => setList(v as List)}
          />
          <div className="flex-1" />
          <Button
            variant="accent"
            size="lg"
            disabled={busy || fresh.length === 0}
            className="h-11 min-w-[120px] rounded-xl"
            onClick={() => void submit()}
          >
            {fresh.length}명 추가
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
