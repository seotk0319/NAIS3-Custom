import { Check, Clock, ImageOff, Image as ImageIcon } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import type { ArenaDuel, ArenaProgress, ArenaRender, ArenaStage, ArenaTier } from '@shared/arena'
import { imageUrl, thumbnailUrl } from '../../lib/constants'
import { cn } from '../../lib/utils'
import { useArenaRender, useArenaStore } from '../../stores/arena-store'
import { Switch } from '../ui/switch'

// ───────────────────────── 작은 부품 ─────────────────────────

export function Kbd({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[10.5px] font-medium text-muted',
        className
      )}
    >
      {children}
    </kbd>
  )
}

/** 큰 카드 (보기 배경 위의 회색 면) */
export function Card({
  className,
  children
}: {
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return <div className={cn('rounded-[20px] bg-paper', className)}>{children}</div>
}

export function Chip({
  children,
  className,
  title
}: {
  children: ReactNode
  className?: string
  title?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[12px] font-medium text-muted',
        className
      )}
    >
      {children}
    </span>
  )
}

export function NegChip(): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-muted">
      네거티브
    </span>
  )
}

export function SceneChip({ slot, scene }: { slot: number; scene?: string }): React.JSX.Element {
  return (
    <Chip title={scene}>
      <ImageIcon size={13} />
      장면 {slot + 1} · 시드 고정
    </Chip>
  )
}

/** 질문 제목 — 모든 대결 화면의 큰 카드 왼쪽 위 */
export function Question({
  children,
  extra
}: {
  children: ReactNode
  extra?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2.5">
      <h2 className="text-[16px] font-bold tracking-tight text-ink">{children}</h2>
      {extra}
    </div>
  )
}

const TIER_STYLE: Record<ArenaTier, string> = {
  S: 'bg-rose-500/15 text-rose-600 dark:bg-rose-400/[0.18] dark:text-rose-300',
  A: 'bg-orange-500/15 text-orange-600 dark:bg-orange-400/[0.18] dark:text-orange-300',
  B: 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/[0.18] dark:text-amber-300',
  C: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/[0.18] dark:text-emerald-300',
  D: 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/[0.18] dark:text-cyan-300',
  F: 'bg-violet-500/15 text-violet-700 dark:bg-violet-400/[0.18] dark:text-violet-300'
}

export function TierChip({
  tier,
  className
}: {
  tier: ArenaTier | null
  className?: string
}): React.JSX.Element | null {
  if (!tier) return null
  return (
    <span
      className={cn(
        'inline-grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-bold',
        TIER_STYLE[tier],
        className
      )}
    >
      {tier}
    </span>
  )
}

export function TagsToggle(): React.JSX.Element {
  const on = useArenaStore((s) => s.showTags)
  const setShowTags = useArenaStore((s) => s.setShowTags)
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-muted">
      <Switch checked={on} onCheckedChange={setShowTags} />
      작가 태그 보기
    </label>
  )
}

// ───────────────────────── 이미지 ─────────────────────────

export function Placeholder({
  state,
  compact,
  className
}: {
  state?: ArenaRender['state']
  compact?: boolean
  className?: string
}): React.JSX.Element {
  const failed = state === 'failed'
  const waiting = state === 'queued'
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-1.5 bg-surface-2 text-faint',
        failed && 'border border-dashed border-danger/60 text-danger',
        !failed && !waiting && 'border border-dashed border-line',
        className
      )}
    >
      {failed ? <ImageOff size={compact ? 14 : 20} /> : <Clock size={compact ? 14 : 20} />}
      {!compact && (
        <span className="text-[12px] font-medium">
          {failed ? '못 만들었어요' : waiting ? '만드는 중' : '아직 없어요'}
        </span>
      )}
    </div>
  )
}

export const ArenaImage = memo(function ArenaImage({
  comboId,
  slot,
  full,
  lazy,
  className,
  compact
}: {
  comboId: number | undefined
  slot: number | undefined
  full?: boolean
  lazy?: boolean
  className?: string
  compact?: boolean
}): React.JSX.Element {
  const render = useArenaRender(comboId, slot)
  if (!render || render.state !== 'done' || !render.filePath)
    return <Placeholder state={render?.state} compact={compact} className={className} />
  return (
    <img
      src={full ? imageUrl(render.filePath) : thumbnailUrl(render.filePath)}
      decoding="async"
      loading={lazy ? 'lazy' : undefined}
      draggable={false}
      alt=""
      className={cn('size-full select-none bg-surface-2 object-cover', className)}
    />
  )
})

export function Thumb({
  path,
  className,
  children
}: {
  path: string | null | undefined
  className?: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-lg bg-surface-2', className)}>
      {path ? (
        <img
          src={thumbnailUrl(path)}
          decoding="async"
          loading="lazy"
          draggable={false}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-faint">
          <ImageIcon size={14} />
        </div>
      )}
      {children}
    </div>
  )
}

// ───────────────────────── 단계 ─────────────────────────

const STEPS: { key: ArenaStage; label: string }[] = [
  { key: 'prelim', label: '예선' },
  { key: 'main', label: '본선' },
  { key: 'final', label: '결선' },
  { key: 'tune', label: '다듬기' }
]

function stepIndex(stage: ArenaStage): number {
  if (stage === 'prelim') return 0
  if (stage === 'main') return 1
  if (stage === 'final') return 2
  if (stage === 'done') return 4
  return 3
}

export function StageStepper({
  stage,
  progress,
  duel
}: {
  stage: ArenaStage
  progress: ArenaProgress
  duel: ArenaDuel | null
}): React.JSX.Element {
  const cur = stepIndex(stage)
  const note = (): string | null => {
    if (stage === 'prelim' || stage === 'main') return progress.stageVotes + '판'
    if (stage === 'final') return duel?.kind === 'set' ? duel.index + 1 + ' / ' + duel.total : '끝'
    if (stage === 'tune') return duel?.kind === 'tune' ? duel.step + ' / ' + duel.total : null
    if (stage === 'order') return '순서'
    if (stage === 'confirm') return '확정'
    return null
  }
  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-paper p-1">
      {STEPS.map((s, i) => {
        const done = i < cur
        const on = i === cur
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && <span className="mx-1 text-[11px] text-faint">›</span>}
            <div
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px]',
                on ? 'bg-surface font-semibold text-ink' : done ? 'text-ink' : 'text-faint'
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full text-[11px] font-bold',
                  on
                    ? 'bg-accent text-white dark:text-paper'
                    : done
                      ? 'bg-accent-soft text-accent'
                      : 'bg-surface-2 text-faint'
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
              {on && note() && (
                <em className="not-italic text-[12px] font-normal text-muted">{note()}</em>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ProgressBar({
  value,
  className
}: {
  value: number
  className?: string
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: pct + '%' }}
      />
    </div>
  )
}
