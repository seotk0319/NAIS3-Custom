import { CalendarPlus, Check, CircleSlash, Copy, LogIn, Undo2 } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { comboString, hasArtistToken } from '@shared/arena'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { useGenerationStore } from '../../stores/generation-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useScenesStore } from '../../stores/scenes-store'
import { toast } from '../../stores/toast-store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { ArenaImage, Card, Kbd } from './arena-common'
import {
  applyComboToMain,
  copyText,
  sendComboToMain,
  useArenaKeys,
  useCellRatio,
  useFitBox
} from './arena-utils'

export function ArenaConfirm(): React.JSX.Element {
  const session = useArenaStore((s) => s.snapshot?.session)
  const combos = useArenaStore((s) => s.snapshot?.combos)
  const renders = useArenaStore((s) => s.snapshot?.renders)
  const confirm = useArenaStore((s) => s.confirm)
  const retune = useArenaStore((s) => s.retune)
  const setNegativeSeed = useArenaStore((s) => s.setNegativeSeed)
  const setView = useArenaStore((s) => s.setView)
  const [before, setBefore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)

  const stage = session?.stage
  const tune = session?.state.tune
  const done = stage === 'done'
  const tunedId = done
    ? (session?.state.confirmedComboId ?? tune?.tunedComboId)
    : tune?.tunedComboId
  const baseId = tune?.baseComboId
  const tuned = combos?.find((c) => c.id === tunedId)
  const base = combos?.find((c) => c.id === baseId)

  const slots = useMemo(() => {
    const own = (renders ?? []).filter((r) => r.comboId === tunedId).map((r) => r.slot)
    const list = own.length ? [...new Set(own)] : (session?.slots ?? []).map((_, i) => i)
    return list.sort((a, b) => a - b).slice(0, 12)
  }, [renders, tunedId, session?.slots])

  useArenaKeys((e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && baseId != null) {
      setBefore((b) => !b)
      return true
    }
    return false
  })

  if (!session || !tuned) {
    return (
      <Card className="grid flex-1 place-items-center text-[13px] text-faint">
        확정할 조합을 준비하고 있어요
      </Card>
    )
  }

  const tags = comboString(tuned.pairs)
  const baseWeight = new Map(base?.pairs.map((p) => [p.tag, p.weight]) ?? [])
  const changed = tuned.pairs.filter((p) => {
    const w = baseWeight.get(p.tag)
    return w != null && Math.abs(w - p.weight) > 0.001
  }).length
  const showId = before && baseId != null ? baseId : tuned.id

  const doConfirm = async (): Promise<void> => {
    setBusy(true)
    await confirm()
    setBusy(false)
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <Card className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[16px] font-bold tracking-tight">
            {done ? '확정한 조합이에요' : '12개 장면으로 확인해요'}
          </h2>
          <div className="flex-1" />
          {baseId != null && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-1">
                {(['다듬기 전', '다듬은 뒤'] as const).map((label, i) => {
                  const on = before === (i === 0)
                  return (
                    <button
                      key={label}
                      onClick={() => setBefore(i === 0)}
                      className={cn(
                        'h-7 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
                        on ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <Kbd>Tab</Kbd>
            </div>
          )}
        </div>
        <ConfirmGrid comboId={showId} slots={slots} />
      </Card>

      <Card className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
        {!done && (
          <Button
            variant="ghost"
            className="self-end rounded-xl bg-surface"
            onClick={() => void retune()}
          >
            <Undo2 size={14} />
            마음에 안 들면 다듬기로 돌아가기
          </Button>
        )}
        <div>
          <h3 className="text-[16px] font-bold">다듬은 조합</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            작가 {tuned.pairs.length}명 중 {changed}명의 세기가 바뀌었어요 · 작가는 순서대로
          </p>
        </div>
        <div className="flex flex-col">
          <div className="flex border-b border-line pb-1.5 text-[11.5px] text-faint">
            <span className="flex-1">작가</span>
            <span>전 → 후</span>
          </div>
          {tuned.pairs.map((p, i) => {
            const w0 = baseWeight.get(p.tag)
            const moved = w0 != null && Math.abs(w0 - p.weight) > 0.001
            return (
              <div
                key={p.tag}
                className="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-b-0"
              >
                <span className="w-4 text-[11.5px] font-semibold text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.tag}</span>
                {moved ? (
                  <span className="tabular-nums">
                    <span className="text-faint">{w0?.toFixed(1)}</span>
                    <span className="mx-1.5 text-faint">→</span>
                    <b className="text-accent">{p.weight.toFixed(1)}</b>
                  </span>
                ) : (
                  <span className="tabular-nums">
                    <b>{p.weight.toFixed(1)}</b>
                    <span className="ml-1.5 text-[11.5px] text-faint">그대로</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="rounded-xl bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold">태그</span>
            <span className="text-[11px] text-faint">프롬프트의 작가 자리에 그대로 들어가요</span>
          </div>
          <p className="mt-2 select-text break-all font-mono text-[12px] leading-relaxed">{tags}</p>
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={() => void copyText(tags)}>
              <Copy size={13} />
              태그 복사
            </Button>
          </div>
        </div>
        <div className="flex-1" />
        {!done ? (
          <div className="flex flex-col gap-1.5">
            <Button
              variant="accent"
              size="lg"
              disabled={busy}
              className="h-12 rounded-xl text-[15px]"
              onClick={() => void doConfirm()}
            >
              확정하기
            </Button>
            <p className="text-center text-[11.5px] text-faint">순위에 확정 조합으로 올라가요</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-accent">
              <Check size={15} />
              확정했어요 · 이제 이렇게 써요
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-10 rounded-xl" onClick={() => sendComboToMain(tags)}>
                <LogIn size={14} />
                메인에서 쓰기
              </Button>
              <Button className="h-10 rounded-xl" onClick={() => setReserveOpen(true)}>
                <CalendarPlus size={14} />씬 프리셋에 예약하기
              </Button>
              <Button
                className="h-10 rounded-xl"
                onClick={() => {
                  setNegativeSeed({
                    pairs: tuned.pairs,
                    label: session.name,
                    config: session.config
                  })
                  setView('start')
                }}
              >
                <CircleSlash size={14} />이 조합으로 네거티브 찾기
              </Button>
              <Button className="h-10 rounded-xl" onClick={() => void copyText(tags)}>
                <Copy size={14} />
                태그 복사
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ReserveDialog open={reserveOpen} onOpenChange={setReserveOpen} combo={tags} />
    </div>
  )
}

const ConfirmGrid = memo(function ConfirmGrid({
  comboId,
  slots
}: {
  comboId: number
  slots: number[]
}): React.JSX.Element {
  const ratio = useCellRatio()
  const [ref, box] = useFitBox((ratio * 4) / 3)
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      <div
        className="grid grid-cols-4 grid-rows-3 gap-2.5"
        style={{ width: box.width, height: box.height }}
      >
        {slots.map((slot) => (
          <div key={slot} className="min-h-0 overflow-hidden rounded-xl bg-surface-2">
            <ArenaImage comboId={comboId} slot={slot} compact />
          </div>
        ))}
      </div>
    </div>
  )
})

// ───────────────────────── 씬 프리셋 예약 ─────────────────────────

export function ReserveDialog({
  open,
  onOpenChange,
  combo
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  combo: string
}): React.JSX.Element {
  const presets = useScenesStore((s) => s.presets)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const mainPrompt = useGenerationStore((s) => s.request.prompt)
  const [presetId, setPresetId] = useState<number | null>(null)
  const [per, setPer] = useState(1)
  const [mode, setMode] = useState<'replace' | 'prepend'>('replace')
  const [scenes, setScenes] = useState<{ presetId: number; ids: number[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const pid = presetId ?? activePresetId

  useEffect(() => {
    if (open && useScenesStore.getState().presets.length === 0)
      void useScenesStore.getState().loadPresets(false)
  }, [open])
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.nais.invoke('scenes:list', { presetId: pid }).then(({ items }) => {
      if (alive) setScenes({ presetId: pid, ids: items.map((s) => s.id) })
    })
    return () => {
      alive = false
    }
  }, [open, pid])

  const ids = scenes?.presetId === pid ? scenes.ids : null
  const total = (ids?.length ?? 0) * per
  const hasToken = hasArtistToken(mainPrompt)

  const reserve = async (): Promise<void> => {
    if (!ids || ids.length === 0) return
    setBusy(true)
    try {
      applyComboToMain(combo, mode)
      const sc = useScenesStore.getState()
      await sc.setActivePreset(pid)
      await sc.setReserveAll(per, ids)
      toast(total.toLocaleString() + '장을 예약했어요. 씬 탭에서 생성을 눌러 주세요', 'success')
      onOpenChange(false)
      useLayoutStore.getState().setCenterMode('scene')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] p-6">
        <DialogTitle className="text-[17px] font-bold">씬 프리셋에 예약하기</DialogTitle>
        <DialogDescription className="mt-1 text-[13px]">
          메인 프롬프트에 이 조합을 넣고, 고른 프리셋의 씬마다 예약을 잡아요
        </DialogDescription>
        <div className="mt-5 flex flex-col gap-4 text-[13px]">
          <Row label="씬 프리셋">
            <Select value={String(pid)} onValueChange={(v) => setPresetId(Number(v))}>
              <SelectTrigger className="h-9 w-full rounded-xl">
                <SelectValue placeholder="프리셋 고르기" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="씬마다">
            <Seg
              value={String(per)}
              options={[
                ['1', '1장'],
                ['2', '2장'],
                ['4', '4장']
              ]}
              onChange={(v) => setPer(Number(v))}
            />
          </Row>
          <Row label="작가 자리">
            <div className="flex flex-col gap-1.5">
              <Seg
                value={mode}
                options={[
                  ['replace', '바꾸기'],
                  ['prepend', '앞에 붙이기']
                ]}
                onChange={(v) => setMode(v as 'replace' | 'prepend')}
              />
              <span className="text-[11.5px] text-muted">
                {mode === 'replace'
                  ? hasToken
                    ? '메인 프롬프트의 작가 조합 자리를 이 조합으로 바꿔요'
                    : '작가 조합 자리가 없어서 맨 앞에 붙여요'
                  : '메인 프롬프트 맨 앞에 이 조합을 붙여요'}
              </span>
            </div>
          </Row>
        </div>
        <div className="mt-5 flex items-center justify-between rounded-xl bg-paper px-4 py-3 text-[13px]">
          <span className="text-muted">
            씬 {ids?.length ?? '…'}개 × {per}장
          </span>
          <b className="text-[15px]">{total.toLocaleString()}장</b>
        </div>
        <Button
          variant="accent"
          size="lg"
          disabled={busy || !ids || ids.length === 0}
          className="mt-4 h-12 w-full rounded-xl text-[15px]"
          onClick={() => void reserve()}
        >
          {ids && ids.length === 0
            ? '이 프리셋에는 씬이 없어요'
            : total.toLocaleString() + '장 예약하기'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[72px] shrink-0 pt-2 text-[12.5px] text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function Seg({
  value,
  options,
  onChange,
  className
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-xl bg-paper p-1', className)}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'h-7 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
            value === v ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
