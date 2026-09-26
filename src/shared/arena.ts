/**
 * 그림체 월드컵 — 공용 타입과 순수 알고리즘.
 * 메인(세션·대기열·DB)과 렌더러(화면)가 같은 규칙을 쓴다. Electron·DB 의존이 없어 단위 테스트한다.
 *
 * 원본: NAI 그림체 이상형 월드컵 v3.5 (익명 게시판 공개본). 원본 Elo 대신 판 기록 전체로 배우는
 * 브래들리–테리 모델을 쓰고, 작가의 **순서**도 조합의 일부로 본다 (같은 작가·가중치라도 순서가
 * 다르면 다른 조합이며, 모델은 작가를 앞에 둘 때의 효과를 따로 배운다).
 */

export type ArenaTarget = 'positive' | 'negative'
export type ArenaStage = 'prelim' | 'main' | 'final' | 'tune' | 'order' | 'confirm' | 'done' | 'neg'
export type ArenaBudget = 'light' | 'normal' | 'generous'
export type ArenaComboSource =
  | 'random'
  | 'model'
  | 'breed'
  | 'tune'
  | 'order'
  | 'tuned'
  | 'baseline'
  | 'candidate'
  | 'seed'
  | 'refine'
export type ArenaRenderState = 'missing' | 'queued' | 'done' | 'failed'
export type ArenaTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

/** 조합 안의 작가 하나. tag는 "artist:" 접두 없는 이름 (예: "omutatsu"). 배열 순서 = 프롬프트 순서 */
export interface ArenaPair {
  weight: number
  tag: string
  /** "artist:" 없이 이름만 쓴 태그 (아빠 프롬프트 형식 그대로 다시 쓴다) */
  bare?: boolean
}

/** 작가 이름인지 판단 (작가 DB·작가 명단). 없으면 "artist:" 접두만 본다 */
export type IsArtist = (name: string) => boolean

export interface ArenaGenParams {
  model: string
  width: number
  height: number
  steps: number
  cfgScale: number
  cfgRescale: number
  sampler: string
  noiseSchedule: string
  variety: boolean
  qualityToggle: boolean
  ucPreset: 0 | 1 | 2 | 3 | 4
  transparentBackground?: boolean
}

export interface ArenaSlot {
  scene: string
  seed: number
}

export interface ArenaSessionConfig {
  name: string
  target: ArenaTarget
  /** 긍정 프롬프트. 긍정 세션이면 {artist} 필수 */
  basePrompt: string
  /** 네거티브 프롬프트. 네거티브 세션이면 {artist} 필수 */
  negativePrompt: string
  params: ArenaGenParams
  /** 검증 장면 (1~12개, 기본 3개). 각 장면은 {scene} 자리 또는 프롬프트 끝에 붙는다 */
  scenes: string[]
  minArtists: number
  maxArtists: number
  minWeight: number
  maxWeight: number
  budget: ArenaBudget
  /** 네거티브 세션: 긍정 {artist}에 고정으로 넣을 조합 */
  fixedPositive?: ArenaPair[]
  /** 네거티브 세션: 후보 작가 (없으면 피하고 싶은 목록 전체) */
  negCandidates?: string[]
  /** 네거티브 세션: 후보 작가 가중치 (기본 1.0) */
  negWeight?: number
  /** find = 작가 명단에서 새 조합 찾기, refine = 기존 조합 하나를 미세 조정 */
  mode?: 'find' | 'refine'
  /** 미세 조정할 조합 (순서·가중치 그대로) */
  seedPairs?: ArenaPair[]
  /** 미세 조정 폭: 가중치를 한 번에 최대 얼마나 바꿀지 (0.1 단위) */
  refineStep?: number
  /** 미세 조정 폭: 변형 하나에서 바꾸는 곳 수 최대 */
  refineMoves?: number
}

export interface ArenaTuneState {
  /** 다듬는 원본 조합 (결선 조합) */
  baseComboId: number
  /** 다듬는 작가 순서 (모델 효과가 큰 순) */
  artists: string[]
  /** 작가별로 고른 가중치 */
  chosen: Record<string, number>
  /** 작가별 가중치 후보 조합 id (가중치 오름차순, 지금 값 조합 포함) */
  options: Record<string, number[]>
  /** 순서 단계 후보 조합 */
  orderIds?: number[]
  /** 다듬기·순서에 쓰는 장면 (다시 뽑기로 시드만 바꾼 장면이 뒤에 붙는다) */
  slot?: number
  /** 세기 후보 간격 (0.1~0.5) */
  step?: number
  /** 이미 보여 준 순서 (작가 이름을 | 로 이은 것) — "다른 순서 보기"가 겹치지 않게 */
  orderSeen?: string[]
  /** 다듬기 결과 조합 (확정 검증 세트용) */
  tunedComboId?: number
}

export interface ArenaSessionState {
  mainIds?: number[]
  finalIds?: number[]
  /** 결선 라운드로빈 대진 (조합 id 쌍) */
  finalPairs?: [number, number][]
  tune?: ArenaTuneState
  confirmedComboId?: number
  /** 지금 보여주는 대결. 새로고침해도 그대로 유지된다 */
  currentDuel?: ArenaDuel | null
  /** 네거티브 세션 */
  baselineId?: number
  candidateIds?: number[]
  /** 조각·주석을 한 번 풀어 둔 프롬프트 — 세션 내내 같은 문장으로 비교한다 */
  resolvedPrompt?: string
  resolvedNegative?: string
  /** 바로 전 판의 조합 (같은 넷이 연달아 나오지 않게) */
  lastIds?: number[]
}

export interface ArenaSession {
  id: number
  name: string
  target: ArenaTarget
  stage: ArenaStage
  config: ArenaSessionConfig
  slots: ArenaSlot[]
  state: ArenaSessionState
  createdAt: string
  updatedAt: string
}

export interface ArenaSessionSummary {
  id: number
  name: string
  target: ArenaTarget
  stage: ArenaStage
  stageLabel: string
  comboCount: number
  voteCount: number
  updatedAt: string
  /** 확정 조합 또는 1위 조합의 대표 이미지 */
  thumbPath: string | null
}

export interface ArenaCombo {
  id: number
  sessionId: number
  pairs: ArenaPair[]
  key: string
  source: ArenaComboSource
  parentId: number | null
  generation: number
  stageReached: 'prelim' | 'main' | 'final'
  favorite: boolean
  /** 다듬기 변형·기준처럼 순위에 넣지 않는 조합 */
  hidden: boolean
}

export interface ArenaRender {
  id: number
  comboId: number
  slot: number
  state: ArenaRenderState
  filePath: string | null
}

export type ArenaDuel =
  | { kind: 'quad'; stage: 'prelim' | 'main'; slot: number; comboIds: number[] }
  | { kind: 'set'; a: number; b: number; slots: number[]; index: number; total: number }
  | {
      kind: 'tune'
      artist: string
      slot: number
      current: number
      options: { comboId: number; weight: number }[]
      step: number
      total: number
    }
  | { kind: 'order'; slot: number; options: { comboId: number; order: string[] }[] }
  | { kind: 'neg'; slot: number; baseline: number; candidate: number; index: number; total: number }

