import {
  Coins,
  Download,
  Loader2,
  Minus,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import nais3Icon from '../assets/nais3-icon.svg'
import { cn } from '../lib/utils'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useUpdateStore } from '../stores/update-store'
import { useVibesStore, useCharRefsStore } from '../stores/refs-store'
import { estimateAnlas } from '@shared/anlas'
import type { V5UsageStatus } from '@shared/types'
import { estimateV5Images, V5_ESTIMATE_BASIS } from '@shared/v5-usage'
import { PageNav } from './page-nav'
import { ThemeToggle } from './theme-toggle'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

function ctrl(action: 'minimize' | 'maximize' | 'close'): void {
  void window.nais.invoke('window:control', { action })
}

/** 업데이트 발견 시 나타나는 다운로드 버튼 (신호등·패널토글 옆). 클릭 시 자동 업데이트 진행 */
function UpdateButton(): React.JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const percent = useUpdateStore((s) => s.percent)
  const version = useUpdateStore((s) => s.version)
  const start = useUpdateStore((s) => s.start)
  const install = useUpdateStore((s) => s.install)

  if (status === 'available') {
    return (
      <BarButton
        onClick={start}
        className="text-accent hover:text-accent"
        title={`업데이트 ${version ?? ''} 다운로드 후 자동 설치`}
      >
        <Download size={15} />
      </BarButton>
    )
  }
  if (status === 'downloading') {
    return (
      <BarButton className="text-accent" title={`업데이트 다운로드 중 ${percent}%`} disabled>
        <Loader2 size={15} className="animate-spin" />
      </BarButton>
    )
  }
  if (status === 'downloaded') {
    return (
      <BarButton
        onClick={install}
        className="text-accent hover:text-accent"
        title={`업데이트 ${version ?? ''} 설치 준비됨 — 누르면 재시작해서 설치`}
      >
        <Download size={15} />
      </BarButton>
    )
  }
  return null
}

/** Anlas 잔액 + 예상 소모(-N). 토큰 미설정(잔액 없음)이면 표시하지 않음 */
function AnlasStat({
  balance,
  cost
}: {
  balance: number | null
  cost: number
}): React.JSX.Element | null {
  if (balance === null) return null
  return (
    <span className="flex items-center gap-1.5" title="Anlas 잔액 (생성할 때마다 갱신)">
      <Coins size={13} className="text-[#c9a34f]" />
      <span className="font-semibold tabular-nums text-ink">{balance.toLocaleString()}</span>
      {cost > 0 && (
        <span
          className="rounded-md bg-danger/12 px-1.5 text-[11.5px] font-semibold tabular-nums text-danger"
          title="이번 생성에 소모될 Anlas (고해상도 · 캐릭터 레퍼런스 · 미인코딩 바이브 포함)"
        >
          -{cost}
        </span>
      )}
    </span>
  )
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  if (hours > 0) return `${hours}시간 ${minutes}분 ${secs}초`
  if (minutes > 0) return `${minutes}분 ${secs}초`
  return `${secs}초`
}

/** V5 잔량과 예상 장수. 충전 속도·완충 시간은 툴팁으로 보여준다. */
function V5UsageStat({ usage }: { usage: V5UsageStatus | null }): React.JSX.Element | null {
  if (!usage) return null
  const secondsPerPercent = usage.timeUntilNextPercent
  const refillRate = secondsPerPercent > 0 ? Math.round((3600 / secondsPerPercent) * 10) / 10 : 0
  const percentToFull = usage.isNegative ? usage.percent + 100 : 100 - usage.percent
  const fullIn = percentToFull * secondsPerPercent
  const refillText = usage.percent >= 100 ? '가득 참' : `+${refillRate}%/h`
  const barPercent = usage.isNegative ? 0 : Math.max(0, Math.min(100, usage.percent))

  return (
    <span
      className="flex items-center gap-1.5"
      title={`V5 생성 한도 잔량 ${usage.percent}%\n${
        usage.percent >= 100
          ? '충전 완료'
          : `충전 속도 ${refillRate}%/시간 · 1%당 ${formatDuration(secondsPerPercent)}\n100%까지 약 ${formatDuration(fullIn)}`
      }\n${refillText}\n약 ${estimateV5Images(usage).toLocaleString()}장: ${V5_ESTIMATE_BASIS}`}
    >
      <span className="font-medium text-muted">V5</span>
      <span className={cn('font-semibold tabular-nums', usage.isNegative ? 'text-danger' : 'text-ink')}>
        {usage.isNegative ? '−' : ''}
        {usage.percent}%
      </span>
      {/* 좁은 창에서는 덜 중요한 것부터 숨긴다: 약 N장(1420px 미만) → 막대(1300px 미만). 소모량 칩(-N)이 붙어도 안 잘리는 폭 */}
      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-surface-2 min-[1300px]:block">
        <span className="block h-full rounded-full bg-[#1fa56a]" style={{ width: `${barPercent}%` }} />
      </span>
      <span className="hidden tabular-nums text-muted min-[1420px]:inline">
        {usage.isNegative ? '제한됨' : `약 ${estimateV5Images(usage).toLocaleString()}장`}
      </span>
    </span>
  )
}

