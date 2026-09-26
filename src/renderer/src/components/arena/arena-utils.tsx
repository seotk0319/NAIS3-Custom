import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  appendPrompt,
  hasArtistTags,
  hasArtistToken,
  insertArtists,
  replaceArtistTags,
  type ArenaRender
} from '@shared/arena'
import { isV5Model } from '@shared/nai-models'
import { estimateV5Images } from '@shared/v5-usage'
import { cn } from '../../lib/utils'
import { isArenaVisible, useArenaStore } from '../../stores/arena-store'
import { useGenerationStore } from '../../stores/generation-store'
import { useLayoutStore } from '../../stores/layout-store'
import { toast } from '../../stores/toast-store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

/** 그림체 화면이 같이 쓰는 훅과 함수 (컴포넌트 파일과 분리해 Fast Refresh를 지킨다) */

// ───────────────────────── 숫자·문구 ─────────────────────────

export function winRateText(games: number, winRate: number | null): string {
  if (winRate == null) return games + '판'
  const pct = winRate <= 1 ? winRate * 100 : winRate
  return games + '판 · 승률 ' + Math.round(pct) + '%'
}

export function consistencyLabel(c: number | null): string {
  if (c == null) return '판이 적어요'
  if (c < 0.15) return '일관성 높음'
  if (c > 0.3) return '장면 타는 편'
  return '일관성 보통'
}

function parseDate(iso: string): Date {
  // SQLite "YYYY-MM-DD HH:MM:SS"는 UTC로 읽는다
  if (/^\d{4}-\d\d-\d\d \d/.test(iso)) return new Date(iso.replace(' ', 'T') + 'Z')
  return new Date(iso)
}

export function relativeDay(iso: string): string {
  const d = parseDate(iso)
  if (Number.isNaN(d.getTime())) return ''
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(d)) / 86400000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  return d.getMonth() + 1 + '월 ' + d.getDate() + '일'
}

export async function copyText(value: string, message = '태그를 복사했어요'): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast(message, 'success')
  } catch {
    toast('복사하지 못했어요', 'error')
  }
}

export type PlaceMode = 'replace' | 'append'

// ───────────────────────── 작가 이름 ─────────────────────────

/** "artist:" 없이 쓴 작가 태그도 알아보도록 작가 DB·명단 이름을 한 번 받아 둔다 */
let artistSet: Set<string> | null = null
let artistLoad: Promise<void> | null = null

export function loadArtistNames(force = false): Promise<void> {
  if (artistLoad && !force) return artistLoad
  artistLoad = window.nais
    .invoke('arena:artistNames', undefined)
    .then(({ names }) => {
      artistSet = new Set(names)
    })
    .catch(() => {
      artistLoad = null
    })
  return artistLoad
}

export function artistNamesReady(): boolean {
  return artistSet != null
}

/** 작가 이름인지 (목록을 아직 못 받았으면 "artist:" 접두만 본다) */
export const isKnownArtist = (name: string): boolean => artistSet?.has(name) ?? false

/**
 * 조합 넣기 — 작가 조합은 맨 뒤에 온다.
 * {artist} 자리가 있으면 그 자리, replace면 지금 있는 작가 태그를 그 자리에서 바꾸고,
 * 작가 태그가 없거나 append면 맨 뒤에 붙인다.
 */
export function placeCombo(text: string, combo: string, mode: PlaceMode = 'replace'): string {
  if (hasArtistToken(text)) return insertArtists(text, combo)
  if (mode === 'replace') {
    const replaced = replaceArtistTags(text, combo, isKnownArtist)
    if (replaced != null) return replaced
  }
  return appendPrompt(text, combo)
}

const PART_LABEL = { base: '고정', additional: '가변', detail: '디테일' } as const

/**
 * 메인 프롬프트에 조합을 넣는다. 3분할이면 {artist}가 있는 칸 → 작가 태그가 있는 칸(뒤 칸부터)
 * → 디테일 칸 순서로 고른다. 어디에 넣었는지 사람이 읽을 문구를 돌려준다.
 */
export function applyComboToMain(combo: string, mode: PlaceMode = 'replace'): string {
  const g = useGenerationStore.getState()
  const parts = g.request.promptParts
  if (g.promptSplitEnabled && parts) {
    const order = ['detail', 'additional', 'base'] as const
    const key =
      order.find((k) => hasArtistToken(parts[k])) ??
      (mode === 'replace'
        ? order.find((k) => hasArtistTags(parts[k], isKnownArtist))
        : undefined) ??
      'detail'
    const had =
      hasArtistToken(parts[key]) || (mode === 'replace' && hasArtistTags(parts[key], isKnownArtist))
    g.patchPromptParts({ [key]: placeCombo(parts[key], combo, mode) })
    return PART_LABEL[key] + ' 칸' + (had ? '의 작가 태그를 바꿨어요' : ' 맨 뒤에 넣었어요')
  }
  const text = g.request.prompt
  const had = hasArtistToken(text) || (mode === 'replace' && hasArtistTags(text, isKnownArtist))
  g.patchRequest({ prompt: placeCombo(text, combo, mode) })
  return had ? '프롬프트의 작가 태그를 바꿨어요' : '프롬프트 맨 뒤에 넣었어요'
}

