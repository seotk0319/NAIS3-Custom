/**
 * 만화 탭 공용 타입과 칸 계산.
 * 흐름(이야기 → 컷 → 페이지 한 장)은 okawaritsuika의 NAIMangaMaker
 * (https://github.com/okawaritsuika/NAIMangaMaker, 제작자 허락)를 바탕으로 다시 만들었다.
 * 칸은 NAIS3에서 직접 긋는다: 칸 선을 그린 빈 페이지 + 칸 안쪽 마스크로 V5 인페인팅 한 장.
 */

export const MANGA_W = 832
export const MANGA_H = 1216
export const MANGA_MARGIN = 40
export const MANGA_GUTTER = 24
export const MANGA_MAX_PANELS = 6

export type Pt = [number, number]
export type Poly = Pt[]

export type MangaDialogueMode = 'auto' | 'with' | 'none'
export type MangaIntent = 'story' | 'action' | 'dialogue' | 'emphasis'

export interface MangaCastMember {
  id: string
  name: string
  gender: 'girl' | 'boy' | 'auto'
  /** 영어 태그 (쉼표로 구분) — 이미지 프롬프트 기본 외형 */
  appearance: string
  personality: string
}

export interface MangaPanelState {
  appearance: string
  pose: string
  held: string
}

export interface MangaPanel {
  id: string
  /** 화면에 보이는 인물 (cast id) */
  subjects: string[]
  /** 이 컷의 대사 주인 */
  speaker: string | null
  description: string
  descriptionKo: string
  background: string
  dialogueKo: string
  framing: string
  angle: string
  focus: string
  states: Record<string, MangaPanelState>
  importance: 'normal' | 'main'
}

export type MangaPageState = 'draft' | 'queued' | 'done' | 'failed'

export interface MangaPage {
  id: string
  panelIds: string[]
  /** 칸 모양 (MANGA_W×MANGA_H 좌표). 컷 수와 다르면 자동 배치를 쓴다 */
  layout: Poly[] | null
  seed: number
  state: MangaPageState
  /** 칸 밖을 흰 여백으로 정리한 완성 페이지 */
  filePath?: string
  rawPath?: string
  error?: string
}

export interface MangaBrief {
  seed: string
  direction: string
  place: string
  action: string
  stateChange: string
  dialogue: MangaDialogueMode
  targetPages: number
  minCuts: number
  maxCuts: number
  startCuts: number
}

export interface MangaProposal {
  action: 'expand' | 'emphasis' | 'finish' | 'stop'
  count: number
  intent: MangaIntent
  dialogue: MangaDialogueMode
  instruction: string
  reasonKo: string
}

export interface MangaProject {
  id: number
  title: string
  brief: MangaBrief
  cast: MangaCastMember[]
  setting: string
  style: { prompt: string; negative: string }
  panels: MangaPanel[]
  pages: MangaPage[]
  ended: boolean
  proposal: MangaProposal | null
  auto: boolean
  autoRender: boolean
  createdAt: string
  updatedAt: string
}

export interface MangaSummary {
  id: number
  title: string
  pages: number
  targetPages: number
  drawn: number
  ended: boolean
  updatedAt: string
  cover?: string
}

export interface MangaSnapshot {
  project: MangaProject
  /** 글 모델 작업 중이면 안내 문구 */
  busy: string | null
  lastError: string | null
}

export interface MangaCastInput {
  name: string
  gender: 'girl' | 'boy' | 'auto'
  appearance: string
  personality: string
}

// ───────────────────────── 칸 계산 ─────────────────────────

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]]
}

/** 선분 a→b의 법선 방향 거리 (오른손 기준, 길이 1) */
function signedDistance(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a)
  const len = Math.hypot(d[0], d[1]) || 1
  return ((p[0] - a[0]) * -d[1] + (p[1] - a[1]) * d[0]) / len
}

