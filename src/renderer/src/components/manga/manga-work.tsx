import {
  ArrowDownToLine,
  ArrowUpToLine,
  BookOpen,
  Brush,
  Loader2,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Scissors,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
  Wand2
} from 'lucide-react'
import { useMemo } from 'react'
import { autoLayout, type MangaPage, type MangaPanel, type MangaProject } from '@shared/manga'
import { cn } from '../../lib/utils'
import { askConfirm, askText } from '../../stores/dialog-store'
import { useMangaStore } from '../../stores/manga-store'
import { Switch } from '../ui/switch'
import { MangaPageView } from './manga-page'

const KIND: Record<string, string> = {
  story: '이야기 진행',
  action: '연결 동작',
  dialogue: '대화',
  emphasis: '강조'
}

/** 작업실: 왼쪽 진행·인물, 가운데 컷 흐름, 오른쪽 페이지 미리보기 */
export function MangaWork(): React.JSX.Element | null {
  const snap = useMangaStore((s) => s.snap)
  const pageId = useMangaStore((s) => s.pageId)
  if (!snap) return null
  const p = snap.project
  const page =
    p.pages.find((g) => g.id === pageId) ??
    p.pages.find((g) => g.state !== 'done' && !g.filePath) ??
    p.pages[p.pages.length - 1]
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <Side project={p} busy={snap.busy} error={snap.lastError} />
      <Flow project={p} busy={snap.busy} selected={page?.id ?? null} />
      {page && <Preview project={p} page={page} index={p.pages.indexOf(page)} />}
    </div>
  )
}

// ───────────────────────── 왼쪽 ─────────────────────────