export type ArenaVoteResult =
  | { kind: 'quad'; best: number; worst?: number }
  | { kind: 'set'; winner: 'a' | 'b' | 'same' }
  | { kind: 'tune'; chosen: number }
  | { kind: 'order'; chosen: number }
  | { kind: 'neg'; rating: 1 | 0 | -1 }

export interface ArenaVote {
  id: number
  sessionId: number
  duel: ArenaDuel
  result: ArenaVoteResult
  createdAt: string
}

export interface ArenaComboView extends ArenaCombo {
  text: string
  score: number
  se: number
  /** 순위 (숨김 조합 제외, 1부터) */
  rank: number | null
  tier: ArenaTier | null
  games: number
  winRate: number | null
  /** 장면별 승률의 흩어짐. 낮을수록 장면을 덜 탄다 */
  consistency: number | null
  certain: boolean
  /** 네거티브 후보: 평균 평가 (-1..1) */
  negScore?: number | null
  negRated?: number
}

export interface ArenaArtistStat {
  tag: string
  /** 평균 조합 대비 이길 확률 증감 (%p) */
  effect: number | null
  effectSe: number | null
  /** 잘 이기던 가중치 범위 */
  preferredWeight: { value: number; low: number; high: number } | null
  /** 앞에 둘 때 이길 확률 증감 (%p). +면 앞, −면 뒤가 좋다 */
  positionEffect: number | null
  positionHint: 'front' | 'back' | 'any' | null
  appearances: number
}

export interface ArenaProgress {
  stage: ArenaStage
  /** 이번 단계에서 치른 판 */
  stageVotes: number
  /** 이번 단계 목표 판 수 (추정) */
  stageTarget: number
  /** 이번 단계 조합의 최소 등장 횟수 */
  minAppear: number
  /** 다음 단계로 가도 되는 조건을 채웠는지 */
  ready: boolean
  /** 다음 단계 이름과 새로 필요한 이미지 수 */
  next: { stage: ArenaStage; newRenders: number } | null
  renders: { done: number; queued: number; missing: number; failed: number }
}

export interface ArenaWait {
  /** 첫 대결에 필요한 장수 중 모인 장수 */
  ready: number
  needed: number
  queued: number
  missing: number
  failed: number
}

export interface ArenaSnapshot {
  session: ArenaSession
  combos: ArenaComboView[]
  renders: ArenaRender[]
  progress: ArenaProgress
  duel: ArenaDuel | null
  wait: ArenaWait | null
  voteCount: number
  canUndo: boolean
  artistStats: ArenaArtistStat[]
  /** 본선 탈락선 바로 아래 5개 (패자부활 후보) */
  reviveIds: number[]
}

export interface ArenaArtist {
  tag: string
  list: 'liked' | 'avoided'
  fixedWeight: number | null
  createdAt: string
}

export interface ArenaArtistParseItem {
  name: string
  status: 'new' | 'exists' | 'notArtist'
}

export interface ArenaEnqueueResult {
  queued: number
  missing: number
  blockedReason?: 'no-account' | 'pending' | 'busy'
}

// ───────────────────────── 상수 ─────────────────────────

/** 한 세션에 쓸 수 있는 장면 수 상한 */
export const ARENA_SLOT_COUNT = 12
/** 본선 공통 장면 (1·3·6·9번) */
export const MAIN_SLOTS = [0, 2, 5, 8]
/** 다듬기에 번갈아 쓰는 장면 */
export const TUNE_SLOTS = [1, 4]
/** 네거티브 세션 장면 */
export const NEG_SLOTS = [0, 5]
export const MAIN_SIZE = 30
export const FINAL_SIZE = 8
export const REVIVE_COUNT = 5
export const PRELIM_MIN_APPEAR = 3
export const MAIN_MIN_APPEAR = 3
export const WEIGHT_FLOOR = 0.3
export const WEIGHT_CEIL = 2.5

export const BUDGETS: Record<ArenaBudget, { label: string; prelim: number; total: number }> = {
  light: { label: '가볍게', prelim: 120, total: 300 },
  normal: { label: '보통', prelim: 200, total: 550 },
  generous: { label: '넉넉히', prelim: 320, total: 900 }
}

export const STAGE_LABELS: Record<ArenaStage, string> = {
  prelim: '예선',
  main: '본선',
  final: '결선',
  tune: '다듬기',
  order: '순서',
  confirm: '확정',
  done: '확정됨',
  neg: '네거티브'
}

/** 기본 검증 장면 3개 — 거리만 다르게 (그림체는 이 셋이면 충분히 드러난다) */
export const DEFAULT_SCENES: string[] = ['cowboy shot', 'upper body', 'full body']

/** 장면을 더할 때 차례로 제안하는 장면 */
export const EXTRA_SCENES: string[] = [
  'portrait, close-up',
  'sitting, indoors',
  'from side, sunset',
  'night, city lights',
  'dynamic pose',
  'lying on bed, from above',
  'rain, umbrella',
  'forest, dappled sunlight',
  'looking back, from behind'
]

export interface SlotLayout {
  /** 모든 장면 (결선 세트·확정 검증) */
  all: number[]
  /** 본선 공통 장면 (최대 4개) */
  main: number[]
  /** 다듬기·순서에 번갈아 쓰는 장면 */
  tune: number[]
  /** 네거티브 세션 장면 */
  neg: number[]
}

/** 세션의 장면 수에 맞춘 장면 배치. 12개일 때는 예전 고정값과 같다 */
export function slotLayout(n: number): SlotLayout {
  const count = Math.max(1, Math.min(ARENA_SLOT_COUNT, Math.round(n)))
  const all = [...Array(count).keys()]
  if (count >= 12) return { all, main: MAIN_SLOTS, tune: TUNE_SLOTS, neg: NEG_SLOTS }
  // 본선: 장면을 고르게 최대 4개
  const m = Math.min(4, count)
  const main = [...new Set(Array.from({ length: m }, (_, i) => Math.floor((i * count) / m)))]
  const two = count >= 2 ? [0, 1] : [0]
  return { all, main, tune: two, neg: two }
}

/** 세션의 원래 장면 수 (다시 뽑기로 붙은 장면은 세지 않는다) */
export function sceneCountOf(session: { config: { scenes?: string[] }; slots: unknown[] }): number {
  return Math.min(session.slots.length, session.config.scenes?.length || session.slots.length)
}

export const TUNE_STEPS = [0.1, 0.2, 0.3, 0.5] as const

export function orderKey(pairs: ArenaPair[]): string {
  return pairs.map((p) => p.tag).join('|')
}