function BarButton({
  className,
  active,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }): React.JSX.Element {
  return (
    <button
      className={cn(
        'no-drag grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none',
        active && 'text-ink',
        className
      )}
      {...props}
    />
  )
}

export function Titlebar(): React.JSX.Element {
  const leftOpen = useLayoutStore((s) => s.leftOpen)
  const rightOpen = useLayoutStore((s) => s.rightOpen)
  const toggleLeft = useLayoutStore((s) => s.toggleLeft)
  const toggleRight = useLayoutStore((s) => s.toggleRight)
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const anlasBalance = useGenerationStore((s) => s.anlasBalance)
  const v5Usage = useGenerationStore((s) => s.v5Usage)
  const refreshAnlas = useGenerationStore((s) => s.refreshAnlas)
  const [profileTitle, setProfileTitle] = useState<string | null>(null)

  useEffect(() => {
    void window.nais.invoke('app:profile', undefined).then(({ profile, title }) => {
      if (profile > 0) {
        setProfileTitle(title)
        document.title = title
      }
    })
  }, [])

  // 이번 생성에 소모될 Anlas 추정 (고해상도·캐릭터 레퍼런스·미인코딩 바이브 등)
  const request = useGenerationStore((s) => s.request)
  const batchCount = useGenerationStore((s) => s.batchCount)
  const tier = useGenerationStore((s) => s.subscriptionTier)
  const enabledCrefs = useCharRefsStore((s) => s.items.filter((c) => c.enabled).length)
  const unencodedVibes = useVibesStore(
    (s) => s.items.filter((v) => v.enabled && !v.encodedReady).length
  )
  const anlasCost = estimateAnlas({
    width: request.width,
    height: request.height,
    steps: request.steps,
    strength: request.source ? (request.i2iStrength ?? 0.7) : 1,
    charRefCount: enabledCrefs,
    isOpus: tier === 'opus',
    batchCount,
    unencodedVibes
  }).total

  useEffect(() => {
    if (!v5Usage || v5Usage.percent >= 100) return
    // timeUntilNextPercent는 카운트다운이 아니라 1%당 초다. 한 주기마다 서버 비율만 새로 읽는다.
    const refreshInMs = Math.max(60_000, v5Usage.timeUntilNextPercent * 1000)
    const timer = window.setTimeout(() => void refreshAnlas(), refreshInMs)
    return () => window.clearTimeout(timer)
  }, [v5Usage, refreshAnlas])

  return (
    <header
      className="drag relative grid h-14 shrink-0 select-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 bg-paper px-3"
      style={{ paddingLeft: isMac ? 90 : undefined }}
    >
      {/* 왼쪽: 패널 토글 · 앱 이름 · 업데이트 · 잔량 (오른쪽은 버튼이 많아 좁은 창에서 잘려서 여기로) */}
      <div className="flex min-w-0 items-center gap-1.5">
        <BarButton onClick={toggleLeft} active={leftOpen} title="생성 패널 접기/펴기">
          <PanelLeft size={16} />
        </BarButton>
        <img src={nais3Icon} alt="" className="ml-1 size-6 shrink-0 rounded-md" draggable={false} />
        {/* 1200px 미만에서는 앱 이름 글자를 숨기고 로고만 남겨 잔량 표시 자리를 만든다 */}
        <span className="hidden shrink-0 whitespace-nowrap text-[14px] font-bold text-ink min-[1200px]:inline">
          {profileTitle ?? 'NAIS3 Custom'}
        </span>
        <UpdateButton />
        {(anlasBalance !== null || v5Usage) && (
          <div className="no-drag ml-2 flex h-9 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap rounded-xl bg-surface px-3 text-[12.5px]">
            <AnlasStat balance={anlasBalance} cost={anlasCost} />
            {anlasBalance !== null && v5Usage && <span className="h-3.5 w-px shrink-0 bg-line" />}
            <V5UsageStat usage={v5Usage} />
          </div>
        )}
      </div>

      {/* 가운데: 탭 (창 한가운데 고정) */}
      <div className="no-drag flex items-center justify-center">
        <PageNav />
      </div>

      {/* 오른쪽: 테마 · 패널 · 설정 · 창 컨트롤 */}
      <div className="flex min-w-0 items-center justify-end gap-1">
        <div className="no-drag mx-0.5 shrink-0">
          <ThemeToggle />
        </div>
        <BarButton onClick={toggleRight} active={rightOpen} title="히스토리 패널 접기/펴기">
          <PanelRight size={16} />
        </BarButton>
        <BarButton onClick={() => setSettingsOpen(true)} title="설정">
          <Settings size={16} />
        </BarButton>
        {!isMac && (
          <div className="no-drag ml-1 flex shrink-0 items-center">
            <BarButton className="w-10" onClick={() => ctrl('minimize')} aria-label="최소화">
              <Minus size={15} />
            </BarButton>
            <BarButton className="w-10" onClick={() => ctrl('maximize')} aria-label="최대화">
              <Square size={12} />
            </BarButton>
            <BarButton
              className="w-10 hover:bg-danger hover:text-white"
              onClick={() => ctrl('close')}
              aria-label="닫기"
            >
              <X size={15} />
            </BarButton>
          </div>
        )}
      </div>
    </header>
  )
}
