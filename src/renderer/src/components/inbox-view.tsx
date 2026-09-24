import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pause,
  Play,
  Search,
  Send,
  Settings2,
  TriangleAlert,
  X
} from 'lucide-react'
import { INBOX_EVENTS, INBOX_EVENT_GROUPS, INBOX_PLATFORMS } from '@shared/inbox'
import type {
  InboxEvent,
  InboxEventGroup,
  InboxResult,
  InboxItem,
  InboxReplyTarget
} from '@shared/inbox'
import { cn } from '../lib/utils'

// Nine separated hues. The previous palette repeated blue, teal and lilac, so three
// pairs of platforms were not distinguishable at any dot size.
const colors: Record<string, string> = {
  crack: '#d95d3e',
  neko: '#d99b1f',
  genit: '#8aa320',
  elyn: '#4ca455',
  babe: '#17a398',
  eden: '#3f8fd6',
  rplay: '#3b4fb8',
  teapot: '#8a5fd6',
  luna: '#d65b9e'
}
// The raw hues are fine as bars but too light to read as small text. Mixing toward the
// theme's ink darkens them on light themes and lightens them on dark ones, so the label
// clears 4.5:1 in both without a second palette.
const tone = (platform: string): string =>
  `color-mix(in oklab, ${colors[platform]} 60%, var(--ink))`
const statusLabels: Record<string, string> = {
  ok: '수집 정상',
  partial: '일부 수집',
  pending: '연결 대기',
  login: '계정 재연결 필요',
  error: '수집 오류',
  auth_required: '계정 재연결 필요',
  unauthorized: '계정 재연결 필요'
}
type View = InboxEventGroup | 'all'
const views: { id: View; label: string }[] = [
  { id: 'conversation', label: '대화' },
  { id: 'reaction', label: '반응' },
  { id: 'all', label: '전체' }
]
const minute = 60_000,
  hour = 60 * minute
const parsed = (value: string | null | undefined): number | null =>
  value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const clock = (at: number): string =>
  new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
const sameDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString()
const dayBefore = (at: number): number => at - 24 * hour

function time(value: string | null | undefined): string {
  const at = parsed(value)
  return at === null
    ? '시간 정보 없음'
    : new Date(at).toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}
// Recency reads faster than a date stamp, so recent items say how long ago and
// anything older falls back to a real date.
function ago(value: string | null | undefined, now: number): string {
  const at = parsed(value)
  if (at === null) return '시간 없음'
  const past = now - at
  if (past < 0) return clock(at)
  if (past < minute) return '방금'
  if (past < hour) return `${Math.floor(past / minute)}분 전`
  if (sameDay(at, now)) return `${Math.floor(past / hour)}시간 전`
  if (sameDay(at, dayBefore(now))) return `어제 ${clock(at)}`
  return new Date(at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
}
function until(value: string | null | undefined, now: number): string | null {
  const at = parsed(value)
  if (at === null) return null
  const left = at - now
  if (left <= 0) return '곧'
  return left < hour ? `${Math.max(1, Math.round(left / minute))}분 후` : clock(at)
}
function dayLabel(value: string | null | undefined, now: number): string {
  const at = parsed(value)
  if (at === null) return '날짜 없음'
  if (sameDay(at, now)) return '오늘'
  if (sameDay(at, dayBefore(now))) return '어제'
  return new Date(at).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  })
}
const isReaction = (event: InboxEvent): boolean =>
  (INBOX_EVENT_GROUPS.reaction as readonly string[]).includes(event)