/**
 * "다른 순서 보기": 아직 안 본 새 순서 count개. 먼저 한 명만 한두 칸 옮긴 순서에서 고르고,
 * 다 봤으면 두 명을 옮긴 순서로 넘어간다.
 */
export function moreOrders(
  current: ArenaPair[],
  seen: Set<string>,
  rng: Rng,
  count = 3
): ArenaPair[][] {
  const n = current.length
  if (n < 2) return []
  const moved = (src: ArenaPair[], from: number, to: number): ArenaPair[] => {
    const v = [...src]
    const [x] = v.splice(from, 1)
    v.splice(to, 0, x)
    return v
  }
  const singles: ArenaPair[][] = []
  for (let i = 0; i < n; i++)
    for (const d of [-2, -1, 1, 2]) {
      const to = i + d
      if (to >= 0 && to < n) singles.push(moved(current, i, to))
    }
  const out: ArenaPair[][] = []
  const taken = new Set(seen)
  taken.add(orderKey(current))
  for (const v of shuffle(singles, rng)) {
    if (out.length >= count) break
    if (taken.has(orderKey(v))) continue
    taken.add(orderKey(v))
    out.push(v)
  }
  for (let tries = 0; out.length < count && tries < 200; tries++) {
    const a = Math.floor(rng() * n)
    const b = Math.floor(rng() * n)
    const c = Math.floor(rng() * n)
    const e = Math.floor(rng() * n)
    const v = moved(moved(current, a, b), c, e)
    if (taken.has(orderKey(v))) continue
    taken.add(orderKey(v))
    out.push(v)
  }
  return out
}

/** 세션 전체에 드는 대략의 장수: 예선 + 본선 새 장면 + 결선 새 장면 + 다듬기 18 + 확정 검증 */
export function estimateTotal(budget: ArenaBudget, scenes: number): number {
  const n = Math.max(1, Math.min(ARENA_SLOT_COUNT, scenes))
  const m = slotLayout(n).main.length
  const main = MAIN_SIZE * (m - m / n)
  const final = FINAL_SIZE * (n - m)
  return Math.round((BUDGETS[budget].prelim + main + final + 18 + n) / 10) * 10
}

/** 미세 조정 세션의 변형 수 (원래 조합 포함) */
export const REFINE_COUNT: Record<ArenaBudget, number> = { light: 16, normal: 28, generous: 44 }

export type RefineSize = 'small' | 'normal' | 'large'

/** 미세 조정 폭 */
export const REFINE_STEPS: Record<
  RefineSize,
  { step: number; moves: number; label: string; desc: string }
> = {
  small: { step: 0.2, moves: 1, label: '조금', desc: '가중치 ±0.2 · 한 곳만' },
  normal: { step: 0.3, moves: 2, label: '보통', desc: '가중치 ±0.3 · 한두 곳' },
  large: { step: 0.5, moves: 3, label: '크게', desc: '가중치 ±0.5 · 세 곳까지' }
}

/** 미세 조정: 변형마다 본선 장면에 한 장씩 + 결선에 모자란 장면 + 다듬기 18 + 확정 검증 */
export function estimateRefine(
  budget: ArenaBudget,
  scenes: number
): { first: number; total: number } {
  const n = Math.max(1, Math.min(ARENA_SLOT_COUNT, scenes))
  const m = slotLayout(n).main.length
  const first = REFINE_COUNT[budget] * m
  return { first, total: first + FINAL_SIZE * (n - m) + 18 + n }
}

// ───────────────────────── 프롬프트 ─────────────────────────

/** 가중치 저장·비교용 — 0.01 단위 (0.65 같은 값을 그대로 지킨다) */
export function roundWeight(w: number): number {
  return Math.round(w * 100) / 100
}

/** 새로 만드는 조합의 가중치 — 0.1 단위 */
export function round1(w: number): number {
  return Math.round(w * 10) / 10
}

/** 1.2 → "1.2", 0.65 → "0.65", 1 → "1.0" */
export function formatWeight(w: number): string {
  const r = roundWeight(w)
  return Math.abs(r * 10 - Math.round(r * 10)) < 1e-6 ? r.toFixed(1) : r.toFixed(2)
}

export function clampWeight(w: number, min = WEIGHT_FLOOR, max = WEIGHT_CEIL): number {
  return roundWeight(Math.min(max, Math.max(min, w)))
}

/** 작가 하나를 NAI 가중치 문법으로. 1.0이면 가중치 없이 쓴다 (원본 v3.5 수정사항) */
export function pairString(p: ArenaPair): string {
  const tag = p.bare ? p.tag : 'artist:' + p.tag
  const w = roundWeight(p.weight)
  if (w === 1) return tag
  // 숫자로 끝나는 태그는 "::" 앞에 공백 — 가중치 숫자와 붙어 읽히지 않게 (원본 규칙)
  const space = /\d$/.test(tag) ? ' ' : ''
  return formatWeight(w) + '::' + tag + space + '::'
}

export function comboString(pairs: ArenaPair[]): string {
  return pairs.map(pairString).join(', ')
}

/** 순서까지 포함한 조합 식별자 — 순서가 다르면 다른 조합 */
export function comboKey(pairs: ArenaPair[]): string {
  return pairs.map((p) => p.tag + '@' + formatWeight(p.weight)).join('|')
}

export const ARTIST_TOKEN = '{artist}'
export const SCENE_TOKEN = '{scene}'

export function hasArtistToken(text: string): boolean {
  return text.includes(ARTIST_TOKEN)
}

/** 빈 치환 뒤 남는 ", ," 같은 구분자를 정리 */
function tidyCommas(text: string): string {
  return text
    .replace(/,(\s*,)+/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/,\s*$/, '')
}

/** 정확히 "{artist}" 글자만 바꾼다 (다른 {…} 강조는 그대로) */
export function insertArtists(prompt: string, combo: string): string {
  if (!prompt.includes(ARTIST_TOKEN)) return prompt
  const out = prompt.split(ARTIST_TOKEN).join(combo)
  return combo ? out : tidyCommas(out)
}

export function insertScene(prompt: string, scene: string): string {
  if (prompt.includes(SCENE_TOKEN)) return tidyCommas(prompt.split(SCENE_TOKEN).join(scene))
  if (!scene.trim()) return prompt
  const trimmed = prompt.replace(/[\s,]+$/, '')
  return trimmed ? trimmed + ', ' + scene : scene
}

/** 맨 앞에 {artist} 넣기 */
export function prependArtistToken(prompt: string): string {
  if (hasArtistToken(prompt)) return prompt
  return prompt.trim() ? ARTIST_TOKEN + ',\n' + prompt : ARTIST_TOKEN
}

