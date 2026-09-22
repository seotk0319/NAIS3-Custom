import { useEffect, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  X
} from 'lucide-react'
import { INBOX_EVENTS, INBOX_PLATFORMS } from '@shared/inbox'
import type { InboxResult, InboxItem } from '@shared/inbox'
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
const statusLabels: Record<string, string> = {
  ok: '수집 정상',
  partial: '일부 수집',
  pending: '연결 대기',
  login: '계정 재연결 필요',
  error: '수집 오류',
  auth_required: '계정 재연결 필요',
  unauthorized: '계정 재연결 필요'
}
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
  if (at === null) return '시간 정보 없음'
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
const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40'
const intervalLabel = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`

export function InboxView(): React.JSX.Element {
  const [data, setData] = useState<InboxResult | null>(null)
  const [platform, setPlatform] = useState('')
  const [event, setEvent] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<InboxItem | null>(null)
  const [settings, setSettings] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>
    async function refresh(): Promise<void> {
      try {
        const result = await window.nais.invoke('inbox:query', { platform, event, search, page })
        if (disposed) return
        setData(result)
        setError(result.error || '')
        setSelected((previous) =>
          previous ? result.items.find((item) => item.id === previous.id) || null : null
        )
      } catch {
        if (!disposed) setError('알림을 불러오지 못했어요. 잠시 뒤 다시 확인해주세요.')
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 10_000)
    }
    timer = setTimeout(() => void refresh(), search ? 180 : 0)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [platform, event, search, page, revision])

  const now = Date.now()
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

  // Items arrive newest first, so each day begins exactly one group.
  const groups: { label: string; items: InboxItem[] }[] = []
  for (const item of data?.items || []) {
    const label = dayLabel(item.at, now)
    const last = groups.at(-1)
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  function reset(next: () => void): void {
    next()
    setPage(0)
    setSelected(null)
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
  return (
    <section
      className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface"
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
          {(data?.platforms || []).map((p) => {
            const trouble = ['error', 'login'].includes(p.status)
            const soon = expiring.includes(p)
            return (
              <button
                key={p.id}
                onClick={() => reset(() => setPlatform(p.id))}
                title={`${statusLabels[p.status] || p.status} · 마지막 성공 ${time(p.lastSuccess)}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]',
                  platform === p.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2'
                )}
              >
                <span
                  aria-hidden
                  className="h-4 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[p.id] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {p.label}
                  </span>
                  {trouble && (
                    <span className="mt-0.5 block truncate text-[10.5px] font-medium text-amber-600">
                      {statusLabels[p.status] || p.status}
                    </span>
                  )}
                  {!trouble && soon && (
                    <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                      {p.canRenew ? '곧 자동 갱신' : '인증 곧 만료'}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">{p.count.toLocaleString()}</span>
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
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[21px] font-semibold tracking-tight">알림 모아보기</h1>
          <div className="flex items-center gap-2">
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
          </div>
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
            className="flex items-center gap-3 rounded-xl border border-l-[3px] border-amber-500/30 border-l-amber-500 bg-amber-500/10 px-4 py-3"
          >
            <TriangleAlert size={18} className="shrink-0 text-amber-600" />
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
              <strong>수집 연결</strong>
              <button aria-label="연결 관리 닫기" onClick={() => setSettings(false)}>
                <X size={15} />
              </button>
            </div>
            <p className="leading-relaxed text-muted">
              {data?.paired
                ? '기존 모아 확장 프로그램과 연결되어 있어요.'
                : 'Chrome의 모아 확장 프로그램에 연결 코드를 입력해주세요.'}{' '}
              Chrome에 로그인된 계정으로 알림을 조회해요. 계정이 끊기면 모아 확장의 ‘계정 API
              연결’을 눌러주세요.
            </p>
            <p className="mt-2 text-faint">
              수집기 {data?.collectorVersion || '미연결'} · 마지막 응답{' '}
              {time(data?.lastSeen || null)} · 루나는 알림 페이지 응답을 직접 읽어요.
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
              {!data?.paired && (
                <button
                  className={button}
                  onClick={() => {
                    void window.nais
                      .invoke('inbox:copyPairCode', undefined)
                      .then((v) =>
                        setMessage(v.copied ? '연결 코드를 복사했어요.' : '이미 연결되어 있어요.')
                      )
                      .catch(() => setMessage('코드를 복사하지 못했어요.'))
                  }}
                >
                  연결 코드 복사
                </button>
              )}
              <span className="text-muted">{message}</span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-64 flex-1 items-center gap-2 rounded-lg border border-line bg-paper px-3 lg:max-w-72">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              value={search}
              onChange={(e) => {
                const value = e.target.value
                reset(() => setSearch(value))
              }}
              placeholder="작품명, 작성자, 알림 검색"
              aria-label="알림 검색"
              className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
            />
            <button
              title="저장된 알림 새로고침"
              aria-label="저장된 알림 새로고침"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={14} className="text-muted" />
            </button>
          </div>
          {[['', '전체'], ...Object.entries(INBOX_EVENTS)].map(([id, label]) => (
            <button
              key={id}
              onClick={() => reset(() => setEvent(id))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px]',
                event === id
                  ? 'border-accent/40 bg-accent-soft font-semibold text-accent'
                  : 'border-line text-muted hover:bg-surface-2'
              )}
            >
              {label}
              {id && data ? (
                <span className="ml-1 tabular-nums opacity-70">
                  {data.events[id as keyof typeof INBOX_EVENTS].toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" aria-label="알림 목록">
          {!data ? (
            <p className="p-10 text-center text-[13px] text-muted">알림을 불러오는 중이에요…</p>
          ) : !data.items.length ? (
            <p className="p-10 text-center text-[13px] text-muted">
              {data.total
                ? '조건에 맞는 알림이 없어요.'
                : '연결된 계정의 첫 알림을 기다리고 있어요.'}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <div className="flex items-center gap-2.5 px-0.5 pb-1.5 pt-3 first:pt-0">
                  <span className="text-[11px] font-semibold text-faint">{group.label}</span>
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11px] tabular-nums text-faint">
                    {group.items.length.toLocaleString()}건
                  </span>
                </div>
                {group.items.map((item) => {
                  const unread = item.unread === true
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item)}
                      className={cn(
                        'mb-1.5 flex w-full items-stretch overflow-hidden rounded-xl border text-left transition-colors',
                        selected?.id === item.id
                          ? 'border-accent/40 bg-accent-soft'
                          : unread
                            ? 'border-line bg-paper hover:bg-surface-2/60'
                            : 'border-line bg-transparent hover:bg-surface-2/60'
                      )}
                    >
                      <span
                        aria-hidden
                        className="w-[3px] shrink-0"
                        style={{
                          backgroundColor: colors[item.platform],
                          opacity: unread ? 1 : 0.3
                        }}
                      />
                      <span className="min-w-0 flex-1 px-3.5 py-2.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: colors[item.platform] }}
                          >
                            {INBOX_PLATFORMS[item.platform]}
                          </span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                            {INBOX_EVENTS[item.event] || '기타'}
                          </span>
                          {unread && (
                            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                              안 읽음
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'mt-1 block truncate text-[13.5px] leading-snug',
                            unread ? 'font-semibold text-ink' : 'text-ink/90'
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-muted">
                          {item.body || item.actor?.name || '내용 없음'}
                        </span>
                      </span>
                      <span className="flex w-36 shrink-0 flex-col items-end gap-1 py-2.5 pl-2 pr-3.5 text-right xl:w-44">
                        <span className="text-[11.5px] tabular-nums text-muted">
                          {ago(item.at, now)}
                        </span>
                        {item.work?.title && (
                          <span className="max-w-full truncate text-[11px] text-faint">
                            {item.work.title}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </section>
            ))
          )}
        </div>
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="tabular-nums">
            {(data?.filtered || 0).toLocaleString()}건
            {data?.unread ? ` · 안 읽음 ${data.unread.toLocaleString()}건` : ''}
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
            <span className="font-semibold" style={{ color: colors[selected.platform] }}>
              {INBOX_PLATFORMS[selected.platform]}
            </span>
            <span className="rounded bg-surface-2 px-2 py-1 text-muted">
              {INBOX_EVENTS[selected.event]}
            </span>
          </div>
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