// A like on the same comment, arriving back to back, says one thing: that comment is
// landing. One row per like said it twelve times and pushed the comments off screen.
type Row = { kind: 'item'; item: InboxItem } | { kind: 'bundle'; key: string; items: InboxItem[] }
function bundle(items: InboxItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    const last = rows.at(-1)
    const lead = last?.kind === 'bundle' ? last.items[0] : last?.kind === 'item' ? last.item : null
    const joins =
      !!lead &&
      isReaction(item.event) &&
      lead.event === item.event &&
      lead.platform === item.platform &&
      lead.title === item.title &&
      (lead.work?.id || null) === (item.work?.id || null)
    if (joins && last?.kind === 'bundle') last.items.push(item)
    else if (joins && last?.kind === 'item')
      rows[rows.length - 1] = { kind: 'bundle', key: last.item.id, items: [last.item, item] }
    else rows.push({ kind: 'item', item })
  }
  return rows
}
function people(items: InboxItem[]): string {
  const names = [...new Set(items.map((x) => x.actor?.name).filter((x): x is string => !!x))]
  if (!names.length) return `${items.length}명`
  const shown = names.slice(0, 2).join(', ')
  const rest = items.length - Math.min(2, names.length)
  return rest > 0 ? `${shown} 외 ${rest}명` : shown
}
const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40'
const intervalLabel = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`

function Dot(): React.JSX.Element {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  )
}

export function InboxView(): React.JSX.Element {
  const [data, setData] = useState<InboxResult | null>(null)
  const [platform, setPlatform] = useState('')
  const [view, setView] = useState<View>('conversation')
  const [event, setEvent] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<InboxItem | null>(null)
  // 답글: 알림별 입력값과 보낸 기록(이번 실행 동안만 기억)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [replying, setReplying] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [replied, setReplied] = useState<Record<string, string>>({})
  // 답글 대상 확인: 알림별로 한 번 불러와 기억한다 (크랙·네코는 시각으로 찾으므로 보여주고 보낸다).
  const [targets, setTargets] = useState<Record<string, InboxReplyTarget | 'loading'>>({})
  const replyTarget = selected ? targets[selected.id] : undefined
  const selectedId = selected?.canReply ? selected.id : null
  // 알림마다 한 번만 요청한다. 결과는 알림 id로 저장하므로 다른 알림을 보는 중에 와도 안전하다.
  const requested = useRef(new Set<string>())
  useEffect(() => {
    if (!selectedId || requested.current.has(selectedId)) return
    requested.current.add(selectedId)
    const timer = setTimeout(() =>
      setTargets((previous) => ({ ...previous, [selectedId]: 'loading' }))
    )
    void window.nais
      .invoke('inbox:replyTarget', { id: selectedId })
      .catch(() => ({ ok: false, message: '원래 댓글을 불러오지 못했어요.' }))
      .then((result) => {
        clearTimeout(timer)
        // 실패는 다시 열었을 때 한 번 더 시도할 수 있게 둔다.
        if (!result.ok) requested.current.delete(selectedId)
        setTargets((previous) => ({ ...previous, [selectedId]: result }))
      })
  }, [selectedId])
  const replyText = selected ? drafts[selected.id] || '' : ''
  const replyNote = selected ? notes[selected.id] || null : null
  const setReplyText = (value: string): void => {
    if (selected) setDrafts((previous) => ({ ...previous, [selected.id]: value }))
  }
  async function sendReply(item: InboxItem): Promise<void> {
    const content = (drafts[item.id] || '').trim()
    const target = targets[item.id]
    if (!content || replying || !target || target === 'loading' || !target.ok) return
    setReplying(item.id)
    setNotes((previous) => {
      const next = { ...previous }
      delete next[item.id]
      return next
    })
    try {
      const result = await window.nais.invoke('inbox:reply', { id: item.id, content })
      setNotes((previous) => ({ ...previous, [item.id]: result }))
      if (result.ok) {
        setReplied((previous) => ({ ...previous, [item.id]: content }))
        setDrafts((previous) => ({ ...previous, [item.id]: '' }))
      }
    } catch {
      setNotes((previous) => ({
        ...previous,
        [item.id]: { ok: false, message: '답글을 달지 못했어요. 잠시 뒤 다시 해주세요.' }
      }))
    } finally {
      setReplying(null)
    }
  }
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pendingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  // Sign-in checks this window started; the service also reports its own.
  const [linking, setLinking] = useState<Set<string>>(new Set())
  // Relative times are measured against the moment the data was fetched, which also
  // keeps render pure; the list refetches every 10 seconds anyway.
  const [now, setNow] = useState(0)
  const eventQuery = event || (view === 'all' ? '' : view)

  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>
    async function refresh(): Promise<void> {
      try {
        const result = await window.nais.invoke('inbox:query', {
          platform,
          event: eventQuery,
          unread: unreadOnly,
          search,
          page
        })
        if (disposed) return
        setNow(Date.now())
        setData(result)
        pendingRef.current = result.thumbnailsPending === true
        setError(result.error || '')
        setSelected((previous) =>
          previous ? result.items.find((item) => item.id === previous.id) || null : null
        )
      } catch {
        if (!disposed) setError('알림을 불러오지 못했어요. 잠시 뒤 다시 확인해주세요.')
      }
      // 작품 이미지를 뒤에서 채우는 중이면 조금 일찍 다시 읽어 썸네일을 바로 채운다.
      if (!disposed) timer = setTimeout(() => void refresh(), pendingRef.current ? 3_000 : 10_000)
    }
    timer = setTimeout(() => void refresh(), search ? 180 : 0)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [platform, eventQuery, unreadOnly, search, page, revision])

  const totalPages = data ? Math.max(1, Math.ceil(data.filtered / data.pageSize)) : 1
  const latest =
    data?.platforms
      .map((p) => p.lastSuccess)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) || null
  const broken = (data?.platforms || []).filter((p) => ['error', 'login'].includes(p.status))
  // A token the collector can still renew by itself is worth showing, but it is not
  // something the person has to act on, so it never becomes an alert.
  const expiring = (data?.platforms || []).filter(
    (p) =>
      !broken.includes(p) &&
      p.expiresAt !== null &&
      Date.parse(p.expiresAt) - now < 10 * minute &&
      Date.parse(p.expiresAt) - now > -hour
  )
  const preserved = broken.reduce((total, p) => total + p.count, 0)
  const tally = (group: View): number =>
    data
      ? (group === 'all'
          ? (Object.keys(INBOX_EVENTS) as InboxEvent[])
          : (INBOX_EVENT_GROUPS[group] as readonly InboxEvent[])
        ).reduce((total, id) => total + data.events[id], 0)
      : 0
  const subEvents = view === 'all' ? [] : (INBOX_EVENT_GROUPS[view] as readonly InboxEvent[])

  // Items arrive newest first, so each day begins exactly one group.
  const grouped: { label: string; items: InboxItem[] }[] = []
  for (const item of data?.items || []) {
    const label = dayLabel(item.at, now)
    const last = grouped.at(-1)
    if (last && last.label === label) last.items.push(item)
    else grouped.push({ label, items: [item] })
  }
  const days = grouped.map((day) => ({ label: day.label, rows: bundle(day.items) }))

  function reset(next: () => void): void {
    next()
    setPage(0)
    setSelected(null)
    setOpen(new Set())
  }
  function toggleOpen(key: string): void {
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  async function toggle(): Promise<void> {
    if (!data || busy) return
    setBusy(true)
    try {
      await window.nais.invoke('inbox:control', { enabled: !data.enabled })
      setRevision((v) => v + 1)
    } catch {
      setError('수집 설정을 바꾸지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  // Sign-in can take the person minutes in the browser; each platform tracks its own check.
  async function link(id: string, label: string): Promise<void> {
    setLinking((previous) => new Set(previous).add(id))
    setMessage(label + ' 로그인 상태를 확인하고 있어요. 크롬 창이 잠깐 열릴 수 있어요.')
    try {
      const result = await window.nais.invoke('inbox:connect', { platform: id })
      setMessage(label + ': ' + result.message)
    } catch {
      setMessage(label + ' 연결을 확인하지 못했어요.')
    } finally {
      setLinking((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
      setRevision((v) => v + 1)
    }
  }
  async function unlink(id: string, label: string): Promise<void> {
    try {
      await window.nais.invoke('inbox:disconnect', { platform: id })
      setMessage(label + ' 로그인 정보를 NAIS3에서 지웠어요. 이미 모은 알림은 그대로예요.')
    } catch {
      setMessage(label + ' 연결을 해제하지 못했어요.')
    }
    setRevision((v) => v + 1)
  }
  async function select(id: string, selected: boolean): Promise<void> {
    try {
      await window.nais.invoke('inbox:select', { platform: id, selected })
      if (!selected && platform === id) reset(() => setPlatform(''))
    } catch {
      setMessage('모아보기 설정을 바꾸지 못했어요.')
    }
    setRevision((v) => v + 1)
  }
  async function openSource(item: InboxItem): Promise<void> {
    try {
      await window.nais.invoke('inbox:openSource', { id: item.id })
    } catch {
      setError('이 알림의 원문 주소를 열지 못했어요.')
    }
  }
  async function setIntervalMinutes(minutes: number): Promise<void> {
    setBusy(true)
    try {
      const result = await window.nais.invoke('inbox:setInterval', { minutes })
      setData((previous) => (previous ? { ...previous, ...result } : previous))
      setMessage(`수집 주기를 ${intervalLabel(minutes)}으로 저장했어요.`)
      setRevision((value) => value + 1)
    } catch {
      setError('수집 주기를 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  function renderItem(item: InboxItem, nested = false): React.JSX.Element {
    const unread = item.unread === true
    const actor = item.actor?.name || null
    // An empty body used to fall back to the actor's name, which then read as content.
    const body = item.body && item.body !== actor && item.body !== item.title ? item.body : null
    // Many titles already quote the work (「작품」 댓글), so repeating it on the right is noise.
    const work = item.work?.title && !item.title.includes(item.work.title) ? item.work.title : null
    return (
      <button
        key={item.id}
        onClick={() => setSelected(item)}
        className={cn(
          'relative flex w-full items-start gap-3 border-b border-line py-2.5 pr-4 text-left transition-colors last:border-b-0',
          nested ? 'pl-9' : 'pl-5',
          selected?.id === item.id ? 'bg-accent-soft' : 'hover:bg-surface-2/50'
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: colors[item.platform] }}
        />
        <WorkThumb item={item} className="mt-0.5 size-9 shrink-0 rounded-lg text-[13px]" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            {unread && (
              <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="안 읽음" />
            )}
            <span
              className={cn(
                'truncate text-[13.5px] leading-snug',
                unread ? 'font-semibold text-ink' : 'text-ink/85'
              )}
            >
              {item.title}
            </span>
            {replied[item.id] && (
              <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent">
                답글 보냄
              </span>
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12px] leading-snug text-muted">
            <span className="shrink-0 font-medium" style={{ color: tone(item.platform) }}>
              {INBOX_PLATFORMS[item.platform]}
            </span>
            <Dot />
            <span className="shrink-0">{INBOX_EVENTS[item.event] || '기타'}</span>
            {actor && (
              <>
                <Dot />
                <span className="max-w-40 shrink-0 truncate text-ink/70">{actor}</span>
              </>
            )}
            {body && (
              <>
                <Dot />
                <span className="min-w-0 truncate">{body}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex max-w-[34%] shrink-0 flex-col items-end gap-0.5 pt-px text-right">
          <span className="text-[11.5px] tabular-nums text-muted">{ago(item.at, now)}</span>
          {work && <span className="max-w-full truncate text-[11px] text-faint">{work}</span>}
        </span>
      </button>
    )
  }

  function renderBundle(row: Extract<Row, { kind: 'bundle' }>): React.JSX.Element {
    const lead = row.items[0]
    const expanded = open.has(row.key)
    const unread = row.items.some((x) => x.unread === true)
    return (
      <div key={row.key}>
        <button
          onClick={() => toggleOpen(row.key)}
          aria-expanded={expanded}
          className="relative flex w-full items-start gap-3 border-b border-line py-2.5 pl-5 pr-4 text-left transition-colors hover:bg-surface-2/50"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ backgroundColor: colors[lead.platform] }}
          />
          <WorkThumb item={lead} className="mt-0.5 size-9 shrink-0 rounded-lg text-[13px]" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {unread && (
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="안 읽음" />
              )}
              <span
                className={cn(
                  'truncate text-[13.5px] leading-snug',
                  unread ? 'font-semibold text-ink' : 'text-ink/85'
                )}
              >
                {lead.title}
              </span>
              <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-px text-[11px] font-medium tabular-nums text-muted">
                {row.items.length}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12px] leading-snug text-muted">
              <span className="shrink-0 font-medium" style={{ color: tone(lead.platform) }}>
                {INBOX_PLATFORMS[lead.platform]}
              </span>
              <Dot />
              <span className="shrink-0">{INBOX_EVENTS[lead.event]}</span>
              <Dot />
              <span className="min-w-0 truncate text-ink/70">{people(row.items)}</span>
            </span>
          </span>
          <span className="flex max-w-[34%] shrink-0 items-center gap-2 pt-px text-right">
            <span className="text-[11.5px] tabular-nums text-muted">{ago(lead.at, now)}</span>
            <ChevronDown
              size={14}
              aria-hidden
              className={cn('text-faint transition-transform', expanded && 'rotate-180')}
            />
          </span>
        </button>
        {expanded && (
          <div className="bg-surface-2/30">{row.items.map((x) => renderItem(x, true))}</div>
        )}
      </div>
    )
  }

  return (
    <section
      className="flex min-w-0 flex-1 overflow-hidden rounded-2xl bg-surface"
      aria-label="알림 모아보기"
    >
      <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-paper/50 p-3 xl:w-56">
        <h2 className="mb-4 flex items-center gap-2 px-2 pt-2 text-[14px] font-semibold">
          <Bell size={17} /> 플랫폼
        </h2>
        <button
          onClick={() => reset(() => setPlatform(''))}
          className={cn(
            'mb-2 flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px]',
            !platform ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2'
          )}
        >
          <span>전체 플랫폼</span>
          <span className="tabular-nums">{data?.total.toLocaleString() || '0'}</span>
        </button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {(data?.platforms || [])
            .filter((p) => p.selected)
            .map((p) => {
              const trouble = ['error', 'login'].includes(p.status)
              const soon = expiring.includes(p)
              return (
                <button
                  key={p.id}
                  onClick={() => reset(() => setPlatform(p.id))}
                  title={`${statusLabels[p.status] || p.status} · 마지막 성공 ${time(p.lastSuccess)}`}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px]',
                    platform === p.id ? 'bg-accent-soft' : 'hover:bg-surface-2'
                  )}
                >
                  <span
                    aria-hidden
                    className="h-4 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: colors[p.id] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[12.5px] font-medium',
                        platform === p.id ? 'text-accent' : 'text-ink'
                      )}
                    >
                      {p.label}
                    </span>
                    {trouble && (
                      <span className="mt-0.5 block truncate text-[10.5px] font-medium text-danger">
                        {statusLabels[p.status] || p.status}
                      </span>
                    )}
                    {!trouble && soon && (
                      <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                        {p.canRenew ? '곧 자동 갱신' : '인증 곧 만료'}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {p.count.toLocaleString()}
                  </span>
                </button>
              )
            })}
        </div>
        <p className="mt-3 px-2 text-[11px] leading-relaxed text-faint">
          로그인한 계정의 알림을 모아요.
          <br />
          원본 사이트의 읽음 상태는 바꾸지 않아요.
        </p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-[21px] font-semibold tracking-tight">알림 모아보기</h1>
          <div className="flex w-64 items-center gap-2 rounded-lg border border-line bg-paper px-3">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              value={search}
              onChange={(e) => {
                const value = e.target.value
                reset(() => setSearch(value))
              }}
              placeholder="작품, 작성자, 내용 검색"
              aria-label="알림 검색"
              className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
            />
            {search && (
              <button aria-label="검색어 지우기" onClick={() => reset(() => setSearch(''))}>
                <X size={13} className="text-faint" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            수집 주기
            <select
              aria-label="수집 주기"
              value={data?.intervalMinutes ?? 60}
              disabled={!data?.available || busy}
              onChange={(e) => void setIntervalMinutes(Number(e.target.value))}
              className="rounded-lg border border-line bg-paper px-2 py-2 text-ink disabled:opacity-40"
            >
              {[5, 15, 30, 60, 120, 360, 1440].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {intervalLabel(minutes)}
                </option>
              ))}
            </select>
          </label>
          <button className={button} onClick={() => setSettings((v) => !v)}>
            <Settings2 size={14} /> 연결 관리
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger"
          >
            {error}
          </div>
        )}
        {!!broken.length && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-danger/25 bg-danger/[0.07] px-4 py-3"
          >
            <TriangleAlert size={17} className="shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">
                {broken.map((p) => p.label).join(', ')} 계정 인증이 풀려서 새 알림을 못 받고 있어요
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                이미 저장한 {preserved.toLocaleString()}건은 그대로 볼 수 있어요
                {broken[0].detail ? ` · ${broken[0].detail}` : ''}
              </p>
            </div>
            <button
              onClick={() => setSettings(true)}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-paper"
            >
              연결 관리
            </button>
          </div>
        )}
        {settings && (
          <div className="rounded-lg border border-line bg-paper p-4 text-[12px]">
            <div className="mb-2 flex items-center justify-between">
              <strong>플랫폼 연결</strong>
              <button aria-label="연결 관리 닫기" onClick={() => setSettings(false)}>
                <X size={15} />
              </button>
            </div>
            <p className="leading-relaxed text-muted">
              플랫폼마다 한 번 로그인하면 NAIS3가 직접 알림을 모아요. 로그인 창은 크롬(없으면
              엣지)으로 열리고, NAIS3 전용 프로필이라 평소 쓰는 크롬과 섞이지 않아요. 로그인한 뒤
              그 창을 닫으면 NAIS3가 연결을 마쳐요. 체크를 끈 플랫폼은 모으지도, 목록에 보여주지도
              않아요.
            </p>
            {data?.directError && <p className="mt-2 text-danger">{data.directError}</p>}
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {(data?.platforms || []).map((p) => {
                const checking = linking.has(p.id) || p.connecting
                const relogin = p.appConnected && p.status === 'login'
                const state = checking
                  ? '로그인 상태를 확인하고 있어요…'
                  : p.awaitingLogin
                    ? p.loginWindowOpen
                      ? '로그인한 뒤 창을 닫으면 알아서 연결돼요'
                      : '로그인 창이 닫혔어요. 로그인했다면 ‘로그인 완료’를 눌러주세요'
                    : relogin
                      ? '다시 로그인이 필요해요'
                      : p.appConnected
                        ? 'NAIS3로 연결됨'
                        : '연결 안 됨'
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={p.selected}
                      onChange={(e) => void select(p.id, e.target.checked)}
                      aria-label={p.label + ' 모아보기'}
                      className="size-3.5 shrink-0 accent-accent"
                    />
                    <span
                      aria-hidden
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: colors[p.id] }}
                    />
                    <span className="w-16 shrink-0 font-medium text-ink">{p.label}</span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        relogin ? 'text-danger' : 'text-muted'
                      )}
                    >
                      {state}
                    </span>
                    {p.appConnected && !checking && !p.awaitingLogin && (
                      <button
                        className="shrink-0 text-faint hover:text-ink"
                        onClick={() => void unlink(p.id, p.label)}
                      >
                        해제
                      </button>
                    )}
                    <button
                      className={button}
                      disabled={checking || !data?.available}
                      onClick={() => void link(p.id, p.label)}
                    >
                      {p.awaitingLogin
                        ? '로그인 완료'
                        : relogin
                          ? '다시 로그인'
                          : p.appConnected
                            ? '다시 연결'
                            : '로그인'}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-faint">
              수집기 마지막 응답 {time(data?.lastSeen || null)} · 루나는 알림 페이지 응답을 직접
              읽어요.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                className={button}
                disabled={!data?.available || busy}
                onClick={() => void toggle()}
              >
                {data?.enabled ? <Pause size={13} /> : <Play size={13} />}{' '}
                {data?.enabled ? '수집 일시정지' : '수집 재개'}
              </button>
              <span className="text-muted">{message}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div
            role="tablist"
            aria-label="알림 종류"
            className="inline-flex rounded-lg border border-line bg-surface-2/60 p-0.5"
          >
            {views.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() =>
                  reset(() => {
                    setView(v.id)
                    setEvent('')
                  })
                }
                className={cn(
                  'rounded-md px-3 py-1.5 text-[12.5px] transition-colors',
                  view === v.id
                    ? 'bg-paper font-semibold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                    : 'text-muted hover:text-ink'
                )}
              >
                {v.label}
                <span className="ml-1.5 tabular-nums text-faint">
                  {tally(v.id).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          {subEvents.length > 1 && (
            <div className="flex items-center gap-0.5">
              {[
                ['', '모두'] as const,
                ...subEvents.map((id) => [id, INBOX_EVENTS[id]] as const)
              ].map(([id, label]) => (
                <button
                  key={id || 'any'}
                  onClick={() => reset(() => setEvent(id))}
                  className={cn(
                    'rounded-md px-2 py-1 text-[12px] transition-colors',
                    event === id
                      ? 'bg-surface-2 font-semibold text-ink'
                      : 'text-muted hover:text-ink'
                  )}
                >
                  {label}
                  {id && data ? (
                    <span className="ml-1 tabular-nums text-faint">
                      {data.events[id].toLocaleString()}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <button
            role="switch"
            aria-checked={unreadOnly}
            onClick={() => reset(() => setUnreadOnly((v) => !v))}
            className={cn(
              'ml-auto inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors',
              unreadOnly ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:text-ink'
            )}
          >
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', unreadOnly ? 'bg-accent' : 'bg-faint')}
            />
            안 읽은 것만
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-paper"
          aria-label="알림 목록"
        >
          {!data ? (
            <p className="p-10 text-center text-[13px] text-muted">알림을 불러오는 중이에요…</p>
          ) : !data.items.length ? (
            <p className="p-10 text-center text-[13px] text-muted">
              {!data.total
                ? '연결된 계정의 첫 알림을 기다리고 있어요.'
                : unreadOnly
                  ? '안 읽은 알림이 없어요.'
                  : '조건에 맞는 알림이 없어요.'}
            </p>
          ) : (
            days.map((day) => (
              <section key={day.label} aria-label={day.label}>
                <h3 className="sticky top-0 z-10 border-b border-line bg-paper/95 px-5 py-1.5 text-[11px] font-semibold text-faint backdrop-blur">
                  {day.label}
                </h3>
                {day.rows.map((row) =>
                  row.kind === 'bundle' ? renderBundle(row) : renderItem(row.item)
                )}
              </section>
            ))
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="tabular-nums">
            {(data?.filtered || 0).toLocaleString()}건
            {data?.unread && !unreadOnly ? ` · 안 읽음 ${data.unread.toLocaleString()}` : ''}
          </span>
          <span className="tabular-nums text-faint">
            {data?.collectorOnline
              ? data.enabled
                ? `마지막 수집 ${ago(latest, now)}${
                    data.collecting
                      ? ' · 수집 중'
                      : until(data.nextCollectionAt, now)
                        ? ` · 다음 ${until(data.nextCollectionAt, now)}`
                        : ''
                  }`
                : '자동 수집 일시정지'
              : '수집기 연결 대기'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              className={button}
              aria-label="이전 알림 페이지"
              disabled={!data || data.page === 0}
              onClick={() => {
                setPage(Math.max(0, (data?.page || 0) - 1))
                setSelected(null)
                setOpen(new Set())
              }}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="tabular-nums">
              {(data?.page || 0) + 1} / {totalPages}
            </span>
            <button
              className={button}
              aria-label="다음 알림 페이지"
              disabled={!data || data.page + 1 >= totalPages}
              onClick={() => {
                setPage((data?.page || 0) + 1)
                setSelected(null)
                setOpen(new Set())
              }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </footer>
      </main>

      {selected && (
        <aside
          className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-paper/40 p-5 xl:w-80"
          aria-label="알림 상세"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">알림 상세</h2>
            <button aria-label="알림 상세 닫기" onClick={() => setSelected(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span
              aria-hidden
              className="h-4 w-1 rounded-full"
              style={{ backgroundColor: colors[selected.platform] }}
            />
            <span className="font-medium" style={{ color: tone(selected.platform) }}>
              {INBOX_PLATFORMS[selected.platform]}
            </span>
            <Dot />
            <span className="text-muted">{INBOX_EVENTS[selected.event]}</span>
          </div>
          {selected.thumbnail && (
            <WorkThumb item={selected} className="aspect-[3/4] w-full rounded-xl text-[40px]" />
          )}
          <h3 className="text-[16px] font-semibold leading-snug">{selected.title}</h3>
          <p className="select-text whitespace-pre-wrap break-words rounded-lg border border-line bg-paper p-3 text-[13px] leading-relaxed">
            {selected.body || '내용 없음'}
          </p>
          <dl className="grid grid-cols-[4rem_1fr] gap-y-3 text-[12px]">
            <dt className="text-muted">작성자</dt>
            <dd className="break-words">{selected.actor?.name || '제공되지 않음'}</dd>
            <dt className="text-muted">작품</dt>
            <dd className="break-words">
              {selected.work?.title ||
                (selected.work?.id ? '작품 ID: ' + selected.work.id : '제공되지 않음')}
            </dd>
            <dt className="text-muted">작성일</dt>
            <dd>{time(selected.at)}</dd>
            <dt className="text-muted">읽음 상태</dt>
            <dd>
              {selected.unread === null ? '제공되지 않음' : selected.unread ? '읽지 않음' : '읽음'}
            </dd>
          </dl>
          {selected.canReply && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold text-muted">
                <span style={{ color: tone(selected.platform) }}>
                  {INBOX_PLATFORMS[selected.platform]}
                </span>{' '}
                · 답글 달 댓글
              </p>
              {replyTarget === undefined || replyTarget === 'loading' ? (
                <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12px] text-faint">
                  원래 댓글을 찾고 있어요…
                </p>
              ) : replyTarget.ok ? (
                <div className="rounded-xl border border-line px-3 py-2.5 text-[12px]">
                  <p className="font-semibold text-ink">
                    {replyTarget.author || '작성자 미확인'}
                    <span className="ml-1.5 font-normal text-faint">{time(replyTarget.at ?? null)}</span>
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted">
                    {replyTarget.content}
                  </p>
                </div>
              ) : (
                <p className="rounded-xl bg-danger/10 px-3 py-2.5 text-[12px] text-danger">
                  {replyTarget.message}
                </p>
              )}
              {replied[selected.id] && (
                <p className="rounded-lg bg-accent-soft px-3 py-2 text-[12px] text-accent">
                  보낸 답글: {replied[selected.id]}
                </p>
              )}
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void sendReply(selected)
                  }
                }}
                maxLength={1000}
                rows={3}
                placeholder="답글을 입력하세요 (Ctrl+Enter로 보내기)"
                className="w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
              />
              <button
                disabled={
                  !replyText.trim() ||
                  replying !== null ||
                  !(replyTarget && replyTarget !== 'loading' && replyTarget.ok)
                }
                onClick={() => void sendReply(selected)}
                className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40 dark:text-paper"
              >
                <Send size={14} /> {replying === selected.id ? '보내는 중…' : '답글 보내기'}
              </button>
              {replyNote && (
                <p className={cn('text-[12px]', replyNote.ok ? 'text-accent' : 'text-danger')}>
                  {replyNote.message}
                </p>
              )}
            </div>
          )}
          <button
            disabled={!selected.url}
            onClick={() => void openSource(selected)}
            className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-3 text-[13px] font-semibold text-paper disabled:opacity-40"
          >
            원문에서 보기 <ExternalLink size={14} />
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            원문을 열면 해당 사이트의 동작에 따라 읽음 처리될 수 있어요.
          </p>
        </aside>
      )}
    </section>
  )
}

/** 알림이 가리키는 작품 이름 (「」 안 또는 작품 제목). */
function workNameOf(item: InboxItem): string | null {
  if (item.work?.title) return item.work.title
  return /「(.+?)」/.exec(item.title || '')?.[1] ?? null
}

/**
 * 작품 썸네일 한 칸. 원본 비율이 1:1~2:3로 달라도 틀 하나에 꽉 채워 자르고,
 * 세로 그림은 얼굴이 있는 위쪽 20% 지점을 기준으로 자른다. 이미지가 없거나 못 불러오면
 * 플랫폼 색 바탕에 작품 첫 글자를 둔다 — 모든 줄이 같은 모양으로 보이게.
 */
function WorkThumb({ item, className }: { item: InboxItem; className: string }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const src = item.thumbnail && failed !== item.thumbnail ? item.thumbnail : null
  if (src)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(src)}
        className={cn('bg-surface-2 object-cover object-[center_20%]', className)}
      />
    )
  const name = workNameOf(item)
  const letter = (name || INBOX_PLATFORMS[item.platform] || '?').trim().replace(/^re:\s*/i, '').charAt(0)
  return (
    <span
      aria-hidden
      className={cn('grid place-items-center font-bold text-white', className)}
      style={{ backgroundColor: `color-mix(in oklab, ${colors[item.platform]} 78%, black)` }}
    >
      {letter}
    </span>
  )
}