/** 조합을 메인 프롬프트에 넣고 메인 탭으로 */
export function sendComboToMain(combo: string): void {
  toast(applyComboToMain(combo), 'success')
  useLayoutStore.getState().setCenterMode('main')
}

/** 네거티브 작가 태그를 메인 네거티브의 {artist} 자리에 넣거나 끝에 붙이고 메인 탭으로 */
export function sendNegativeToMain(tags: string): void {
  const g = useGenerationStore.getState()
  const np = g.request.negativePrompt
  const next = hasArtistToken(np)
    ? insertArtists(np, tags)
    : np.trim()
      ? np.replace(/[\s,]+$/, '') + ', ' + tags
      : tags
  g.patchRequest({ negativePrompt: next })
  toast('메인 네거티브에 넣었어요', 'success')
  useLayoutStore.getState().setCenterMode('main')
}

// ───────────────────────── 이미지 크기 ─────────────────────────

/** 부모 칸 안에 비율을 지키며 가장 크게 들어가는 크기 (reserveH: 아래 이름표처럼 따로 뺄 높이) */
export interface GridFit {
  cols: number
  rows: number
  cellW: number
  cellH: number
}

/** n장을 가로·세로 배치 중 칸이 가장 크게 보이는 모양으로 (세로 그림 4장이면 보통 한 줄) */
export function bestGrid(
  n: number,
  ratio: number,
  W: number,
  H: number,
  gap = 12,
  labelH = 0
): GridFit {
  const shapes: [number, number][] =
    n === 4
      ? [
          [2, 2],
          [4, 1],
          [1, 4]
        ]
      : n === 2
        ? [
            [2, 1],
            [1, 2]
          ]
        : [[Math.max(1, n), 1]]
  let best: GridFit = { cols: shapes[0][0], rows: shapes[0][1], cellW: 0, cellH: 0 }
  for (const [cols, rows] of shapes) {
    const maxW = (W - gap * (cols - 1)) / cols
    const maxH = (H - gap * (rows - 1)) / rows - labelH
    if (maxW <= 0 || maxH <= 0) continue
    let w = maxW
    let h = w / ratio
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    if (w > best.cellW) best = { cols, rows, cellW: Math.floor(w), cellH: Math.floor(h) }
  }
  return best
}

export function gridStyle(g: GridFit, labelH = 0): React.CSSProperties {
  return {
    gridTemplateColumns: 'repeat(' + g.cols + ', ' + g.cellW + 'px)',
    gridTemplateRows: 'repeat(' + g.rows + ', ' + (g.cellH + labelH) + 'px)'
  }
}

/** 부모 칸 크기를 재서 bestGrid로 배치한다 */
/** 세트 격자 모양: 장면 4개까지 한 줄, 6개까지 3열, 그 이상은 4열 */
export function setShape(n: number): { cols: number; rows: number } {
  const count = Math.max(1, n)
  const cols = count <= 4 ? count : count <= 6 ? 3 : 4
  return { cols, rows: Math.ceil(count / cols) }
}

export function useBestGrid(
  n: number,
  ratio: number,
  gap = 12,
  labelH = 0
): [React.RefObject<HTMLDivElement | null>, GridFit] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      const height = Math.floor(entry.contentRect.height)
      setSize((p) => (p.width === width && p.height === height ? p : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, bestGrid(n, ratio, size.width, size.height, gap, labelH)]
}

/** 부모 칸 안에 비율을 지키며 가장 크게 들어가는 크기 (reserveH: 아래 이름표처럼 따로 뺄 높이) */
export function useFitBox(
  ratio: number,
  reserveH = 0
): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !(ratio > 0)) return
    const measure = (width: number, fullHeight: number): void => {
      const height = Math.max(0, fullHeight - reserveH)
      let w = width
      let h = w / ratio
      if (h > height) {
        h = height
        w = h * ratio
      }
      const next = { width: Math.max(0, Math.floor(w)), height: Math.max(0, Math.floor(h)) }
      setBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
    }
    const ro = new ResizeObserver(([entry]) =>
      measure(entry.contentRect.width, entry.contentRect.height)
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio, reserveH])
  return [ref, box]
}

const thumbCache = new WeakMap<ArenaRender[], Map<number, string>>()