/** 선 a-b에서 한쪽으로 offset 이상 떨어진 부분만 남긴다 (Sutherland–Hodgman 반평면 자르기) */
export function clipHalfPlane(poly: Poly, a: Pt, b: Pt, side: 1 | -1, offset: number): Poly {
  const out: Poly = []
  const f = (p: Pt): number => side * signedDistance(p, a, b) - offset
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const prev = poly[(i + poly.length - 1) % poly.length]
    const fc = f(cur)
    const fp = f(prev)
    if (fc >= 0) {
      if (fp < 0) out.push(lerp(prev, cur, fp / (fp - fc)))
      out.push(cur)
    } else if (fp >= 0) {
      out.push(lerp(prev, cur, fp / (fp - fc)))
    }
  }
  return dedupe(out)
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [round1(a[0] + (b[0] - a[0]) * t), round1(a[1] + (b[1] - a[1]) * t)]
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function dedupe(poly: Poly): Poly {
  const out: Poly = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5) out.push(p)
  }
  if (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.5
  )
    out.pop()
  return out
}

export function polyArea(poly: Poly): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/** 면적 중심 (V5 캐릭터 좌표로 쓴다) */
export function polyCenter(poly: Poly): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const cross = p[0] * q[1] - q[0] * p[1]
    a += cross
    cx += (p[0] + q[0]) * cross
    cy += (p[1] + q[1]) * cross
  }
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function polyBounds(poly: Poly): [number, number, number, number] {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function pointInPoly(p: Pt, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

const MIN_AREA = 90 * 90

/** 칸 하나를 선 a-b로 나눈다 (가운데 gutter만큼 비움). 너무 작은 조각이 생기면 null */
export function splitPoly(poly: Poly, a: Pt, b: Pt, gutter = MANGA_GUTTER): [Poly, Poly] | null {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return null
  const one = clipHalfPlane(poly, a, b, 1, gutter / 2)
  const two = clipHalfPlane(poly, a, b, -1, gutter / 2)
  if (one.length < 3 || two.length < 3) return null
  if (polyArea(one) < MIN_AREA || polyArea(two) < MIN_AREA) return null
  return [one, two]
}

/** 두 칸을 하나로 (볼록 껍질 — 칸 사이 여백까지 메운다) */
export function mergePolys(a: Poly, b: Poly): Poly {
  const pts = [...a, ...b].slice().sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: Pt, p: Pt, q: Pt): number =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/** 읽는 순서: 위 줄부터, 같은 줄이면 왼쪽부터 */
export function readingOrder(polys: Poly[]): Poly[] {
  const info = polys.map((p) => ({ p, c: polyCenter(p), b: polyBounds(p) }))
  info.sort((x, y) => {
    const overlap = Math.min(x.b[3], y.b[3]) - Math.max(x.b[1], y.b[1])
    const minH = Math.min(x.b[3] - x.b[1], y.b[3] - y.b[1])
    if (overlap > minH * 0.5) return x.c[0] - y.c[0]
    return x.c[1] - y.c[1]
  })
  return info.map((i) => i.p)
}

export function pageRect(margin = MANGA_MARGIN): Poly {
  return [
    [margin, margin],
    [MANGA_W - margin, margin],
    [MANGA_W - margin, MANGA_H - margin],
    [margin, MANGA_H - margin]
  ]
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROWS: Record<number, number[]> = {
  1: [1],
  2: [1, 1],
  3: [1, 2],
  4: [1, 2, 1],
  5: [2, 1, 2],
  6: [2, 2, 2]
}

/**
 * 컷 수에 맞는 자동 배치. 줄 경계와 칸 경계를 조금씩 기울여 만화답게 만든다.
 * tilt=0이면 반듯한 칸. emphasis(컷 번호)가 있으면 그 컷이 든 줄을 크게 한다.
 */
export function autoLayout(
  count: number,
  opts: { seed?: number; tilt?: number; emphasis?: number; gutter?: number } = {}
): Poly[] {
  const n = Math.max(1, Math.min(MANGA_MAX_PANELS, Math.round(count)))
  const rand = mulberry(opts.seed ?? 7)
  const tilt = opts.tilt ?? 1
  const gutter = opts.gutter ?? MANGA_GUTTER
  const rows = [...ROWS[n]]
  // 강조 컷은 혼자 한 줄을 쓰게 한다
  if (opts.emphasis != null && n >= 3) {
    let idx = 0
    for (let r = 0; r < rows.length; r++) {
      if (opts.emphasis >= idx && opts.emphasis < idx + rows[r] && rows[r] > 1) {
        rows.splice(r, 1, ...Array.from({ length: rows[r] }, () => 1))
        break
      }
      idx += rows[r]
    }
    while (rows.length > 4) {
      const r = rows.findIndex(
        (v, i) => v === 1 && rows[i + 1] === 1 && !containsEmphasis(rows, i, opts.emphasis)
      )
      if (r < 0) break
      rows.splice(r, 2, 2)
    }
  }
  const weights = rows.map((c, r) => {
    let first = 0
    for (let k = 0; k < r; k++) first += rows[k]
    const hasMain = opts.emphasis != null && opts.emphasis >= first && opts.emphasis < first + c
    return hasMain ? 1.6 : c === 1 ? 1.15 : 1
  })
  const total = weights.reduce((s, w) => s + w, 0)
  const top = MANGA_MARGIN
  const inner = MANGA_H - MANGA_MARGIN * 2
  let rest = pageRect()
  const rowPolys: Poly[] = []
  let acc = 0
  for (let r = 0; r < rows.length - 1; r++) {
    acc += weights[r]
    const y = top + (inner * acc) / total
    const t = tilt * (18 + rand() * 42) * (rand() < 0.5 ? -1 : 1)
    const parts = splitPoly(rest, [0, y - t], [MANGA_W, y + t], gutter)
    if (!parts) break
    const [a, b] = readingOrder(parts)
    rowPolys.push(a)
    rest = b
  }
  rowPolys.push(rest)
  const out: Poly[] = []
  rowPolys.forEach((row, r) => {
    const cells = rows[r] ?? 1
    if (cells === 1) {
      out.push(row)
      return
    }
    const b = polyBounds(row)
    const x = b[0] + (b[2] - b[0]) * (0.38 + rand() * 0.24)
    const t = tilt * (10 + rand() * 38) * (rand() < 0.5 ? -1 : 1)
    const parts = splitPoly(row, [x + t, 0], [x - t, MANGA_H], gutter)
    if (parts) out.push(...readingOrder(parts))
    else out.push(row)
  })
  return out
}

function containsEmphasis(rows: number[], r: number, emphasis?: number): boolean {
  if (emphasis == null) return false
  let first = 0
  for (let k = 0; k < r; k++) first += rows[k]
  return emphasis >= first && emphasis < first + rows[r] + rows[r + 1]
}

/** 저장된 칸이 컷 수와 맞으면 그대로, 아니면 자동 배치 */
export function pageLayout(page: MangaPage, panels: MangaPanel[]): Poly[] {
  const n = page.panelIds.length
  if (page.layout && page.layout.length === n) return page.layout
  const emphasis = page.panelIds.findIndex(
    (id) => panels.find((p) => p.id === id)?.importance === 'main'
  )
  return autoLayout(n, { seed: page.seed, emphasis: emphasis >= 0 ? emphasis : undefined })
}

/**
 * 새 컷을 페이지에 채운다. 마지막 페이지가 아직 안 그렸고 자리가 있으면 거기에,
 * 아니면 새 페이지. 강조 컷(main)은 페이지에 이미 minCuts 이상 있으면 새 페이지에서 시작한다.
 */
export function placePanels(
  pages: MangaPage[],
  panels: MangaPanel[],
  opts: { minCuts: number; maxCuts: number; newId: () => string; newSeed: () => number }
): MangaPage[] {
  const out = pages.map((p) => ({ ...p, panelIds: [...p.panelIds] }))
  for (const panel of panels) {
    const last = out[out.length - 1]
    const open =
      last &&
      last.state === 'draft' &&
      last.panelIds.length < Math.min(opts.maxCuts, MANGA_MAX_PANELS) &&
      !(panel.importance === 'main' && last.panelIds.length >= opts.minCuts)
    if (open) {
      last.panelIds.push(panel.id)
      last.layout = null
    } else {
      out.push({
        id: opts.newId(),
        panelIds: [panel.id],
        layout: null,
        seed: opts.newSeed(),
        state: 'draft'
      })
    }
  }
  return out
}