/** 쉼표 조각 하나에서 가중치 문법·괄호를 벗긴 이름 ("0.65::wagashi (dagashiya) ::" → "wagashi (dagashiya)") */
function chunkName(chunk: string): { name: string; prefixed: boolean } {
  let t = chunk.trim()
  t = t.replace(/^-?\d+(?:\.\d+)?::/, '').replace(/::\s*$/, '')
  t = t.replace(/^[{[]+|[}\]]+$/g, '').trim()
  const m = /^artist\s*:\s*(.+)$/i.exec(t)
  const name = (m ? m[1] : t).trim().toLowerCase().replace(/_/g, ' ')
  return { name, prefixed: !!m }
}

/** 쉼표 조각 하나가 작가 태그인지 — "artist:" 접두가 있거나, 이름이 작가 목록에 있으면 */
function isArtistChunk(chunk: string, isArtist?: IsArtist): boolean {
  if (!chunk.trim()) return false
  const { name, prefixed } = chunkName(chunk)
  if (!name) return false
  return prefixed || (!!isArtist && isArtist(name))
}

export function hasArtistTags(text: string, isArtist?: IsArtist): boolean {
  return text
    .split('\n')
    .some(
      (l) => !l.trimStart().startsWith('#') && l.split(',').some((c) => isArtistChunk(c, isArtist))
    )
}

/**
 * 프롬프트 안의 작가 태그를 모두 빼고, 첫 작가 태그가 있던 자리에 replacement를 넣는다.
 * 작가 태그가 없으면 null. 주석 줄은 건드리지 않는다.
 */
export function replaceArtistTags(
  text: string,
  replacement: string,
  isArtist?: IsArtist
): string | null {
  let placed = false
  let found = false
  const lines = text.split('\n').map((line) => {
    if (line.trimStart().startsWith('#')) return line
    const chunks = line.split(',')
    if (!chunks.some((c) => isArtistChunk(c, isArtist))) return line
    found = true
    const out: string[] = []
    for (const c of chunks) {
      if (isArtistChunk(c, isArtist)) {
        if (!placed && replacement) out.push(replacement)
        placed = true
      } else if (c.trim()) out.push(c.trim())
    }
    const trailing = /,\s*$/.test(line) && out.length ? ',' : ''
    return out.join(', ') + trailing
  })
  return found ? lines.join('\n') : null
}

/** 프롬프트 맨 뒤에 붙인다 */
export function appendPrompt(text: string, tail: string): string {
  const t = text.replace(/[\s,]+$/, '')
  return t ? t + ', ' + tail : tail
}

/**
 * 세션 프롬프트에 작가 자리 만들기 — 작가 조합이 맨 뒤에 오게 한다.
 * 이미 작가 태그가 있으면 그 자리를, 없으면 끝을 쓴다. 장면 자리가 없으면 작가 앞에 {scene}을 둔다.
 */
export function makeArtistSlot(prompt: string, isArtist?: IsArtist): string {
  if (hasArtistToken(prompt)) return prompt
  const tail = prompt.includes(SCENE_TOKEN) ? ARTIST_TOKEN : SCENE_TOKEN + ', ' + ARTIST_TOKEN
  return replaceArtistTags(prompt, tail, isArtist) ?? appendPrompt(prompt, tail)
}

/**
 * "1.2::artist:a::, artist:b, 0.9::artist:c, artist:d::" → 순서·가중치 그대로 작가만 뽑는다.
 * 가중치 묶음(w::…::)이 여러 태그에 걸쳐도 따라가고, {…}/[…]는 1.05배씩 반영한다.
 */
export function parseComboString(text: string, isArtist?: IsArtist): ArenaPair[] {
  const out: ArenaPair[] = []
  const seen = new Set<string>()
  let groupWeight: number | null = null
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue
    for (const raw of line.split(',')) {
      let t = raw.trim()
      if (!t) continue
      let w = groupWeight ?? 1
      const open = /^(-?\d+(?:\.\d+)?)::/.exec(t)
      if (open) {
        w = Number(open[1])
        t = t.slice(open[0].length)
        groupWeight = w
      }
      let closes = false
      if (/::\s*$/.test(t)) {
        t = t.replace(/::\s*$/, '')
        closes = true
      }
      const braces = (t.match(/\{/g) ?? []).length - (t.match(/\[/g) ?? []).length
      t = t.replace(/[{}[\]]/g, '').trim()
      const m = /^artist\s*:\s*(.+)$/i.exec(t)
      const tag = (m ? m[1] : t).trim().toLowerCase().replace(/_/g, ' ')
      if (tag && (m || isArtist?.(tag)) && !seen.has(tag)) {
        seen.add(tag)
        const pair: ArenaPair = { tag, weight: roundWeight(w * Math.pow(1.05, braces)) }
        if (!m) pair.bare = true
        out.push(pair)
      }
      if (closes) groupWeight = null
    }
  }
  return out
}

/**
 * 미세 조정 변형: 원래 조합 + (한두 곳을 바꾼) 이웃 조합들.
 * 바꾸는 방법 = 옆 작가와 자리 바꾸기(가끔 두 칸) 또는 가중치 ±0.1~step. 작가는 넣거나 빼지 않는다.
 */
export function neighborCombos(
  seed: ArenaPair[],
  count: number,
  opts: { minWeight: number; maxWeight: number; step: number; moves: number; fixed?: Set<string> },
  rng: Rng,
  existingKeys: Set<string> = new Set()
): { pairs: ArenaPair[]; source: ArenaComboSource }[] {
  const keys = new Set(existingKeys)
  const out: { pairs: ArenaPair[]; source: ArenaComboSource }[] = []
  const seedKey = comboKey(seed)
  if (!keys.has(seedKey)) {
    keys.add(seedKey)
    out.push({ pairs: seed.map((p) => ({ ...p })), source: 'seed' })
  }
  const tunable = seed.filter((p) => !opts.fixed?.has(p.tag)).map((p) => p.tag)
  const maxSteps = Math.max(1, Math.round(opts.step * 10))
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const v = seed.map((p) => ({ ...p }))
    const moves = 1 + Math.floor(rng() * Math.max(1, opts.moves))
    for (let m = 0; m < moves; m++) {
      if (v.length >= 2 && (tunable.length === 0 || rng() < 0.4)) {
        const i = Math.floor(rng() * (v.length - 1))
        const to = v.length >= 3 && rng() < 0.25 ? Math.min(v.length - 1, i + 2) : i + 1
        const [moved] = v.splice(i, 1)
        v.splice(to, 0, moved)
      } else if (tunable.length) {
        const tag = tunable[Math.floor(rng() * tunable.length)]
        const p = v.find((x) => x.tag === tag)!
        const d = ((1 + Math.floor(rng() * maxSteps)) / 10) * (rng() < 0.5 ? -1 : 1)
        p.weight = clampWeight(p.weight + d, opts.minWeight, opts.maxWeight)
      }
    }
    const key = comboKey(v)
    if (keys.has(key)) continue
    keys.add(key)
    out.push({ pairs: v, source: 'refine' })
  }
  return out
}