function Side({
  project: p,
  busy,
  error
}: {
  project: MangaProject
  busy: string | null
  error: string | null
}): React.JSX.Element {
  const setAuto = useMangaStore((s) => s.setAuto)
  const expand = useMangaStore((s) => s.expand)
  const update = useMangaStore((s) => s.update)
  const drawn = p.pages.filter((g) => g.filePath).length
  const pct = Math.min(100, (p.pages.length / Math.max(1, p.brief.targetPages)) * 100)
  return (
    <aside className="flex w-[292px] shrink-0 flex-col gap-3 overflow-y-auto no-scrollbar">
      <div className="px-1 pt-1">
        <button
          className="group flex items-center gap-1.5 text-left text-[21px] font-extrabold tracking-tight text-ink"
          onClick={async () => {
            const t = await askText('작품 제목', p.title)
            if (t) void update({ title: t })
          }}
        >
          {p.title}
          <Pencil size={13} className="text-faint opacity-0 group-hover:opacity-100" />
        </button>
        <div className="mt-1 line-clamp-2 text-[12px] text-faint">
          {[p.brief.direction, p.brief.place || p.setting].filter(Boolean).join(' · ') ||
            p.brief.seed}
        </div>
      </div>

      <div className="rounded-2xl bg-paper p-3.5">
        <div className="flex items-center justify-between text-[13px] font-bold text-ink">
          자동으로 이어 쓰기
          <Switch
            checked={p.auto}
            onCheckedChange={(v) => void setAuto(v, p.autoRender)}
            disabled={p.ended}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
          다 찬 페이지는 바로 그리기
          <Switch checked={p.autoRender} onCheckedChange={(v) => void setAuto(p.auto, v)} />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
          <i
            className="block h-full rounded-full bg-accent transition-[width]"
            style={{ width: pct + '%' }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-faint">
          <span>
            <b className="text-ink">{p.pages.length}</b> / {p.brief.targetPages}쪽 · 컷{' '}
            {p.panels.length}개
          </span>
          <span>{p.ended ? '이야기 끝' : p.auto ? '진행 중' : '멈춤'}</span>
        </div>
        {busy && (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-[12px] font-semibold text-accent">
            <Loader2 size={13} className="animate-spin" /> {busy}
          </div>
        )}
        {error && !busy && (
          <div className="mt-2.5 rounded-lg bg-danger/10 px-2.5 py-2 text-[12px] leading-relaxed text-danger">
            {error}
          </div>
        )}
        <div className="mt-3 flex gap-1.5">
          <button
            disabled={!p.auto}
            onClick={() => void setAuto(false, p.autoRender)}
            className="h-8 flex-1 rounded-lg bg-surface text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            일시정지
          </button>
          <button
            disabled={!!busy || p.ended}
            onClick={() =>
              void expand({
                count: 1,
                intent: 'story',
                dialogue: p.brief.dialogue,
                finish: true,
                instruction: 'Conclude the story now with a satisfying visible outcome.'
              })
            }
            className="h-8 flex-1 rounded-lg bg-surface text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            마무리 컷
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-paper p-3.5">
        <div className="flex justify-between text-[13px] font-bold text-ink">
          인물 <span className="text-[12px] font-medium text-faint">{p.cast.length}명</span>
        </div>
        {p.cast.map((c) => {
          const last = [...p.panels].reverse().find((x) => x.states[c.id])?.states[c.id]
          return (
            <div key={c.id} className="mt-2.5 flex gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-[13px] font-extrabold text-accent">
                {c.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-ink">{c.name}</div>
                <div className="line-clamp-3 font-mono text-[11px] leading-relaxed text-faint">
                  {last?.appearance || c.appearance}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl bg-paper p-3.5">
        <div className="text-[13px] font-bold text-ink">그림체</div>
        <textarea
          defaultValue={p.style.prompt}
          key={'s' + p.id}
          onBlur={(e) =>
            e.target.value !== p.style.prompt &&
            void update({ style: { ...p.style, prompt: e.target.value } })
          }
          rows={4}
          className="mt-2 w-full resize-none rounded-lg bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted outline-none focus:ring-2 focus:ring-accent/30"
        />
        <div className="mt-2 flex justify-between text-[12px] text-faint">
          <span>
            그린 페이지 <b className="text-ink">{drawn}장</b>
          </span>
          <span>
            남은 예상 <b className="text-ink">약 {Math.max(0, p.brief.targetPages - drawn)}장</b>
          </span>
        </div>
      </div>
    </aside>
  )
}

// ───────────────────────── 가운데 ─────────────────────────

function Flow({
  project: p,
  busy,
  selected
}: {
  project: MangaProject
  busy: string | null
  selected: string | null
}): React.JSX.Element {
  const selectPage = useMangaStore((s) => s.selectPage)
  const openReader = useMangaStore((s) => s.openReader)
  const numberOf = useMemo(() => new Map(p.panels.map((x, i) => [x.id, i + 1])), [p.panels])
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl bg-paper/60">
      <div className="flex items-center gap-3 px-5 pb-2 pt-4">
        <h2 className="text-[20px] font-bold tracking-tight text-ink">컷 흐름</h2>
        <span className="text-[13px] text-faint">
          {p.pages.length}쪽 · {p.panels.length}컷
        </span>
        <div className="flex-1" />
        <button
          onClick={() => openReader(0)}
          disabled={!p.pages.some((g) => g.filePath)}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-white disabled:opacity-40 dark:text-paper"
        >
          <BookOpen size={15} /> 크게 보기
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 no-scrollbar">
        {p.pages.map((g, gi) => (
          <div key={g.id} className={cn('flex gap-4 py-4', gi > 0 && 'border-t border-line')}>
            <button onClick={() => selectPage(g.id)} className="w-[120px] shrink-0 text-left">
              <div className="mb-1.5 flex items-baseline justify-between text-[12px] font-bold text-ink">
                {gi + 1}쪽
                <PageBadge page={g} />
              </div>
              <MangaPageView
                project={p}
                page={g}
                className={cn(
                  'w-full',
                  selected === g.id && 'ring-2 ring-accent ring-offset-2 ring-offset-paper'
                )}
              />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {g.panelIds.map((id, i) => {
                const panel = p.panels.find((x) => x.id === id)
                if (!panel) return null
                return (
                  <Cut
                    key={id}
                    project={p}
                    panel={panel}
                    n={numberOf.get(id) ?? 0}
                    canUp={gi > 0 && i === 0}
                    canDown={!(gi === p.pages.length - 1 && i === 0)}
                    locked={g.state === 'queued'}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <Next project={p} busy={busy} />
      </div>
    </section>
  )
}

function PageBadge({ page }: { page: MangaPage }): React.JSX.Element {
  if (page.state === 'queued')
    return <span className="text-[11px] font-semibold text-accent">그리는 중</span>
  if (page.state === 'failed')
    return <span className="text-[11px] font-semibold text-danger">실패</span>
  if (page.filePath)
    return <span className="text-[11px] font-semibold text-emerald-500">그림 완료</span>
  return <span className="text-[11px] font-semibold text-faint">컷 모으는 중</span>
}

function Cut(props: {
  project: MangaProject
  panel: MangaPanel
  n: number
  canUp: boolean
  canDown: boolean
  locked: boolean
}): React.JSX.Element {
  const { project: p, panel } = props
  const updatePanel = useMangaStore((s) => s.updatePanel)
  const deletePanel = useMangaStore((s) => s.deletePanel)
  const movePanel = useMangaStore((s) => s.movePanel)
  const names = panel.subjects.map((id) => p.cast.find((c) => c.id === id)?.name ?? id).join(' · ')
  const editDialogue = async (): Promise<void> => {
    const t = await askText('대사 (비우면 대사 없음)', panel.dialogueKo)
    if (t !== null && t !== undefined) void updatePanel(panel.id, { dialogueKo: t })
  }
  const editText = async (): Promise<void> => {
    const t = await askText('그림에 쓰일 컷 설명 (영어)', panel.description)
    if (t) void updatePanel(panel.id, { description: t })
  }
  return (
    <div
      className={cn(
        'group relative flex gap-3 rounded-2xl bg-surface px-3.5 py-3',
        panel.importance === 'main' && 'ring-[1.5px] ring-accent'
      )}
    >
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-paper text-[11px] font-extrabold text-muted">
        {props.n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-snug text-ink" title={panel.description}>
          {panel.descriptionKo}
        </div>
        <button
          onClick={() => void editDialogue()}
          className={cn(
            'mt-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-lg px-2.5 py-0.5 text-[13px] font-semibold',
            panel.dialogueKo ? 'bg-paper text-ink' : 'bg-paper/60 font-medium text-faint'
          )}
        >
          <MessageSquareText size={12} className="shrink-0 opacity-60" />
          {panel.dialogueKo ? '"' + panel.dialogueKo + '"' : '대사 없음'}
          {panel.importance === 'main' && ' · 강조 컷'}
        </button>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Tag accent>{panel.framing}</Tag>
          {panel.angle && <Tag>{panel.angle}</Tag>}
          {names && <Tag>{names}</Tag>}
        </div>
      </div>
      {!props.locked && (
        <div className="absolute right-2 top-2 flex gap-0.5 rounded-lg bg-surface opacity-0 shadow-sm ring-1 ring-line transition group-hover:opacity-100">
          <IconBtn
            title={panel.importance === 'main' ? '강조 해제' : '강조 컷 (칸을 크게)'}
            onClick={() =>
              void updatePanel(panel.id, {
                importance: panel.importance === 'main' ? 'normal' : 'main'
              })
            }
          >
            <Star
              size={13}
              className={panel.importance === 'main' ? 'fill-accent text-accent' : ''}
            />
          </IconBtn>
          <IconBtn title="그림 설명 고치기" onClick={() => void editText()}>
            <Pencil size={13} />
          </IconBtn>
          {props.canUp && (
            <IconBtn title="앞 페이지로" onClick={() => void movePanel(panel.id, -1)}>
              <ArrowUpToLine size={13} />
            </IconBtn>
          )}
          {props.canDown && (
            <IconBtn title="여기서부터 다음 페이지로" onClick={() => void movePanel(panel.id, 1)}>
              <ArrowDownToLine size={13} />
            </IconBtn>
          )}
          <IconBtn
            title="컷 지우기"
            danger
            onClick={async () => {
              if (
                await askConfirm('컷 지우기', {
                  message: '이 컷을 지울까요?',
                  confirmLabel: '지우기',
                  danger: true
                })
              )
                void deletePanel(panel.id)
            }}
          >
            <Trash2 size={13} />
          </IconBtn>
        </div>
      )}
    </div>
  )
}

function Tag({
  children,
  accent
}: {
  children: React.ReactNode
  accent?: boolean
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 text-[11px] font-semibold',
        accent ? 'bg-accent-soft text-accent' : 'bg-paper text-muted'
      )}
    >
      {children}
    </span>
  )
}

function IconBtn(props: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md text-muted hover:bg-paper',
        props.danger ? 'hover:text-danger' : 'hover:text-ink'
      )}
    >
      {props.children}
    </button>
  )
}

/** 흐름 맨 아래: 편집자 제안 또는 다음 컷 요청 */
function Next({
  project: p,
  busy
}: {
  project: MangaProject
  busy: string | null
}): React.JSX.Element {
  const propose = useMangaStore((s) => s.propose)
  const accept = useMangaStore((s) => s.accept)
  const expand = useMangaStore((s) => s.expand)
  const update = useMangaStore((s) => s.update)
  const direct = async (): Promise<void> => {
    const t = await askText('다음 컷에서 보여 줄 것 (한국어로 써도 돼요)', '')
    if (t) void expand({ count: 1, intent: 'story', dialogue: p.brief.dialogue, instruction: t })
  }
  if (busy) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-2xl bg-surface px-4 py-4 text-[13px] font-semibold text-accent">
        <Loader2 size={15} className="animate-spin" /> {busy}
      </div>
    )
  }
  if (p.ended) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5">
        <span className="text-[13px] font-semibold text-ink">이야기가 끝났어요.</span>
        <button
          onClick={() => void update({ ended: false })}
          className="ml-auto h-8 rounded-lg bg-paper px-3 text-[12.5px] font-semibold text-muted hover:text-ink"
        >
          이어서 더 쓰기
        </button>
      </div>
    )
  }
  const pr = p.proposal
  if (pr) {
    return (
      <div className="mt-2 rounded-2xl bg-surface px-4 py-3.5 ring-[1.5px] ring-accent shadow-[0_6px_20px_rgba(91,91,214,0.12)]">
        <div className="flex items-center gap-2 text-[13px] font-bold text-accent">
          <Wand2 size={14} /> 편집자 제안
          <span className="ml-auto flex gap-1">
            <span className="rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-semibold text-white dark:text-paper">
              {pr.action === 'stop'
                ? '여기서 끝'
                : pr.action === 'finish'
                  ? '마무리'
                  : KIND[pr.intent]}
            </span>
            {pr.action !== 'stop' && (
              <span className="rounded-md bg-paper px-2 py-0.5 text-[11.5px] font-semibold text-muted">
                컷 {pr.count}개 · 대사{' '}
                {pr.dialogue === 'none' ? '없음' : pr.dialogue === 'with' ? '있음' : '알아서'}
              </span>
            )}
          </span>
        </div>
        <p className="mt-2 text-[14.5px] font-semibold leading-relaxed text-ink">
          {pr.reasonKo || pr.instruction}
        </p>
        {pr.instruction && pr.reasonKo && (
          <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-faint">
            {pr.instruction}
          </p>
        )}
        <div className="mt-3 flex gap-1.5">
          <button
            onClick={() => void accept()}
            className="h-9 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white dark:text-paper"
          >
            {pr.action === 'stop' ? '여기서 끝내기' : '이대로 쓰기'}
          </button>
          <button
            onClick={() => void propose()}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-paper px-3.5 text-[13px] font-semibold text-muted hover:text-ink"
          >
            <RefreshCw size={13} /> 다른 제안
          </button>
          <button
            onClick={() => void direct()}
            className="h-9 rounded-xl bg-paper px-3.5 text-[13px] font-semibold text-muted hover:text-ink"
          >
            직접 지시
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2 rounded-2xl bg-surface p-3">
      <button
        onClick={() => void propose()}
        className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white dark:text-paper"
      >
        <Sparkles size={15} /> 편집자에게 다음 컷 묻기
      </button>
      <button
        onClick={() => void expand({ count: 2, intent: 'story', dialogue: p.brief.dialogue })}
        className="h-10 rounded-xl bg-paper px-4 text-[13px] font-semibold text-muted hover:text-ink"
      >
        바로 두 컷 더
      </button>
      <button
        onClick={() => void direct()}
        className="h-10 rounded-xl bg-paper px-4 text-[13px] font-semibold text-muted hover:text-ink"
      >
        직접 지시
      </button>
    </div>
  )
}

// ───────────────────────── 오른쪽 ─────────────────────────

function Preview({
  project: p,
  page,
  index
}: {
  project: MangaProject
  page: MangaPage
  index: number
}): React.JSX.Element {
  const render = useMangaStore((s) => s.render)
  const reseed = useMangaStore((s) => s.reseed)
  const setLayout = useMangaStore((s) => s.setLayout)
  const setView = useMangaStore((s) => s.setView)
  const selectPage = useMangaStore((s) => s.selectPage)
  const openReader = useMangaStore((s) => s.openReader)
  const n = page.panelIds.length
  const queued = page.state === 'queued'
  const shuffle = (): void => {
    const emphasis = page.panelIds.findIndex(
      (id) => p.panels.find((x) => x.id === id)?.importance === 'main'
    )
    void setLayout(
      page.id,
      autoLayout(n, {
        seed: Math.floor(Math.random() * 1e9),
        emphasis: emphasis >= 0 ? emphasis : undefined
      })
    )
  }
  return (
    <aside className="flex w-[330px] shrink-0 flex-col rounded-2xl bg-paper/60 p-4">
      <div className="flex items-baseline justify-between">
        <b className="text-[16px] text-ink">
          {index + 1}쪽 {page.filePath ? '완성' : '미리보기'}
        </b>
        <span className="text-[12px] text-faint">832 × 1216 · 컷 {n}개</span>
      </div>
      <button
        className="mx-auto mt-3 block w-[240px]"
        onClick={() =>
          page.filePath ? openReader(p.pages.filter((g) => g.filePath).indexOf(page)) : undefined
        }
      >
        <MangaPageView project={p} page={page} detail className="w-full" />
      </button>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <button
          disabled={queued}
          onClick={shuffle}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-surface text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-40"
        >
          <Shuffle size={14} /> 배치 바꾸기
        </button>
        <button
          disabled={queued}
          onClick={() => {
            selectPage(page.id)
            setView('editor')
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-surface text-[12.5px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          <Scissors size={14} /> 칸 직접 나누기
        </button>
      </div>
      <div className="mt-auto pt-4">
        <button
          disabled={queued || n === 0}
          onClick={async () => {
            if (page.filePath) await reseed(page.id)
            void render(page.id)
          }}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-bold text-white transition hover:opacity-90 disabled:opacity-50 dark:text-paper"
        >
          {queued ? <Loader2 size={16} className="animate-spin" /> : <Brush size={16} />}
          {queued ? '그리는 중' : page.filePath ? '이 페이지 다시 그리기' : '이 페이지 그리기'}
          <span className="text-[12px] font-medium opacity-85">V5 1장</span>
        </button>
        <div className="mt-2 text-center text-[11.5px] text-faint">
          {page.filePath
            ? '다시 그리면 새 시드로 그려요 · 칸 모양은 그대로'
            : '컷이 더 들어오면 칸 배치가 다시 계산돼요'}
        </div>
      </div>
    </aside>
  )
}