/** 조합마다 가장 앞 장면의 완성 이미지 */
export function comboThumbs(renders: ArenaRender[]): Map<number, string> {
  let m = thumbCache.get(renders)
  if (m) return m
  m = new Map()
  const best = new Map<number, number>()
  for (const r of renders) {
    if (r.state !== 'done' || !r.filePath) continue
    const cur = best.get(r.comboId)
    if (cur == null || r.slot < cur) {
      best.set(r.comboId, r.slot)
      m.set(r.comboId, r.filePath)
    }
  }
  thumbCache.set(renders, m)
  return m
}

// ───────────────────────── 조합 ─────────────────────────

export function useCellRatio(): number {
  const w = useArenaStore((s) => s.snapshot?.session.config.params.width ?? 832)
  const h = useArenaStore((s) => s.snapshot?.session.config.params.height ?? 1216)
  return w / h
}

export function useComboText(comboId: number | undefined): string | undefined {
  return useArenaStore((s) =>
    comboId == null ? undefined : s.snapshot?.combos.find((c) => c.id === comboId)?.text
  )
}

// ───────────────────────── 키보드 ─────────────────────────

function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

/** 그림체 탭이 보이고, 입력칸·대화창이 없을 때만 부른다. true를 돌려주면 기본 동작을 막는다 */
export function useArenaKeys(handler: (e: KeyboardEvent) => boolean, active = true): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      if (!isArenaVisible() || typingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      if (ref.current(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

/** 1–9 숫자키 (Shift가 눌려도 읽힌다). Ctrl·Alt·Meta 조합은 앱 단축키라 무시 */
export function digitOf(e: KeyboardEvent): number | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const m = /^(Digit|Numpad)([1-9])$/.exec(e.code)
  return m ? Number(m[2]) : null
}

// ───────────────────────── V5 한도 ─────────────────────────

interface LimitAsk {
  needed: number
  remaining: number
  run: (limit?: number) => void
}

/**
 * 이미지 대량 생성 전에 오늘 남은 V5와 비교한다. 모자라면 고르게 하고, 넉넉하면 바로 실행한다.
 */
export function useLimitGate(): {
  gate: (needed: number, model: string, run: (limit?: number) => void) => void
  dialog: React.JSX.Element
} {
  const [ask, setAsk] = useState<LimitAsk | null>(null)
  const [choice, setChoice] = useState<'today' | 'all'>('today')
  const gate = (needed: number, model: string, run: (limit?: number) => void): void => {
    const usage = useGenerationStore.getState().v5Usage
    if (!usage || !isV5Model(model) || needed <= 0) return run()
    const remaining = estimateV5Images(usage)
    if (needed <= remaining) return run()
    setChoice('today')
    setAsk({ needed, remaining, run })
  }
  const go = (): void => {
    if (!ask) return
    const { run, remaining } = ask
    setAsk(null)
    run(choice === 'today' ? remaining : undefined)
  }
  const dialog = (
    <Dialog open={ask != null} onOpenChange={(open) => !open && setAsk(null)}>
      <DialogContent className="max-w-[440px] p-6">
        <DialogTitle className="text-[17px] font-bold">오늘 남은 V5가 조금 모자라요</DialogTitle>
        <DialogDescription className="mt-1 text-[13px]">
          필요한 이미지 {ask?.needed.toLocaleString()}장 중 오늘은 약{' '}
          {ask?.remaining.toLocaleString()}장까지 뽑을 수 있어요
        </DialogDescription>
        {ask && (
          <div className="mt-4 flex overflow-hidden rounded-xl bg-paper text-[13px]">
            <div className="flex-1 px-4 py-3">
              <div className="text-[12px] text-muted">오늘</div>
              <b className="text-[16px]">{ask.remaining.toLocaleString()}장</b>
            </div>
            <div className="w-px bg-line" />
            <div className="flex-1 px-4 py-3">
              <div className="text-[12px] text-muted">내일</div>
              <b className="text-[16px]">{(ask.needed - ask.remaining).toLocaleString()}장</b>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {(
            [
              [
                'today',
                '오늘 가능한 만큼 하고 내일 이어 하기',
                '권장 · 남은 이미지는 내일 다시 뽑아요'
              ],
              ['all', '전부 뽑기', '한도를 넘는 만큼은 Anlas가 들 수 있어요']
            ] as const
          ).map(([key, title, sub]) => (
            <button
              key={key}
              onClick={() => setChoice(key)}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                choice === key ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'
              )}
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full border-2',
                  choice === key ? 'border-accent' : 'border-line'
                )}
              >
                {choice === key && <span className="size-1.5 rounded-full bg-accent" />}
              </span>
              <span>
                <b className="block text-[13.5px] font-semibold text-ink">{title}</b>
                <span className="text-[12px] text-muted">{sub}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="lg" onClick={() => setAsk(null)}>
            취소
          </Button>
          <Button variant="accent" size="lg" onClick={go}>
            {choice === 'today'
              ? '오늘 ' + (ask?.remaining ?? 0).toLocaleString() + '장 뽑기'
              : '전부 뽑기'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
  return { gate, dialog }
}