/**
 * 긴 프롬프트를 통째로 붙여 넣어도 작가 후보만 뽑는다.
 * "1.2::artist:a::", "{artist:b}", "c" 모두 이름만 남긴다. hadPrefix=false 이름은 작가 DB로 한 번 더 거른다.
 */
export function parseArtistInput(raw: string): { name: string; hadPrefix: boolean }[] {
  const out: { name: string; hadPrefix: boolean }[] = []
  const seen = new Set<string>()
  for (const line of raw.split('\n')) {
    if (line.trimStart().startsWith('#')) continue
    for (const chunk of line.split(',')) {
      let t = chunk.trim()
      // 가중치 문법: "-1.2::tag::" / "tag::" 조각
      t = t.replace(/^-?\d+(\.\d+)?::/, '').replace(/::$/, '')
      t = t.replace(/::/g, ' ')
      t = t
        .replace(/[{}[\]()]/g, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      t = t.replace(/^-?\d+(\.\d+)?\s*:\s*/, '') // "1.2:tag" 같은 옛 문법
      if (!t) continue
      let hadPrefix = false
      const m = /^artist\s*:\s*(.+)$/i.exec(t)
      if (m) {
        t = m[1].trim()
        hadPrefix = true
      }
      t = t.toLowerCase()
      if (!t || /^[\d.\s-]+$/.test(t)) continue
      if (seen.has(t)) continue
      seen.add(t)
      out.push({ name: t, hadPrefix })
    }
  }
  return out
}

// ───────────────────────── 난수 ─────────────────────────

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function randInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1))
}

// ───────────────────────── 조합 만들기 ─────────────────────────

export interface ComboShape {
  minArtists: number
  maxArtists: number
  minWeight: number
  maxWeight: number
}

export interface PoolArtist {
  tag: string
  fixedWeight: number | null
}

function pickWeight(a: PoolArtist, shape: ComboShape, rng: Rng): number {
  if (a.fixedWeight != null) return roundWeight(a.fixedWeight)
  return round1(shape.minWeight + rng() * (shape.maxWeight - shape.minWeight))
}

/** 원본 규칙: 작가 수 균등, 작가 균등 표본, 가중치 균등 분포. 순서는 무작위 */
export function randomCombo(pool: PoolArtist[], shape: ComboShape, rng: Rng): ArenaPair[] {
  const max = Math.min(shape.maxArtists, pool.length)
  const min = Math.min(shape.minArtists, max)
  const k = randInt(min, max, rng)
  return shuffle(pool, rng)
    .slice(0, k)
    .map((a) => ({ tag: a.tag, weight: pickWeight(a, shape, rng) }))
}

export function jaccard(a: ArenaPair[], b: ArenaPair[]): number {
  const sa = new Set(a.map((p) => p.tag))
  const sb = new Set(b.map((p) => p.tag))
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 1 : inter / union
}

/**
 * 교배: 작가는 두 부모의 합집합에서, 가중치는 물려받고(둘 다면 평균) 살짝 흔든다.
 * 순서도 물려받는다 — 각 작가의 부모 안 상대 위치(0=맨 앞)를 평균해 정렬한다.
 */
export function breedCombo(
  a: ArenaPair[],
  b: ArenaPair[],
  pool: PoolArtist[],
  shape: ComboShape,
  rng: Rng,
  opts: { sigma: number; mutateTo?: string }
): ArenaPair[] {
  const rel = (pairs: ArenaPair[], i: number): number =>
    pairs.length > 1 ? i / (pairs.length - 1) : 0
  const info = new Map<string, { weights: number[]; positions: number[] }>()
  const add = (pairs: ArenaPair[]): void =>
    pairs.forEach((p, i) => {
      const cur = info.get(p.tag) ?? { weights: [], positions: [] }
      cur.weights.push(p.weight)
      cur.positions.push(rel(pairs, i))
      info.set(p.tag, cur)
    })
  add(a)
  add(b)
  const shared = [...info.entries()].filter(([, v]) => v.weights.length > 1).map(([t]) => t)
  const single = shuffle(
    [...info.entries()].filter(([, v]) => v.weights.length === 1).map(([t]) => t),
    rng
  )
  const max = Math.min(shape.maxArtists, info.size)
  const min = Math.min(shape.minArtists, max)
  const target = randInt(Math.max(min, Math.min(shared.length, max)), max, rng)
  const tags = [...shared, ...single].slice(0, target)
  if (opts.mutateTo && !tags.includes(opts.mutateTo) && tags.length > 0) {
    tags[Math.floor(rng() * tags.length)] = opts.mutateTo
  }
  const fixed = new Map(pool.map((p) => [p.tag, p.fixedWeight]))
  const placed = tags.map((tag) => {
    const v = info.get(tag)
    const f = fixed.get(tag)
    const base = v ? v.weights.reduce((s, w) => s + w, 0) / v.weights.length : 1
    const weight =
      f != null
        ? roundWeight(f)
        : round1(clampWeight(base + gaussian(rng) * opts.sigma, shape.minWeight, shape.maxWeight))
    const pos = v ? v.positions.reduce((s, x) => s + x, 0) / v.positions.length : rng()
    return { tag, weight, pos: pos + gaussian(rng) * 0.08 }
  })
  return placed.sort((x, y) => x.pos - y.pos).map(({ tag, weight }) => ({ tag, weight }))
}

// ───────────────────────── 비교쌍 ─────────────────────────

/** 모델 학습용 비교 한 건. draw면 양쪽 0.5 */
export interface Comparison {
  winner: number
  loser: number
  weight: number
  draw?: boolean
  slot: number
}

export function voteComparisons(vote: Pick<ArenaVote, 'duel' | 'result'>): Comparison[] {
  const { duel, result } = vote
  const out: Comparison[] = []
  if (duel.kind === 'quad' && result.kind === 'quad') {
    for (const id of duel.comboIds) {
      if (id !== result.best)
        out.push({ winner: result.best, loser: id, weight: 1, slot: duel.slot })
    }
    if (result.worst != null && result.worst !== result.best) {
      for (const id of duel.comboIds) {
        if (id !== result.best && id !== result.worst)
          out.push({ winner: id, loser: result.worst, weight: 1, slot: duel.slot })
      }
    }
  } else if (duel.kind === 'set' && result.kind === 'set') {
    // 세트 한 판은 12장면 인상이라 정보가 많다 → 가중치 2
    if (result.winner === 'same') {
      out.push({ winner: duel.a, loser: duel.b, weight: 2, draw: true, slot: -1 })
    } else {
      const [w, l] = result.winner === 'a' ? [duel.a, duel.b] : [duel.b, duel.a]
      out.push({ winner: w, loser: l, weight: 2, slot: -1 })
    }
  } else if (
    (duel.kind === 'tune' || duel.kind === 'order') &&
    (result.kind === 'tune' || result.kind === 'order')
  ) {
    for (const o of duel.options) {
      if (o.comboId !== result.chosen)
        out.push({ winner: result.chosen, loser: o.comboId, weight: 1, slot: duel.slot })
    }
  }
  return out
}

