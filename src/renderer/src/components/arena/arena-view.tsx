import { BarChart3, Clock, FileText, Plus, Swords, Users } from 'lucide-react'
import { useEffect } from 'react'
import { sceneCountOf, slotLayout, type ArenaDuel } from '@shared/arena'
import { cn } from '../../lib/utils'
import { bindArenaEvents, useArenaStore, type ArenaViewMode } from '../../stores/arena-store'
import { useLayoutStore } from '../../stores/layout-store'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select'
import { ArenaArtists } from './arena-artists'
import { NegChip, ProgressBar, StageStepper, TagsToggle } from './arena-common'
import { QuadDuel, WaitView } from './arena-duel'
import { loadArtistNames, useArenaKeys, useLimitGate } from './arena-utils'
import { ArenaConfirm } from './arena-confirm'
import { FinalDuel } from './arena-final'
import { NegDone, NegDuel } from './arena-neg'
import { ArenaRanking } from './arena-ranking'
import { ArenaSessions } from './arena-sessions'
import { StageEnd } from './arena-stage'
import { ArenaStart } from './arena-start'
import { OrderDuel, TuneDuel } from './arena-tune'

/** 그림체 탭. 한 번 마운트된 뒤 다른 탭에서는 display:none으로 숨는다 */
export function ArenaView(): React.JSX.Element {
  const visible = useLayoutStore((s) => (s.centerMode as string) === 'arena')
  const started = useArenaStore((s) => s.started)
  const view = useArenaStore((s) => s.view)

  useEffect(() => bindArenaEvents(), [])
  useEffect(() => {
    if (visible) {
      useArenaStore.getState().start()
      // "artist:" 없이 쓴 작가 태그를 알아보기 위한 이름 목록 (한 번만)
      void loadArtistNames()
    }
  }, [visible])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-surface">
      <Header />
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
        {!started ? null : view === 'start' ? (
          <ArenaStart />
        ) : view === 'sessions' ? (
          <ArenaSessions />
        ) : view === 'rank' ? (
          <ArenaRanking />
        ) : view === 'artists' ? (
          <ArenaArtists />
        ) : (
          <ArenaSession />
        )}
      </div>
      <UndoBar />
    </div>
  )
}

// ───────────────────────── 머리줄 ─────────────────────────

function Header(): React.JSX.Element {
  const view = useArenaStore((s) => s.view)
  const currentId = useArenaStore((s) => s.currentSessionId)
  const setView = useArenaStore((s) => s.setView)
  const tab: 'session' | 'rank' | 'artists' =
    view === 'rank' ? 'rank' : view === 'artists' ? 'artists' : 'session'
  const go = (t: typeof tab): void => {
    if (t === 'session') setView(currentId == null ? 'start' : 'session')
    else setView(t)
  }
  const tabs: { key: typeof tab; label: string; icon: React.JSX.Element }[] = [
    { key: 'session', label: '세션', icon: <Swords size={15} /> },
    { key: 'rank', label: '순위', icon: <BarChart3 size={15} /> },
    { key: 'artists', label: '작가', icon: <Users size={15} /> }
  ]
  return (
    <div className="drag flex h-16 shrink-0 items-center gap-3 px-5">
      <span className="text-[22px] font-bold tracking-tight">그림체 월드컵</span>
      <SessionSelect />
      <div className="no-drag flex items-center gap-0.5 rounded-xl bg-paper p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors',
              tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
            )}
          >
            <span className={tab === t.key ? 'text-accent' : ''}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <HeaderRight view={view} />
    </div>
  )
}