// ───────────────────────── 취향 모델 (브래들리–테리) ─────────────────────────

/**
 * u(x) = Σ_작가 [θp + θw·(w−1) + θw2·(w−1)² + θq·front] + r_x
 *   front = 1 − 상대위치 (맨 앞 1, 맨 뒤 0, 혼자면 1) — 작가 순서의 효과
 * P(a가 b를 이김) = σ(u(a) − u(b)). L2 정규화 로지스틱 회귀를 좌표 뉴턴으로 푼다.
 * 불확실성은 대각 헤세 근사 (라플라스).
 */
export type Theta = [number, number, number, number]

export interface ArenaModel {
  theta: Map<string, Theta>
  thetaVar: Map<string, Theta>
  residual: Map<number, number>
  residualVar: Map<number, number>
  comparisons: number
}

const LAMBDA: Theta = [1, 2, 4, 2]
const LAMBDA_RESIDUAL = 2

export function comboFeatures(pairs: ArenaPair[]): { tag: string; x: Theta }[] {
  const n = pairs.length
  return pairs.map((p, i) => {
    const dw = p.weight - 1
    const front = n > 1 ? 1 - i / (n - 1) : 1
    return { tag: p.tag, x: [1, dw, dw * dw, front] }
  })
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

export function emptyModel(): ArenaModel {
  return {
    theta: new Map(),
    thetaVar: new Map(),
    residual: new Map(),
    residualVar: new Map(),
    comparisons: 0
  }
}

export function fitModel(
  combos: Map<number, ArenaPair[]>,
  comparisons: Comparison[],
  sweeps = 30
): ArenaModel {
  const paramIndex = new Map<string, number>()
  const lambdas: number[] = []
  const idx = (key: string, lambda: number): number => {
    let i = paramIndex.get(key)
    if (i === undefined) {
      i = lambdas.length
      paramIndex.set(key, i)
      lambdas.push(lambda)
    }
    return i
  }
  const featCache = new Map<number, { i: number; v: number }[]>()
  const feats = (comboId: number): { i: number; v: number }[] => {
    let f = featCache.get(comboId)
    if (f) return f
    f = []
    for (const { tag, x } of comboFeatures(combos.get(comboId) ?? [])) {
      for (let k = 0; k < 4; k++)
        if (x[k] !== 0) f.push({ i: idx(tag + '#' + k, LAMBDA[k]), v: x[k] })
    }
    f.push({ i: idx('r#' + comboId, LAMBDA_RESIDUAL), v: 1 })
    featCache.set(comboId, f)
    return f
  }
  const rows: { cols: Map<number, number>; y: number; w: number }[] = []
  for (const c of comparisons) {
    if (!combos.has(c.winner) || !combos.has(c.loser)) continue
    const m = new Map<number, number>()
    for (const { i, v } of feats(c.winner)) m.set(i, (m.get(i) ?? 0) + v)
    for (const { i, v } of feats(c.loser)) m.set(i, (m.get(i) ?? 0) - v)
    for (const [i, v] of m) if (Math.abs(v) < 1e-12) m.delete(i)
    rows.push({ cols: m, y: c.draw ? 0.5 : 1, w: c.weight })
  }
  for (const id of combos.keys()) feats(id)
  const P = lambdas.length
  const theta = new Float64Array(P)
  const colRows: number[][] = Array.from({ length: P }, () => [])
  rows.forEach((r, ri) => r.cols.forEach((_, i) => colRows[i].push(ri)))
  const margin = new Float64Array(rows.length)
  const hess = Float64Array.from(lambdas)
  for (let s = 0; s < sweeps; s++) {
    let maxStep = 0
    for (let j = 0; j < P; j++) {
      let g = -lambdas[j] * theta[j]
      let h = lambdas[j]
      for (const ri of colRows[j]) {
        const r = rows[ri]
        const x = r.cols.get(j)!
        const p = sigmoid(margin[ri])
        g += r.w * x * (r.y - p)
        h += r.w * x * x * p * (1 - p)
      }
      hess[j] = h
      const step = g / h
      if (step === 0) continue
      theta[j] += step
      maxStep = Math.max(maxStep, Math.abs(step))
      for (const ri of colRows[j]) margin[ri] += rows[ri].cols.get(j)! * step
    }
    if (maxStep < 1e-4) break
  }
  const out = emptyModel()
  out.comparisons = rows.length
  for (const [key, i] of paramIndex) {
    const cut = key.lastIndexOf('#')
    const name = key.slice(0, cut)
    const k = Number(key.slice(cut + 1))
    if (name === 'r') {
      out.residual.set(k, theta[i])
      out.residualVar.set(k, 1 / hess[i])
      continue
    }
    const t = out.theta.get(name) ?? [0, 0, 0, 0]
    const v = out.thetaVar.get(name) ?? (LAMBDA.map((l) => 1 / l) as Theta)
    t[k] = theta[i]
    v[k] = 1 / hess[i]
    out.theta.set(name, t)
    out.thetaVar.set(name, v)
  }
  return out
}

/** 작가 부분만의 효용 (새 조합 평가용) */
export function artistUtility(pairs: ArenaPair[], theta: Map<string, Theta>): number {
  let u = 0
  for (const { tag, x } of comboFeatures(pairs)) {
    const t = theta.get(tag)
    if (!t) continue
    u += t[0] * x[0] + t[1] * x[1] + t[2] * x[2] + t[3] * x[3]
  }
  return u
}

export function comboScore(
  model: ArenaModel,
  id: number,
  pairs: ArenaPair[]
): { score: number; se: number } {
  let v = model.residualVar.get(id) ?? 1 / LAMBDA_RESIDUAL
  for (const { tag, x } of comboFeatures(pairs)) {
    const tv = model.thetaVar.get(tag)
    if (!tv) continue
    for (let k = 0; k < 4; k++) v += x[k] * x[k] * tv[k]
  }
  return {
    score: artistUtility(pairs, model.theta) + (model.residual.get(id) ?? 0),
    se: Math.sqrt(v)
  }
}

/** 사후분포에서 θ를 한 번 뽑는다 (톰슨 샘플링) */
export function sampleTheta(model: ArenaModel, rng: Rng): Map<string, Theta> {
  const out = new Map<string, Theta>()
  for (const [tag, t] of model.theta) {
    const v = model.thetaVar.get(tag)!
    out.set(tag, [0, 1, 2, 3].map((k) => t[k] + gaussian(rng) * Math.sqrt(v[k])) as Theta)
  }
  return out
}

export function artistStats(
  model: ArenaModel,
  combos: Map<number, ArenaPair[]>,
  tags: string[],
  shape: Pick<ComboShape, 'minWeight' | 'maxWeight'>
): ArenaArtistStat[] {
  const appear = new Map<string, number>()
  for (const pairs of combos.values())
    for (const p of pairs) appear.set(p.tag, (appear.get(p.tag) ?? 0) + 1)
  const pct = (z: number): number => Math.round((sigmoid(z) - 0.5) * 1000) / 10
  return tags.map((tag) => {
    const t = model.theta.get(tag)
    const v = model.thetaVar.get(tag)
    const n = appear.get(tag) ?? 0
    if (!t || !v || model.comparisons < 8 || n < 2) {
      return {
        tag,
        effect: null,
        effectSe: null,
        preferredWeight: null,
        positionEffect: null,
        positionHint: null,
        appearances: n
      }
    }
    // 가중치 1.0, 가운데 자리일 때 평균 조합 대비 이길 확률 증감
    const z = t[0] + t[3] * 0.5
    const zSe = Math.sqrt(v[0] + 0.25 * v[3])
    const effectSe = Math.round(sigmoid(z) * (1 - sigmoid(z)) * zSe * 1000) / 10
    let preferredWeight: ArenaArtistStat['preferredWeight'] = null
    const clampW = (w: number): number => Math.min(shape.maxWeight, Math.max(shape.minWeight, w))
    if (n >= 4) {
      const seW = Math.sqrt(v[1])
      if (t[2] < -0.05) {
        const best = clampW(1 - t[1] / (2 * t[2]))
        const spread = Math.min(0.6, seW / Math.max(0.1, -2 * t[2]))
        preferredWeight = {
          value: round1(best),
          low: round1(clampW(best - spread)),
          high: round1(clampW(best + spread))
        }
      } else if (Math.abs(t[1]) > seW) {
        const edge = t[1] > 0 ? shape.maxWeight : shape.minWeight
        preferredWeight = {
          value: round1(edge),
          low: round1(t[1] > 0 ? clampW(edge - 0.4) : edge),
          high: round1(t[1] > 0 ? edge : clampW(edge + 0.4))
        }
      }
    }
    const seQ = Math.sqrt(v[3])
    const positionHint = n < 4 ? null : t[3] > seQ ? 'front' : t[3] < -seQ ? 'back' : 'any'
    return {
      tag,
      effect: pct(z),
      effectSe,
      preferredWeight,
      positionEffect: pct(t[3]),
      positionHint,
      appearances: n
    }
  })
}

/**
 * 새 조합 묶음: 모델 데이터가 있으면 톰슨 70% + 교배 10% + 무작위 20%, 없으면 전부 무작위.
 * existingKeys와 겹치는 조합(순서 포함 동일)은 만들지 않는다.
 */
export function generateBatch(input: {
  count: number
  pool: PoolArtist[]
  shape: ComboShape
  model: ArenaModel | null
  /** 교배 부모 후보 (점수 순, 상위부터) */
  ranked: { pairs: ArenaPair[]; certain: boolean }[]
  existingKeys: Set<string>
  rng: Rng
}): { pairs: ArenaPair[]; source: ArenaComboSource }[] {
  const { count, pool, shape, model, ranked, rng } = input
  const keys = new Set(input.existingKeys)
  const out: { pairs: ArenaPair[]; source: ArenaComboSource }[] = []
  if (pool.length === 0 || count <= 0) return out
  const push = (pairs: ArenaPair[], source: ArenaComboSource): boolean => {
    if (pairs.length === 0) return false
    const key = comboKey(pairs)
    if (keys.has(key)) return false
    keys.add(key)
    out.push({ pairs, source })
    return true
  }
  const useModel = model != null && model.comparisons >= 10
  const nModel = useModel ? Math.round(count * 0.7) : 0
  const parents = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.2)))
  const nBreed = useModel && parents.length >= 2 ? Math.round(count * 0.1) : 0

  if (nModel > 0 && model) {
    const theta = sampleTheta(model, rng)
    const cands: { pairs: ArenaPair[]; u: number }[] = []
    for (let i = 0; i < 5000; i++) {
      let pairs = randomCombo(pool, shape, rng)
      // 절반은 뽑은 θ가 좋아하는 순서(앞에 둘수록 좋은 작가를 앞으로)로 정렬해 순서도 탐색한다
      if (rng() < 0.5)
        pairs = [...pairs].sort(
          (a, b) => (theta.get(b.tag)?.[3] ?? 0) - (theta.get(a.tag)?.[3] ?? 0)
        )
      cands.push({ pairs, u: artistUtility(pairs, theta) })
    }
    cands.sort((a, b) => b.u - a.u)
    const chosen: ArenaPair[][] = []
    for (const c of cands) {
      if (chosen.length >= nModel) break
      if (chosen.some((p) => jaccard(p, c.pairs) >= 0.7)) continue
      if (push(c.pairs, 'model')) chosen.push(c.pairs)
    }
  }
  if (nBreed > 0) {
    const best = model
      ? [...pool].sort(
          (a, b) => (model.theta.get(b.tag)?.[0] ?? 0) - (model.theta.get(a.tag)?.[0] ?? 0)
        )[0]?.tag
      : undefined
    for (let tries = 0, made = 0; made < nBreed && tries < nBreed * 20; tries++) {
      const ai = Math.floor(rng() * parents.length)
      let bi = Math.floor(rng() * parents.length)
      if (ai === bi) bi = (ai + 1) % parents.length
      const a = parents[ai]
      const b = parents[bi]
      const child = breedCombo(a.pairs, b.pairs, pool, shape, rng, {
        sigma: a.certain && b.certain ? 0.12 : 0.25,
        mutateTo: rng() < 0.05 ? best : undefined
      })
      if (push(child, 'breed')) made++
    }
  }
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    push(randomCombo(pool, shape, rng), 'random')
  }
  return out.slice(0, count)
}

// ───────────────────────── 대결 편성 ─────────────────────────

/**
 * 2×2 한 판: 슬롯 하나 + 그 슬롯 이미지가 있는 조합 4개.
 * 등장이 적은 조합 우선, 점수가 가까운 조합끼리, 같은 조합이 같은 슬롯만 받지 않게.
 */
export function pickQuad(input: {
  pool: number[]
  slots: number[]
  hasRender: (comboId: number, slot: number) => boolean
  appear: Map<number, number>
  slotUse: Map<string, number>
  score: Map<number, number>
  lastIds?: number[]
  rng: Rng
}): { slot: number; comboIds: number[] } | null {
  const { pool, slots, hasRender, appear, slotUse, score, rng } = input
  const need = (id: number): number => 1 / ((appear.get(id) ?? 0) + 1)
  const used = (id: number, slot: number): number => slotUse.get(id + ':' + slot) ?? 0
  let best: { slot: number; ids: number[]; value: number } | null = null
  for (const slot of slots) {
    const eligible = pool.filter((id) => hasRender(id, slot))
    if (eligible.length < 4) continue
    const ranked = eligible
      .map((id) => ({
        id,
        w: ((need(id) * need(id)) / (1 + used(id, slot))) * (0.75 + rng() * 0.5)
      }))
      .sort((a, b) => b.w - a.w)
    const anchor = ranked[0].id
    const s0 = score.get(anchor) ?? 0
    const rest = eligible
      .filter((id) => id !== anchor)
      .map((id) => ({
        id,
        w:
          (need(id) * Math.exp(-Math.abs((score.get(id) ?? 0) - s0)) * (0.6 + rng() * 0.8)) /
          (1 + used(id, slot) * 0.5)
      }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 3)
      .map((x) => x.id)
    const ids = [anchor, ...rest]
    if (input.lastIds && ids.every((id) => input.lastIds!.includes(id))) continue
    const value = ranked[0].w + rest.reduce((s, id) => s + need(id), 0) * 0.3
    if (!best || value > best.value) best = { slot, ids, value }
  }
  return best ? { slot: best.slot, comboIds: shuffle(best.ids, rng) } : null
}

/** 라운드로빈 대진 — 같은 조합이 연달아 나오지 않게 섞는다 */
export function roundRobin(ids: number[], rng: Rng): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      pairs.push(rng() < 0.5 ? [ids[i], ids[j]] : [ids[j], ids[i]])
  const rest = shuffle(pairs, rng)
  const out: [number, number][] = []
  while (rest.length) {
    const last = out[out.length - 1]
    const k = last ? rest.findIndex((p) => !p.includes(last[0]) && !p.includes(last[1])) : 0
    out.push(rest.splice(k < 0 ? 0 : k, 1)[0])
  }
  return out
}