function SessionSelect(): React.JSX.Element {
  const sessions = useArenaStore((s) => s.sessions)
  const currentId = useArenaStore((s) => s.currentSessionId)
  const view = useArenaStore((s) => s.view)
  const snapName = useArenaStore((s) => s.snapshot?.session.name)
  const snapTarget = useArenaStore((s) => s.snapshot?.session.target)
  const openSession = useArenaStore((s) => s.openSession)
  const newSession = useArenaStore((s) => s.newSession)
  const isNew = view === 'start' || currentId == null
  const current = sessions.find((s) => s.id === currentId)
  const name = current?.name ?? snapName ?? '세션'
  const negative = (current?.target ?? snapTarget) === 'negative'
  return (
    <Select
      value={isNew ? 'new' : String(currentId)}
      onValueChange={(v) => (v === 'new' ? newSession() : void openSession(Number(v)))}
      onOpenChange={(open) => open && void useArenaStore.getState().loadSessions()}
    >
      <SelectTrigger className="no-drag h-9 w-[240px] shrink-0 rounded-xl border-transparent bg-paper px-3">
        <span className="flex min-w-0 items-center gap-2">
          {isNew ? (
            <Plus size={14} className="shrink-0 text-muted" />
          ) : (
            <FileText size={14} className="shrink-0 text-muted" />
          )}
          <span className="truncate font-medium">{isNew ? '새 세션' : name}</span>
          {!isNew && negative && <NegChip />}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-[360px]">
        <SelectItem value="new">새 세션</SelectItem>
        {sessions.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            {s.name}
            {s.target === 'negative' ? ' · 네거티브' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function HeaderRight({ view }: { view: ArenaViewMode }): React.JSX.Element {
  const queued = useArenaStore((s) => s.snapshot?.progress.renders.queued ?? 0)
  const setView = useArenaStore((s) => s.setView)
  const cancel = useArenaStore((s) => s.cancel)
  if (queued > 0) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="no-drag flex h-9 items-center gap-2 rounded-xl bg-accent-soft px-3.5 text-[13px] font-semibold text-accent">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            생성 중 {queued.toLocaleString()}장
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[240px] p-3">
          <p className="text-[12.5px] text-muted">이 세션 이미지를 뒤에서 만들고 있어요</p>
          <div className="mt-3 flex flex-col gap-1.5">
            <Button onClick={() => setView('sessions')}>
              <Clock size={14} />
              지난 세션 보기
            </Button>
            <Button variant="ghost" onClick={() => void cancel()}>
              이 세션 생성 멈추기
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    )
  }
  return (
    <Button
      variant={view === 'sessions' ? 'default' : 'ghost'}
      className={cn('no-drag h-9 rounded-xl', view !== 'sessions' && 'bg-paper')}
      onClick={() => setView('sessions')}
    >
      <Clock size={14} />
      지난 세션
    </Button>
  )
}

function UndoBar(): React.JSX.Element | null {
  const bar = useArenaStore((s) => s.undoBar)
  const clear = useArenaStore((s) => s.clearUndo)
  if (!bar) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pl-4 pr-2 text-[13px] shadow-xl">
        <span>{bar.message}</span>
        <Button
          size="sm"
          variant="ghost"
          className="font-semibold text-accent hover:text-accent"
          onClick={() => {
            clear()
            void bar.run()
          }}
        >
          되돌리기
        </Button>
      </div>
    </div>
  )
}

// ───────────────────────── 세션 화면 분기 ─────────────────────────

function duelKey(d: ArenaDuel): string {
  return JSON.stringify(d)
}

function ArenaSession(): React.JSX.Element {
  const hasSnap = useArenaStore((s) => s.snapshot != null)
  const loading = useArenaStore((s) => s.loading)
  const stage = useArenaStore((s) => s.snapshot?.session.stage)
  const target = useArenaStore((s) => s.snapshot?.session.target)
  const duel = useArenaStore((s) => s.snapshot?.duel ?? null)
  const wait = useArenaStore((s) => s.snapshot?.wait ?? null)
  const progress = useArenaStore((s) => s.snapshot?.progress)
  const peekStage = useArenaStore((s) => s.peekStage)
  const undo = useArenaStore((s) => s.undo)

  useArenaKeys((e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      void undo()
      return true
    }
    return false
  })

  if (!hasSnap || !stage || !progress) {
    return (
      <div className="grid flex-1 place-items-center text-[13px] text-faint">
        {loading ? '세션을 불러오는 중이에요' : '세션을 고르거나 새로 시작해요'}
      </div>
    )
  }

  const negative = target === 'negative'
  let body: React.JSX.Element
  if (negative) {
    if (stage === 'done' || (!duel && !wait)) body = <NegDone />
    else if (duel?.kind === 'neg') body = <NegDuel key={duelKey(duel)} duel={duel} />
    else body = <WaitView />
  } else if (stage === 'confirm' || stage === 'done') {
    body = <ArenaConfirm />
  } else if (peekStage && (stage === 'prelim' || stage === 'main')) {
    body = <StageEnd />
  } else if (duel?.kind === 'quad') {
    body = <QuadDuel key={duelKey(duel)} duel={duel} />
  } else if (duel?.kind === 'set') {
    body = <FinalDuel key={duelKey(duel)} duel={duel} />
  } else if (duel?.kind === 'tune') {
    body = <TuneDuel key={duelKey(duel)} duel={duel} />
  } else if (duel?.kind === 'order') {
    body = <OrderDuel key={duelKey(duel)} duel={duel} />
  } else if (wait) {
    body = <WaitView />
  } else {
    body = <StageEnd />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-3">
        {negative ? (
          <NegProgress />
        ) : (
          <StageStepper stage={stage} progress={progress} duel={duel} />
        )}
        <div className="flex-1" />
        <RemainButton />
        <TagsToggle />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}

function NegProgress(): React.JSX.Element {
  const duel = useArenaStore((s) => s.snapshot?.duel ?? null)
  // 판 수가 아니라 후보 수로 센다 (후보마다 네거티브 장면 수만큼 판이 있다)
  const n = useArenaStore((s) => s.snapshot?.session.state.candidateIds?.length ?? 0)
  const per = useArenaStore(
    (s) => slotLayout(s.snapshot ? sceneCountOf(s.snapshot.session) : 12).neg.length
  )
  const k = duel?.kind === 'neg' ? Math.min(n, Math.floor(duel.index / per) + 1) : n
  return (
    <div className="flex h-10 items-center gap-3 rounded-xl bg-paper px-4">
      <span className="text-[13px] font-semibold">
        후보 {k} / {n}
      </span>
      <ProgressBar value={n ? k / n : 0} className="w-40" />
    </div>
  )
}

/** 대기열에 아무것도 없는데 못 만든 이미지가 남았을 때만 보인다 */
function RemainButton(): React.JSX.Element | null {
  const renders = useArenaStore((s) => s.snapshot?.progress.renders)
  const model = useArenaStore((s) => s.snapshot?.session.config.params.model ?? '')
  const enqueue = useArenaStore((s) => s.enqueue)
  const busy = useArenaStore((s) => s.enqueueing)
  const { gate, dialog } = useLimitGate()
  if (!renders) return null
  const left = renders.missing + renders.failed
  if (left <= 0 || renders.queued > 0) return null
  return (
    <>
      <Button
        disabled={busy}
        className="h-9 rounded-xl"
        onClick={() =>
          gate(left, model, (limit) => void enqueue({ limit, retryFailed: renders.failed > 0 }))
        }
      >
        남은 이미지 {left.toLocaleString()}장 뽑기
      </Button>
      {dialog}
    </>
  )
}