/** 안경점: 현재 값 포함 [w−0.6, w−0.3, w, w+0.3], 범위 안으로 자르고 중복 제거 */
/**
 * 안경점: 지금 값 포함 [w−2s, w−s, w, w+s] (기본 s=0.3). 범위 안으로 자르고 중복은 바깥 값으로 채운다.
 * 지금 값이 범위 밖(0.25 등)이어도 지금 값은 그대로 남긴다.
 */
export function tuneWeights(
  current: number,
  min = WEIGHT_FLOOR,
  max = WEIGHT_CEIL,
  step = 0.3
): number[] {
  const lo = Math.min(min, roundWeight(current))
  const hi = Math.max(max, roundWeight(current))
  const out: number[] = []
  for (const k of [0, -2, -1, 1, 2, 3, -3]) {
    const w = clampWeight(current + k * step, lo, hi)
    if (out.length < 4 && !out.includes(w)) out.push(w)
  }
  return out.sort((a, b) => a - b)
}

/**
 * 순서 후보: 지금 순서, 모델이 앞을 좋아하는 작가부터, 효과 큰 작가를 맨 앞으로, 뒤집기.
 * 같은 순서는 한 번만.
 */
/**
 * 순서 후보 = 지금 순서 + 작가 한 명만 한 칸(모자라면 두 칸) 옮긴 새 순서 3개.
 * 모델이 "앞에 둘수록 좋다"고 본 작가를 앞으로 옮기는 것부터 고르고,
 * 모델이 아직 모르면 앞·가운데·뒤에서 고르게 하나씩 고른다.
 */
export function orderCandidates(pairs: ArenaPair[], theta: Map<string, Theta>): ArenaPair[][] {
  const n = pairs.length
  if (n < 2) return [pairs]
  const front = (i: number): number => (n > 1 ? 1 - i / (n - 1) : 1)
  const moves: { from: number; to: number; gain: number; dist: number }[] = []
  const gainOf = (order: ArenaPair[]): number =>
    order.reduce((s, p, i) => {
      const orig = pairs.indexOf(p)
      return s + (theta.get(p.tag)?.[3] ?? 0) * (front(i) - front(orig))
    }, 0)
  const moved = (from: number, to: number): ArenaPair[] => {
    const v = [...pairs]
    const [x] = v.splice(from, 1)
    v.splice(to, 0, x)
    return v
  }
  for (let i = 0; i < n; i++) {
    for (const d of [-1, 1, -2, 2]) {
      const to = i + d
      if (to < 0 || to >= n) continue
      // 한 칸 옮기기는 옆 작가와 자리 바꾸기라 (i, i+1)과 (i+1, i)가 같다 — 위로 옮기는 쪽만 둔다
      if (d === 1) continue
      moves.push({ from: i, to, gain: gainOf(moved(i, to)), dist: Math.abs(d) })
    }
  }
  const informative = moves.some((m) => Math.abs(m.gain) > 1e-6)
  let picked: typeof moves
  if (informative) {
    picked = [...moves].sort((a, b) => b.gain - a.gain || a.dist - b.dist || a.to - b.to)
  } else {
    // 모델 정보가 없으면 한 칸 옮기기를 앞·가운데·뒤에서 고르게
    const ones = moves.filter((m) => m.dist === 1).sort((a, b) => a.to - b.to)
    const spread = [0, Math.floor((ones.length - 1) / 2), ones.length - 1].map((k) => ones[k])
    picked = [...spread, ...moves.filter((m) => m.dist === 2)]
  }
  const keyOf = (p: ArenaPair[]): string => p.map((x) => x.tag).join('|')
  const out: ArenaPair[][] = [pairs]
  for (const m of picked) {
    if (out.length >= 4) break
    const v = moved(m.from, m.to)
    if (!out.some((o) => keyOf(o) === keyOf(v))) out.push(v)
  }
  return out
}

/** 티어는 단계 기준: S = 결선, A = 본선에서 멈춤, 나머지는 점수 순 4등분 */
export function assignTiers(
  items: { id: number; stageReached: ArenaCombo['stageReached']; score: number }[]
): Map<number, ArenaTier> {
  const out = new Map<number, ArenaTier>()
  const rest: { id: number; score: number }[] = []
  for (const it of items) {
    if (it.stageReached === 'final') out.set(it.id, 'S')
    else if (it.stageReached === 'main') out.set(it.id, 'A')
    else rest.push(it)
  }
  rest.sort((a, b) => b.score - a.score)
  const tiers: ArenaTier[] = ['B', 'C', 'D', 'F']
  rest.forEach((it, i) => out.set(it.id, tiers[Math.min(3, Math.floor((i * 4) / rest.length))]))
  return out
}

/** 장면별 승률의 표준편차 (장면 3개 이상에서 비교가 있을 때만) */
export function consistencyOf(id: number, comparisons: Comparison[]): number | null {
  const bySlot = new Map<number, { w: number; n: number }>()
  for (const c of comparisons) {
    if (c.slot < 0 || (c.winner !== id && c.loser !== id)) continue
    const s = bySlot.get(c.slot) ?? { w: 0, n: 0 }
    s.n += c.weight
    s.w += c.draw ? c.weight / 2 : c.winner === id ? c.weight : 0
    bySlot.set(c.slot, s)
  }
  const rates = [...bySlot.values()].filter((s) => s.n >= 1).map((s) => s.w / s.n)
  if (rates.length < 3) return null
  const mean = rates.reduce((s, r) => s + r, 0) / rates.length
  return Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length)
}
