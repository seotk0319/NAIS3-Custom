import type {
  ArenaArtist,
  ArenaArtistParseItem,
  ArenaCombo,
  ArenaComboSource,
  ArenaComboView,
  ArenaDuel,
  ArenaEnqueueResult,
  ArenaModel,
  ArenaPair,
  ArenaProgress,
  ArenaRender,
  ArenaRenderState,
  ArenaSession,
  ArenaSessionConfig,
  ArenaSessionState,
  ArenaSessionSummary,
  ArenaSlot,
  ArenaSnapshot,
  ArenaStage,
  ArenaVote,
  ArenaVoteResult,
  ArenaWait,
  Comparison,
  PoolArtist,
  SlotLayout
} from '../../shared/arena'
import {
  ARENA_SLOT_COUNT,
  BUDGETS,
  FINAL_SIZE,
  MAIN_MIN_APPEAR,
  MAIN_SIZE,
  PRELIM_MIN_APPEAR,
  REVIVE_COUNT,
  STAGE_LABELS,
  WEIGHT_CEIL,
  WEIGHT_FLOOR,
  artistStats,
  slotLayout,
  assignTiers,
  comboKey,
  comboScore,
  comboString,
  consistencyOf,
  emptyModel,
  fitModel,
  generateBatch,
  hasArtistToken,
  insertArtists,
  insertScene,
  orderCandidates,
  parseArtistInput,
  pickQuad,
  roundRobin,
  roundWeight,
  tuneWeights,
  voteComparisons
} from '../../shared/arena'
import { removeComments } from '../../shared/nai-presets'
import type { GenerationRequest, QueueStatus, UcPresetIndex } from '../../shared/types'
import { getDb } from '../db'
import { processWildcards } from '../fragments/processor'
import { fragmentSource } from '../fragments/repo'
import type { GenerationQueue } from '../queue/generation-queue'
import { isArtistTag } from '../tags'

/**
 * 그림체 월드컵 세션 서비스. 판 기록(arena_votes)이 모든 점수의 원천이고,
 * 점수·티어·다음 판은 스냅샷을 만들 때마다 판 기록에서 다시 계산한다 (모델은 판 수로 캐시).
 */

type Broadcast = (payload: {
  sessionId: number
  kind: 'render' | 'state'
  renderId?: number
  comboId?: number
  slot?: number
  filePath?: string
  state?: ArenaRenderState
}) => void

let queue: GenerationQueue | null = null
let emit: Broadcast = () => {}
/** 대기열 항목 id → arena_renders.id (실패·취소를 이미지 상태로 돌려놓는 데 쓴다) */
const queueToRender = new Map<string, number>()
const modelCache = new Map<number, { key: string; model: ArenaModel; comparisons: Comparison[] }>()

export function initArena(q: GenerationQueue, broadcast: Broadcast): void {
  queue = q
  emit = broadcast
  const db = getDb()
  // 대기열은 메모리에만 있다 — 지난 실행에서 대기 중이던 이미지는 다시 뽑을 수 있게 되돌린다
  db.prepare(
    "UPDATE arena_renders SET state = 'missing', queue_id = NULL WHERE state = 'queued'"
  ).run()
  // 지운 지 하루 지난 세션은 정리 (이미지 파일은 남긴다)
  db.prepare(
    "DELETE FROM arena_sessions WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-1 day')"
  ).run()
  q.on('changed', onQueueChanged)
}

function onQueueChanged(status: QueueStatus): void {
  if (queueToRender.size === 0) return
  const present = new Set<string>()
  for (const item of status.items) {
    present.add(item.id)
    const renderId = queueToRender.get(item.id)
    if (renderId === undefined) continue
    if (item.state === 'failed' || item.state === 'cancelled') {
      queueToRender.delete(item.id)
      markRender(renderId, item.state === 'failed' ? 'failed' : 'missing', null, item.error ?? null)
    } else if (item.state === 'done') {
      queueToRender.delete(item.id)
    }
  }
  // 대기열 초기화(F5 등)로 사라진 항목은 다시 뽑을 수 있게 되돌린다
  for (const [qid, renderId] of [...queueToRender]) {
    if (present.has(qid)) continue
    queueToRender.delete(qid)
    markRender(renderId, 'missing', null, null)
  }
}

function markRender(
  renderId: number,
  state: ArenaRenderState,
  filePath: string | null,
  error: string | null
): void {
  const db = getDb()
  const row = db
    .prepare('SELECT session_id, combo_id, slot, state FROM arena_renders WHERE id = ?')
    .get(renderId) as
    { session_id: number; combo_id: number; slot: number; state: string } | undefined
  if (!row) return
  if (row.state === 'done' && state !== 'done') return
  db.prepare(
    "UPDATE arena_renders SET state = ?, file_path = COALESCE(?, file_path), queue_id = NULL, error = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(state, filePath, error, renderId)
  emit({
    sessionId: row.session_id,
    kind: 'render',
    renderId,
    comboId: row.combo_id,
    slot: row.slot,
    filePath: filePath ?? undefined,
    state
  })
}

/** 생성 파이프라인이 저장 폴더를 정할 때 쓴다 */
export function arenaRenderTarget(renderId: number): { sessionId: number; dir: string } | null {
  const row = getDb()
    .prepare(
      'SELECT s.id AS id, s.name AS name FROM arena_renders r JOIN arena_sessions s ON s.id = r.session_id WHERE r.id = ?'
    )
    .get(renderId) as { id: number; name: string } | undefined
  if (!row) return null
  const safe =
    row.name
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .slice(0, 60) || 'session'
  return { sessionId: row.id, dir: 'arena/' + row.id + '_' + safe }
}

export function arenaRenderSaved(renderId: number, filePath: string): void {
  markRender(renderId, 'done', filePath, null)
}

// ───────────────────────── 읽기 ─────────────────────────

interface SessionRow {
  id: number
  name: string
  target: string
  stage: string
  config_json: string
  slots_json: string
  state_json: string
  created_at: string
  updated_at: string
}

function toSession(r: SessionRow): ArenaSession {
  return {
    id: r.id,
    name: r.name,
    target: r.target === 'negative' ? 'negative' : 'positive',
    stage: r.stage as ArenaStage,
    config: JSON.parse(r.config_json) as ArenaSessionConfig,
    slots: JSON.parse(r.slots_json) as ArenaSlot[],
    state: JSON.parse(r.state_json) as ArenaSessionState,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function readSession(id: number): ArenaSession | null {
  const r = getDb()
    .prepare('SELECT * FROM arena_sessions WHERE id = ? AND deleted_at IS NULL')
    .get(id) as SessionRow | undefined
  return r ? toSession(r) : null
}

function saveSession(s: ArenaSession): void {
  getDb()
    .prepare(
      "UPDATE arena_sessions SET name = ?, stage = ?, state_json = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(s.name, s.stage, JSON.stringify(s.state), s.id)
}

function listCombos(sessionId: number): ArenaCombo[] {
  const rows = getDb()
    .prepare('SELECT * FROM arena_combos WHERE session_id = ? ORDER BY id')
    .all(sessionId) as {
    id: number
    session_id: number
    pairs_json: string
    combo_key: string
    source: string
    parent_id: number | null
    generation: number
    stage_reached: string
    favorite: number
    hidden: number
  }[]
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    pairs: JSON.parse(r.pairs_json) as ArenaPair[],
    key: r.combo_key,
    source: r.source as ArenaComboSource,
    parentId: r.parent_id,
    generation: r.generation,
    stageReached: r.stage_reached as ArenaCombo['stageReached'],
    favorite: r.favorite === 1,
    hidden: r.hidden === 1
  }))
}

function listRenders(sessionId: number): ArenaRender[] {
  return (
    getDb()
      .prepare(
        'SELECT id, combo_id, slot, state, file_path FROM arena_renders WHERE session_id = ? ORDER BY id'
      )
      .all(sessionId) as {
      id: number
      combo_id: number
      slot: number
      state: string
      file_path: string | null
    }[]
  ).map((r) => ({
    id: r.id,
    comboId: r.combo_id,
    slot: r.slot,
    state: r.state as ArenaRenderState,
    filePath: r.file_path
  }))
}

interface StoredVote extends ArenaVote {
  stage: ArenaStage
}

function listVotes(sessionId: number): StoredVote[] {
  return (
    getDb()
      .prepare('SELECT * FROM arena_votes WHERE session_id = ? ORDER BY id')
      .all(sessionId) as {
      id: number
      session_id: number
      stage: string
      duel_json: string
      result_json: string
      created_at: string
    }[]
  ).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    stage: r.stage as ArenaStage,
    duel: JSON.parse(r.duel_json) as ArenaDuel,
    result: JSON.parse(r.result_json) as ArenaVoteResult,
    createdAt: r.created_at
  }))
}

// ───────────────────────── 쓰기 ─────────────────────────

function insertCombo(
  sessionId: number,
  pairs: ArenaPair[],
  source: ArenaComboSource,
  opts: { parentId?: number | null; generation?: number; hidden?: boolean } = {}
): number {
  const db = getDb()
  const key = comboKey(pairs)
  db.prepare(
    'INSERT OR IGNORE INTO arena_combos (session_id, pairs_json, combo_key, source, parent_id, generation, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    sessionId,
    JSON.stringify(pairs),
    key,
    source,
    opts.parentId ?? null,
    opts.generation ?? 0,
    opts.hidden ? 1 : 0
  )
  return (
    db
      .prepare('SELECT id FROM arena_combos WHERE session_id = ? AND combo_key = ?')
      .get(sessionId, key) as { id: number }
  ).id
}

function ensureRender(sessionId: number, comboId: number, slot: number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO arena_renders (session_id, combo_id, slot) VALUES (?, ?, ?)')
    .run(sessionId, comboId, slot)
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

function resolvePrompt(text: string): string {
  return processWildcards(removeComments(text), fragmentSource())
}

function buildRequest(
  session: ArenaSession,
  pairs: ArenaPair[],
  slot: number,
  renderId: number
): GenerationRequest {
  const cfg = session.config
  const s = session.slots[slot] ?? { scene: '', seed: randomSeed() }
  const basePos = session.state.resolvedPrompt ?? cfg.basePrompt
  const baseNeg = session.state.resolvedNegative ?? cfg.negativePrompt
  const negative = session.target === 'negative'
  const positiveCombo = negative ? comboString(cfg.fixedPositive ?? []) : comboString(pairs)
  const prompt = insertScene(insertArtists(basePos, positiveCombo), s.scene)
  const negativePrompt = insertArtists(baseNeg, negative ? comboString(pairs) : '')
  const p = cfg.params
  return {
    prompt,
    negativePrompt,
    model: p.model,
    width: p.width,
    height: p.height,
    steps: p.steps,
    cfgScale: p.cfgScale,
    cfgRescale: p.cfgRescale,
    sampler: p.sampler,
    noiseSchedule: p.noiseSchedule,
    seed: s.seed,
    variety: p.variety,
    qualityToggle: p.qualityToggle,
    transparentBackground: p.transparentBackground,
    ucPreset: p.ucPreset as UcPresetIndex,
    characterPrompts: [],
    useCoords: false,
    skipWildcards: true,
    arenaRenderId: renderId
  }
}

/** 아직 없는 이미지를 대기열에 넣는다. 첫 대결이 빨리 열리게 장면마다 4장씩 번갈아 넣는다 */
export function enqueueMissing(
  sessionId: number,
  opts: { limit?: number; retryFailed?: boolean } = {}
): ArenaEnqueueResult {
  const session = readSession(sessionId)
  if (!session || !queue) return { queued: 0, missing: 0 }
  const db = getDb()
  const states = opts.retryFailed ? ['missing', 'failed'] : ['missing']
  const rows = db
    .prepare(
      'SELECT r.id, r.combo_id, r.slot, c.pairs_json FROM arena_renders r JOIN arena_combos c ON c.id = r.combo_id WHERE r.session_id = ? AND r.state IN (' +
        states.map(() => '?').join(',') +
        ') ORDER BY r.id'
    )
    .all(sessionId, ...states) as {
    id: number
    combo_id: number
    slot: number
    pairs_json: string
  }[]
  if (rows.length === 0) return { queued: 0, missing: 0 }
  const bySlot = new Map<number, number>()
  const keyed = rows.map((r) => {
    const n = bySlot.get(r.slot) ?? 0
    bySlot.set(r.slot, n + 1)
    return { r, k: Math.floor(n / 4) * 100 + r.slot }
  })
  keyed.sort((a, b) => a.k - b.k || a.r.id - b.r.id)
  const take = opts.limit != null ? keyed.slice(0, Math.max(0, opts.limit)) : keyed
  if (take.length === 0) return { queued: 0, missing: rows.length }
  const requests = take.map(({ r }) =>
    buildRequest(session, JSON.parse(r.pairs_json) as ArenaPair[], r.slot, r.id)
  )
  const result = queue.tryEnqueueMany(requests)
  if (result.blockedReason) {
    return { queued: 0, missing: rows.length, blockedReason: result.blockedReason }
  }
  const mark = db.prepare(
    "UPDATE arena_renders SET state = 'queued', queue_id = ?, error = NULL WHERE id = ?"
  )
  db.transaction(() => {
    result.ids.forEach((qid, i) => {
      mark.run(qid, take[i].r.id)
      queueToRender.set(qid, take[i].r.id)
    })
  })()
  emit({ sessionId, kind: 'state' })
  return { queued: result.ids.length, missing: rows.length - result.ids.length }
}

export function cancelSession(sessionId: number): void {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT id, queue_id FROM arena_renders WHERE session_id = ? AND state = 'queued' AND queue_id IS NOT NULL"
    )
    .all(sessionId) as { id: number; queue_id: string }[]
  if (rows.length && queue) queue.cancel(rows.map((r) => r.queue_id))
  db.prepare(
    "UPDATE arena_renders SET state = 'missing', queue_id = NULL WHERE session_id = ? AND state = 'queued'"
  ).run(sessionId)
  for (const r of rows) queueToRender.delete(r.queue_id)
  emit({ sessionId, kind: 'state' })
}

// ───────────────────────── 작가 ─────────────────────────

export function listArtists(): ArenaArtist[] {
  return (
    getDb()
      .prepare(
        'SELECT tag, list, fixed_weight, created_at FROM arena_artists ORDER BY created_at, tag'
      )
      .all() as { tag: string; list: string; fixed_weight: number | null; created_at: string }[]
  ).map((r) => ({
    tag: r.tag,
    list: r.list === 'avoided' ? 'avoided' : 'liked',
    fixedWeight: r.fixed_weight,
    createdAt: r.created_at
  }))
}

export function parseArtists(text: string): ArenaArtistParseItem[] {
  const existing = new Set(listArtists().map((a) => a.tag))
  return parseArtistInput(text).map(({ name, hadPrefix }) => ({
    name,
    status: existing.has(name) ? 'exists' : hadPrefix || isArtistTag(name) ? 'new' : 'notArtist'
  }))
}

export function addArtists(names: string[], list: 'liked' | 'avoided'): number {
  const db = getDb()
  const ins = db.prepare('INSERT OR IGNORE INTO arena_artists (tag, list) VALUES (?, ?)')
  let added = 0
  db.transaction(() => {
    for (const raw of names) {
      const name = raw
        .trim()
        .toLowerCase()
        .replace(/^artist:\s*/, '')
      if (name) added += ins.run(name, list).changes
    }
  })()
  return added
}

export function updateArtist(
  tag: string,
  patch: { list?: 'liked' | 'avoided'; fixedWeight?: number | null }
): void {
  const db = getDb()
  if (patch.list) db.prepare('UPDATE arena_artists SET list = ? WHERE tag = ?').run(patch.list, tag)
  if (patch.fixedWeight !== undefined) {
    const w =
      patch.fixedWeight == null
        ? null
        : roundWeight(Math.min(WEIGHT_CEIL, Math.max(WEIGHT_FLOOR, patch.fixedWeight)))
    db.prepare('UPDATE arena_artists SET fixed_weight = ? WHERE tag = ?').run(w, tag)
  }
}

export function removeArtists(tags: string[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM arena_artists WHERE tag = ?')
  db.transaction(() => tags.forEach((t) => del.run(t)))()
}

function likedPool(): PoolArtist[] {
  return listArtists()
    .filter((a) => a.list === 'liked')
    .map((a) => ({ tag: a.tag, fixedWeight: a.fixedWeight }))
}

// ───────────────────────── 세션 ─────────────────────────

export function createSession(
  config: ArenaSessionConfig,
  limit?: number
): { id?: number; error?: string; enqueue?: ArenaEnqueueResult } {
  const negative = config.target === 'negative'
  if (negative ? !hasArtistToken(config.negativePrompt) : !hasArtistToken(config.basePrompt)) {
    return {
      error: negative
        ? '네거티브 프롬프트에 {artist} 자리가 없어요'
        : '프롬프트에 {artist} 자리가 없어요'
    }
  }
  const given = config.scenes.map((s) => s.trim())
  // 장면 수는 세션마다 1~12개 (빈 줄은 뺀다)
  const filled = given.filter(Boolean)
  const scenes = (filled.length ? filled : ['']).slice(0, ARENA_SLOT_COUNT)
  const slots: ArenaSlot[] = scenes.map((scene) => ({ scene, seed: randomSeed() }))
  const shape = {
    minArtists: Math.max(1, Math.round(Math.min(config.minArtists, config.maxArtists))),
    maxArtists: Math.max(1, Math.round(Math.max(config.minArtists, config.maxArtists))),
    minWeight: roundWeight(Math.min(config.minWeight, config.maxWeight)),
    maxWeight: roundWeight(Math.max(config.minWeight, config.maxWeight))
  }
  const cfg: ArenaSessionConfig = { ...config, ...shape, scenes }
  let candidates: string[] = []
  let pool: PoolArtist[] = []
  if (negative) {
    const avoided = listArtists()
      .filter((a) => a.list === 'avoided')
      .map((a) => a.tag)
    candidates = (config.negCandidates?.length ? config.negCandidates : avoided).slice(0, 60)
    if (candidates.length === 0) return { error: '피하고 싶은 작가를 먼저 추가해요' }
  } else {
    pool = likedPool()
    if (pool.length < 2) return { error: '좋아하는 작가를 2명 이상 먼저 추가해요' }
  }
  const state: ArenaSessionState = {
    resolvedPrompt: resolvePrompt(cfg.basePrompt),
    resolvedNegative: resolvePrompt(cfg.negativePrompt)
  }
  const db = getDb()
  const id = Number(
    db
      .prepare(
        'INSERT INTO arena_sessions (name, target, stage, config_json, slots_json, state_json) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        cfg.name.trim() || '새 세션',
        negative ? 'negative' : 'positive',
        negative ? 'neg' : 'prelim',
        JSON.stringify(cfg),
        JSON.stringify(slots),
        JSON.stringify(state)
      ).lastInsertRowid
  )
  db.transaction(() => {
    if (negative) {
      const w = roundWeight(config.negWeight ?? 1)
      const baselineId = insertCombo(id, [], 'baseline', { hidden: true })
      const candidateIds = candidates.map((tag) =>
        insertCombo(id, [{ tag, weight: w }], 'candidate')
      )
      state.baselineId = baselineId
      state.candidateIds = candidateIds
      for (const slot of slotLayout(slots.length).neg) {
        ensureRender(id, baselineId, slot)
        for (const c of candidateIds) ensureRender(id, c, slot)
      }
    } else {
      const batch = generateBatch({
        count: BUDGETS[cfg.budget]?.prelim ?? 200,
        pool,
        shape,
        model: null,
        ranked: [],
        existingKeys: new Set(),
        rng: Math.random
      })
      const offset = Math.floor(Math.random() * slots.length)
      batch.forEach((b, i) => {
        const cid = insertCombo(id, b.pairs, b.source)
        ensureRender(id, cid, (i + offset) % slots.length)
      })
    }
    db.prepare('UPDATE arena_sessions SET state_json = ? WHERE id = ?').run(
      JSON.stringify(state),
      id
    )
  })()
  const enqueue = enqueueMissing(id, { limit })
  return { id, enqueue }
}

export function listSessions(): ArenaSessionSummary[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM arena_combos c WHERE c.session_id = s.id AND c.hidden = 0) AS combo_count, ' +
        '(SELECT COUNT(*) FROM arena_votes v WHERE v.session_id = s.id) AS vote_count ' +
        'FROM arena_sessions s WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id DESC'
    )
    .all() as (SessionRow & { combo_count: number; vote_count: number })[]
  const thumbFor = db.prepare(
    "SELECT file_path FROM arena_renders WHERE session_id = ? AND combo_id = ? AND state = 'done' ORDER BY slot LIMIT 1"
  )
  const latest = db.prepare(
    "SELECT file_path FROM arena_renders WHERE session_id = ? AND state = 'done' ORDER BY updated_at DESC LIMIT 1"
  )
  const negVotes = db.prepare(
    "SELECT COUNT(*) AS c FROM arena_votes WHERE session_id = ? AND stage = 'neg'"
  )
  return rows.map((r) => {
    const s = toSession(r)
    const focus = s.state.confirmedComboId ?? s.state.tune?.baseComboId ?? null
    const thumb =
      (focus != null
        ? (thumbFor.get(s.id, focus) as { file_path: string } | undefined)
        : undefined) ?? (latest.get(s.id) as { file_path: string } | undefined)
    let stageLabel = STAGE_LABELS[s.stage] ?? s.stage
    if (s.stage === 'tune' && s.state.tune) {
      stageLabel =
        '다듬기 ' + Object.keys(s.state.tune.chosen).length + '/' + s.state.tune.artists.length
    } else if (s.stage === 'neg') {
      const n = (negVotes.get(s.id) as { c: number }).c
      stageLabel =
        '후보 ' +
        Math.floor(n / slotLayout(s.slots.length).neg.length) +
        ' / ' +
        (s.state.candidateIds?.length ?? 0)
    }
    return {
      id: s.id,
      name: s.name,
      target: s.target,
      stage: s.stage,
      stageLabel,
      comboCount: r.combo_count,
      voteCount: r.vote_count,
      updatedAt: s.updatedAt,
      thumbPath: thumb?.file_path ?? null
    }
  })
}

export function deleteSession(id: number): void {
  cancelSession(id)
  getDb().prepare("UPDATE arena_sessions SET deleted_at = datetime('now') WHERE id = ?").run(id)
}

export function restoreSession(id: number): void {
  getDb().prepare('UPDATE arena_sessions SET deleted_at = NULL WHERE id = ?').run(id)
}

export function renameSession(id: number, name: string): void {
  getDb()
    .prepare("UPDATE arena_sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name.trim() || '새 세션', id)
}

export function setFavorite(comboId: number, favorite: boolean): void {
  getDb()
    .prepare('UPDATE arena_combos SET favorite = ? WHERE id = ?')
    .run(favorite ? 1 : 0, comboId)
}

// ───────────────────────── 계산 ─────────────────────────

interface Ctx {
  session: ArenaSession
  combos: ArenaCombo[]
  byId: Map<number, ArenaCombo>
  renders: ArenaRender[]
  done: Map<string, ArenaRender>
  votes: StoredVote[]
  model: ArenaModel
  comparisons: Comparison[]
  score: Map<number, number>
  se: Map<number, number>
}

function renderKey(comboId: number, slot: number): string {
  return comboId + ':' + slot
}

/** 이 세션의 장면 배치 (장면 수에 따라) */
function lay(ctx: Ctx): SlotLayout {
  return slotLayout(ctx.session.slots.length)
}

function buildCtx(sessionId: number): Ctx | null {
  const session = readSession(sessionId)
  if (!session) return null
  const combos = listCombos(sessionId)
  const byId = new Map(combos.map((c) => [c.id, c]))
  const renders = listRenders(sessionId)
  const done = new Map<string, ArenaRender>()
  for (const r of renders)
    if (r.state === 'done' && r.filePath) done.set(renderKey(r.comboId, r.slot), r)
  const votes = listVotes(sessionId)
  const key = votes.length + ':' + (votes[votes.length - 1]?.id ?? 0) + ':' + combos.length
  let cached = modelCache.get(sessionId)
  if (!cached || cached.key !== key) {
    const comparisons = votes.flatMap((v) => voteComparisons(v))
    const model =
      session.target === 'negative'
        ? emptyModel()
        : fitModel(new Map(combos.map((c) => [c.id, c.pairs])), comparisons)
    cached = { key, model, comparisons }
    modelCache.set(sessionId, cached)
  }
  const score = new Map<number, number>()
  const se = new Map<number, number>()
  for (const c of combos) {
    const s = comboScore(cached.model, c.id, c.pairs)
    score.set(c.id, s.score)
    se.set(c.id, s.se)
  }
  return {
    session,
    combos,
    byId,
    renders,
    done,
    votes,
    model: cached.model,
    comparisons: cached.comparisons,
    score,
    se
  }
}

function duelComboIds(d: ArenaDuel): number[] {
  switch (d.kind) {
    case 'quad':
      return d.comboIds
    case 'set':
      return [d.a, d.b]
    case 'tune':
    case 'order':
      return d.options.map((o) => o.comboId)
    case 'neg':
      return [d.baseline, d.candidate]
  }
}

function stageAppear(
  ctx: Ctx,
  stage: ArenaStage
): { appear: Map<number, number>; slotUse: Map<string, number> } {
  const appear = new Map<number, number>()
  const slotUse = new Map<string, number>()
  for (const v of ctx.votes) {
    if (v.stage !== stage || v.duel.kind !== 'quad') continue
    for (const id of v.duel.comboIds) {
      appear.set(id, (appear.get(id) ?? 0) + 1)
      const k = id + ':' + v.duel.slot
      slotUse.set(k, (slotUse.get(k) ?? 0) + 1)
    }
  }
  return { appear, slotUse }
}

const STAGE_LEVEL: Record<ArenaCombo['stageReached'], number> = { prelim: 0, main: 1, final: 2 }

/**
 * 순위에 드는 조합 (다듬기 변형·기준 제외). 올라간 단계가 먼저, 같은 단계 안에서는 점수 순 —
 * 결선에 오른 조합이 본선에서 멈춘 조합보다 아래에 보이지 않게 한다 (티어와 같은 기준)
 */
function rankedVisible(ctx: Ctx): ArenaCombo[] {
  return ctx.combos
    .filter((c) => !c.hidden && c.source !== 'baseline')
    .sort(
      (a, b) =>
        STAGE_LEVEL[b.stageReached] - STAGE_LEVEL[a.stageReached] ||
        (ctx.score.get(b.id) ?? 0) - (ctx.score.get(a.id) ?? 0)
    )
}

function prelimPool(ctx: Ctx): number[] {
  return ctx.combos.filter((c) => !c.hidden && c.source !== 'baseline').map((c) => c.id)
}

function hasAll(ctx: Ctx, comboIds: number[], slots: number[]): boolean {
  return comboIds.every((id) => slots.every((s) => ctx.done.has(renderKey(id, s))))
}

function finalDone(ctx: Ctx): boolean {
  const pairs = ctx.session.state.finalPairs ?? []
  const votes = ctx.votes.filter((v) => v.stage === 'final')
  if (votes.length >= pairs.length) return true
  if (votes.length < 16) return false
  // 남은 판을 다 이겨도 1위를 못 넘으면 일찍 끝낸다
  const wins = new Map<number, number>()
  const remaining = new Map<number, number>()
  for (const v of votes) {
    if (v.duel.kind !== 'set' || v.result.kind !== 'set') continue
    const { a, b } = v.duel
    if (v.result.winner === 'same') {
      wins.set(a, (wins.get(a) ?? 0) + 0.5)
      wins.set(b, (wins.get(b) ?? 0) + 0.5)
    } else {
      const w = v.result.winner === 'a' ? a : b
      wins.set(w, (wins.get(w) ?? 0) + 1)
    }
  }
  for (const [a, b] of pairs.slice(votes.length)) {
    remaining.set(a, (remaining.get(a) ?? 0) + 1)
    remaining.set(b, (remaining.get(b) ?? 0) + 1)
  }
  const ids = ctx.session.state.finalIds ?? []
  const leader = [...ids].sort((x, y) => (wins.get(y) ?? 0) - (wins.get(x) ?? 0))[0]
  const lead = wins.get(leader) ?? 0
  return ids.every((id) => id === leader || (wins.get(id) ?? 0) + (remaining.get(id) ?? 0) < lead)
}

function renderCounts(ctx: Ctx): ArenaProgress['renders'] {
  const out = { done: 0, queued: 0, missing: 0, failed: 0 }
  for (const r of ctx.renders) out[r.state]++
  return out
}

function nextDuel(ctx: Ctx): { duel: ArenaDuel | null; wait: ArenaWait | null } {
  const { session } = ctx
  const st = session.state
  const counts = renderCounts(ctx)
  const waitOf = (ready: number, needed: number): ArenaWait => ({
    ready,
    needed,
    queued: counts.queued,
    missing: counts.missing,
    failed: counts.failed
  })
  const valid = (d: ArenaDuel): boolean => {
    if (d.kind === 'quad')
      return (
        d.stage === session.stage && d.comboIds.every((id) => ctx.done.has(renderKey(id, d.slot)))
      )
    if (d.kind === 'set') return session.stage === 'final' && hasAll(ctx, [d.a, d.b], d.slots)
    if (d.kind === 'tune')
      return (
        session.stage === 'tune' &&
        st.tune?.chosen[d.artist] === undefined &&
        hasAll(ctx, duelComboIds(d), [d.slot])
      )
    if (d.kind === 'order')
      return session.stage === 'order' && hasAll(ctx, duelComboIds(d), [d.slot])
    if (d.kind === 'neg')
      return session.stage === 'neg' && hasAll(ctx, [d.baseline, d.candidate], [d.slot])
    return false
  }
  if (st.currentDuel && valid(st.currentDuel)) return { duel: st.currentDuel, wait: null }

  const stage = session.stage
  if (stage === 'prelim' || stage === 'main') {
    const pool = stage === 'prelim' ? prelimPool(ctx) : (st.mainIds ?? [])
    const slots = stage === 'prelim' ? lay(ctx).all : lay(ctx).main
    const { appear, slotUse } = stageAppear(ctx, stage)
    const pick = pickQuad({
      pool,
      slots,
      hasRender: (id, slot) => ctx.done.has(renderKey(id, slot)),
      appear,
      slotUse,
      score: ctx.score,
      lastIds: st.lastIds,
      rng: Math.random
    })
    if (pick)
      return { duel: { kind: 'quad', stage, slot: pick.slot, comboIds: pick.comboIds }, wait: null }
    let best = 0
    for (const slot of slots)
      best = Math.max(best, pool.filter((id) => ctx.done.has(renderKey(id, slot))).length)
    return {
      duel: null,
      wait: counts.queued + counts.missing > 0 ? waitOf(Math.min(4, best), 4) : null
    }
  }
  if (stage === 'final') {
    const pairs = st.finalPairs ?? []
    if (finalDone(ctx)) return { duel: null, wait: null }
    const index = ctx.votes.filter((v) => v.stage === 'final').length
    const [a, b] = pairs[index]
    if (hasAll(ctx, [a, b], lay(ctx).all))
      return {
        duel: { kind: 'set', a, b, slots: lay(ctx).all, index, total: pairs.length },
        wait: null
      }
    const ready =
      lay(ctx).all.filter((s) => ctx.done.has(renderKey(a, s))).length +
      lay(ctx).all.filter((s) => ctx.done.has(renderKey(b, s))).length
    return { duel: null, wait: waitOf(ready, lay(ctx).all.length * 2) }
  }
  if (stage === 'tune' && st.tune) {
    const t = st.tune
    const step = t.artists.findIndex((a) => t.chosen[a] === undefined)
    if (step < 0) return { duel: null, wait: null }
    const artist = t.artists[step]
    const slot = lay(ctx).tune[step % lay(ctx).tune.length]
    const base = ctx.byId.get(t.baseComboId)
    const current = base?.pairs.find((p) => p.tag === artist)?.weight ?? 1
    const ids = t.options[artist] ?? []
    const options = ids.map((comboId) => ({
      comboId,
      weight: ctx.byId.get(comboId)?.pairs.find((p) => p.tag === artist)?.weight ?? current
    }))
    if (hasAll(ctx, ids, [slot]))
      return {
        duel: { kind: 'tune', artist, slot, current, options, step, total: t.artists.length },
        wait: null
      }
    return {
      duel: null,
      wait: waitOf(ids.filter((id) => ctx.done.has(renderKey(id, slot))).length, ids.length)
    }
  }
  if (stage === 'order' && st.tune?.orderIds) {
    const ids = st.tune.orderIds
    const slot = lay(ctx).tune[0]
    const options = ids.map((comboId) => ({
      comboId,
      order: (ctx.byId.get(comboId)?.pairs ?? []).map((p) => p.tag)
    }))
    if (hasAll(ctx, ids, [slot])) return { duel: { kind: 'order', slot, options }, wait: null }
    return {
      duel: null,
      wait: waitOf(ids.filter((id) => ctx.done.has(renderKey(id, slot))).length, ids.length)
    }
  }
  if (stage === 'neg' && st.baselineId != null) {
    const baselineId = st.baselineId
    const rated = new Set<string>()
    for (const v of ctx.votes)
      if (v.duel.kind === 'neg') rated.add(renderKey(v.duel.candidate, v.duel.slot))
    const cands = st.candidateIds ?? []
    const total = cands.length * lay(ctx).neg.length
    let pendingAny = false
    // 장면 순으로 돌며 후보마다 한 번씩 — 같은 후보가 연달아 나오지 않게
    for (const slot of lay(ctx).neg) {
      for (const c of cands) {
        if (rated.has(renderKey(c, slot))) continue
        pendingAny = true
        if (hasAll(ctx, [baselineId, c], [slot]))
          return {
            duel: {
              kind: 'neg',
              slot,
              baseline: baselineId,
              candidate: c,
              index: rated.size,
              total
            },
            wait: null
          }
      }
    }
    return { duel: null, wait: pendingAny ? waitOf(0, 2) : null }
  }
  return { duel: null, wait: null }
}

function missingCount(ctx: Ctx, comboIds: number[], slots: number[]): number {
  let n = 0
  for (const id of comboIds) for (const s of slots) if (!ctx.done.has(renderKey(id, s))) n++
  return n
}

function tuneArtistsFor(ctx: Ctx, comboId: number): string[] {
  const combo = ctx.byId.get(comboId)
  if (!combo) return []
  const fixed = new Set(
    listArtists()
      .filter((a) => a.fixedWeight != null)
      .map((a) => a.tag)
  )
  // 모델 효과가 큰 작가부터 — 그림체를 가장 크게 바꾸는 가중치를 먼저 맞춘다
  return combo.pairs
    .map((p) => p.tag)
    .filter((t) => !fixed.has(t))
    .sort(
      (a, b) =>
        Math.abs(ctx.model.theta.get(b)?.[0] ?? 0) - Math.abs(ctx.model.theta.get(a)?.[0] ?? 0)
    )
}

function bestFinal(ctx: Ctx): number | undefined {
  return (ctx.session.state.finalIds ?? [])
    .slice()
    .sort((a, b) => (ctx.score.get(b) ?? 0) - (ctx.score.get(a) ?? 0))[0]
}

function progressOf(ctx: Ctx): ArenaProgress {
  const { session } = ctx
  const st = session.state
  const stage = session.stage
  const renders = renderCounts(ctx)
  const stageVotes = ctx.votes.filter((v) => v.stage === stage).length
  let stageTarget = 0
  let minAppear = 0
  let ready = false
  let next: ArenaProgress['next'] = null
  if (stage === 'prelim' || stage === 'main') {
    const pool = stage === 'prelim' ? prelimPool(ctx) : (st.mainIds ?? [])
    const slots = stage === 'prelim' ? lay(ctx).all : lay(ctx).main
    const withRender = pool.filter((id) => slots.some((s) => ctx.done.has(renderKey(id, s))))
    const { appear } = stageAppear(ctx, stage)
    const need = stage === 'prelim' ? PRELIM_MIN_APPEAR : MAIN_MIN_APPEAR
    minAppear = withRender.length ? Math.min(...withRender.map((id) => appear.get(id) ?? 0)) : 0
    stageTarget = Math.ceil((pool.length * need) / 4)
    ready = withRender.length === pool.length && pool.length >= 4 && minAppear >= need
    if (stage === 'prelim') {
      const top = rankedVisible(ctx)
        .slice(0, MAIN_SIZE)
        .map((c) => c.id)
      next = { stage: 'main', newRenders: missingCount(ctx, top, lay(ctx).main) }
    } else {
      const top = (st.mainIds ?? [])
        .slice()
        .sort((a, b) => (ctx.score.get(b) ?? 0) - (ctx.score.get(a) ?? 0))
        .slice(0, FINAL_SIZE)
      next = { stage: 'final', newRenders: missingCount(ctx, top, lay(ctx).all) }
    }
  } else if (stage === 'final') {
    stageTarget = st.finalPairs?.length ?? 0
    ready = finalDone(ctx)
    const best = bestFinal(ctx)
    next = { stage: 'tune', newRenders: best != null ? tuneArtistsFor(ctx, best).length * 3 : 0 }
  } else if (stage === 'tune' && st.tune) {
    stageTarget = st.tune.artists.length
  } else if (stage === 'order') {
    stageTarget = 1
  } else if (stage === 'neg') {
    stageTarget = (st.candidateIds?.length ?? 0) * lay(ctx).neg.length
    ready = stageVotes >= stageTarget
  }
  return { stage, stageVotes, stageTarget, minAppear, ready, next, renders }
}

function comboViews(ctx: Ctx): ArenaComboView[] {
  const games = new Map<number, number>()
  for (const v of ctx.votes)
    for (const id of duelComboIds(v.duel)) games.set(id, (games.get(id) ?? 0) + 1)
  const winsN = new Map<number, { w: number; n: number }>()
  for (const c of ctx.comparisons) {
    for (const id of [c.winner, c.loser]) {
      const s = winsN.get(id) ?? { w: 0, n: 0 }
      s.n += c.weight
      s.w += c.draw ? c.weight / 2 : id === c.winner ? c.weight : 0
      winsN.set(id, s)
    }
  }
  const neg = new Map<number, { sum: number; n: number }>()
  for (const v of ctx.votes) {
    if (v.duel.kind !== 'neg' || v.result.kind !== 'neg') continue
    const s = neg.get(v.duel.candidate) ?? { sum: 0, n: 0 }
    s.sum += v.result.rating
    s.n++
    neg.set(v.duel.candidate, s)
  }
  const negative = ctx.session.target === 'negative'
  const negMean = (id: number): number => {
    const s = neg.get(id)
    return s ? s.sum / s.n : -2
  }
  const visible = negative
    ? ctx.combos
        .filter((c) => c.source === 'candidate')
        .sort((a, b) => negMean(b.id) - negMean(a.id))
    : rankedVisible(ctx)
  const rank = new Map(visible.map((c, i) => [c.id, i + 1]))
  const tiers = negative
    ? new Map()
    : assignTiers(
        visible.map((c) => ({
          id: c.id,
          stageReached: c.stageReached,
          score: ctx.score.get(c.id) ?? 0
        }))
      )
  return ctx.combos.map((c) => {
    const wn = winsN.get(c.id)
    const g = games.get(c.id) ?? 0
    const se = ctx.se.get(c.id) ?? 1
    const ns = neg.get(c.id)
    const view: ArenaComboView = {
      ...c,
      text: comboString(c.pairs),
      score: Math.round((ctx.score.get(c.id) ?? 0) * 1000) / 1000,
      se: Math.round(se * 1000) / 1000,
      rank: rank.get(c.id) ?? null,
      tier: tiers.get(c.id) ?? null,
      games: g,
      winRate: wn && wn.n > 0 ? Math.round((wn.w / wn.n) * 1000) / 1000 : null,
      consistency: consistencyOf(c.id, ctx.comparisons),
      certain: g >= 15 && se < 0.6
    }
    if (negative) {
      view.negScore = ns ? Math.round((ns.sum / ns.n) * 100) / 100 : null
      view.negRated = ns?.n ?? 0
    }
    return view
  })
}

function canUndoVote(stage: ArenaStage, voteStage: ArenaStage): boolean {
  if (stage === voteStage) return true
  // 다듬기 마지막 판 → 순서, 순서 판 → 확정은 되돌릴 수 있다
  return (
    (stage === 'order' && voteStage === 'tune') || (stage === 'confirm' && voteStage === 'order')
  )
}

function snapshotOf(ctx: Ctx): ArenaSnapshot {
  const { duel, wait } = nextDuel(ctx)
  const st = ctx.session.state
  // 편성한 판은 저장 — 새로고침·이미지 도착으로 판이 바뀌지 않게
  if (JSON.stringify(st.currentDuel ?? null) !== JSON.stringify(duel)) {
    st.currentDuel = duel
    getDb()
      .prepare('UPDATE arena_sessions SET state_json = ? WHERE id = ?')
      .run(JSON.stringify(st), ctx.session.id)
  }
  const last = ctx.votes[ctx.votes.length - 1]
  const tags = new Set<string>()
  for (const c of ctx.combos) for (const p of c.pairs) tags.add(p.tag)
  for (const a of listArtists()) tags.add(a.tag)
  const combosMap = new Map(ctx.combos.filter((c) => !c.hidden).map((c) => [c.id, c.pairs]))
  const reviveIds =
    ctx.session.stage === 'prelim'
      ? rankedVisible(ctx)
          .slice(MAIN_SIZE, MAIN_SIZE + REVIVE_COUNT)
          .map((c) => c.id)
      : []
  return {
    session: ctx.session,
    combos: comboViews(ctx),
    renders: ctx.renders,
    progress: progressOf(ctx),
    duel,
    wait,
    voteCount: ctx.votes.length,
    canUndo: last != null && canUndoVote(ctx.session.stage, last.stage),
    artistStats:
      ctx.session.target === 'negative'
        ? []
        : artistStats(ctx.model, combosMap, [...tags], ctx.session.config),
    reviveIds
  }
}

export function getSnapshot(sessionId: number): ArenaSnapshot | null {
  const ctx = buildCtx(sessionId)
  return ctx ? snapshotOf(ctx) : null
}

// ───────────────────────── 판 ─────────────────────────

export function vote(sessionId: number, result: ArenaVoteResult): ArenaSnapshot | null {
  const ctx = buildCtx(sessionId)
  if (!ctx) return null
  const { duel } = nextDuel(ctx)
  if (!duel || duel.kind !== result.kind) return snapshotOf(ctx)
  const ids = duelComboIds(duel)
  if (result.kind === 'quad' && !ids.includes(result.best)) return snapshotOf(ctx)
  if ((result.kind === 'tune' || result.kind === 'order') && !ids.includes(result.chosen))
    return snapshotOf(ctx)
  const session = ctx.session
  getDb()
    .prepare(
      'INSERT INTO arena_votes (session_id, stage, duel_json, result_json) VALUES (?, ?, ?, ?)'
    )
    .run(sessionId, session.stage, JSON.stringify(duel), JSON.stringify(result))
  const st = session.state
  st.currentDuel = null
  st.lastIds = ids
  let enqueue = false
  if (duel.kind === 'tune' && result.kind === 'tune' && st.tune) {
    const tune = st.tune
    const chosen = ctx.byId.get(result.chosen)
    tune.chosen[duel.artist] =
      chosen?.pairs.find((p) => p.tag === duel.artist)?.weight ?? duel.current
    if (tune.artists.every((a) => tune.chosen[a] !== undefined)) enqueue = startOrderStep(ctx)
  } else if (duel.kind === 'order' && result.kind === 'order' && st.tune) {
    enqueue = startConfirm(ctx, result.chosen)
  }
  saveSession(session)
  if (enqueue) enqueueMissing(sessionId)
  return getSnapshot(sessionId)
}

/** 가중치를 다 고르면 순서 후보 4개를 만든다 (작가가 1명이면 바로 확정 검증) */
function startOrderStep(ctx: Ctx): boolean {
  const t = ctx.session.state.tune
  if (!t) return false
  const base = ctx.byId.get(t.baseComboId)
  if (!base) return false
  const tuned = base.pairs.map((p) => ({ tag: p.tag, weight: t.chosen[p.tag] ?? p.weight }))
  const orders = orderCandidates(tuned, ctx.model.theta)
  const gen = base.generation + 1
  if (orders.length < 2) {
    return startConfirm(
      ctx,
      insertCombo(ctx.session.id, tuned, 'order', {
        parentId: base.id,
        generation: gen,
        hidden: true
      })
    )
  }
  t.orderIds = orders.map((pairs) =>
    insertCombo(ctx.session.id, pairs, 'order', {
      parentId: base.id,
      generation: gen,
      hidden: true
    })
  )
  for (const id of t.orderIds) ensureRender(ctx.session.id, id, lay(ctx).tune[0])
  ctx.session.stage = 'order'
  return true
}

function startConfirm(ctx: Ctx, tunedId: number): boolean {
  const t = ctx.session.state.tune
  if (!t) return false
  t.tunedComboId = tunedId
  for (const s of lay(ctx).all) ensureRender(ctx.session.id, tunedId, s)
  ctx.session.stage = 'confirm'
  return true
}

export function skip(sessionId: number): ArenaSnapshot | null {
  const ctx = buildCtx(sessionId)
  if (!ctx) return null
  const st = ctx.session.state
  const { duel } = nextDuel(ctx)
  if (duel?.kind === 'quad') {
    st.lastIds = duel.comboIds
    st.currentDuel = null
  } else if (duel?.kind === 'set' && st.finalPairs) {
    // 이 대진은 맨 뒤로
    const [pair] = st.finalPairs.splice(duel.index, 1)
    st.finalPairs.push(pair)
    st.currentDuel = null
  }
  saveSession(ctx.session)
  return getSnapshot(sessionId)
}

export function undo(sessionId: number): ArenaSnapshot | null {
  const ctx = buildCtx(sessionId)
  if (!ctx) return null
  const last = ctx.votes[ctx.votes.length - 1]
  const session = ctx.session
  if (!last || !canUndoVote(session.stage, last.stage)) return snapshotOf(ctx)
  getDb().prepare('DELETE FROM arena_votes WHERE id = ?').run(last.id)
  const st = session.state
  if (last.duel.kind === 'tune' && st.tune) {
    delete st.tune.chosen[last.duel.artist]
    st.tune.orderIds = undefined
    session.stage = 'tune'
  } else if (last.duel.kind === 'order' && st.tune) {
    st.tune.tunedComboId = undefined
    session.stage = 'order'
  }
  st.currentDuel = last.duel
  saveSession(session)
  return getSnapshot(sessionId)
}

export function advance(
  sessionId: number,
  opts: { reviveIds?: number[]; tuneComboId?: number; limit?: number }
): { snapshot: ArenaSnapshot | null; enqueue?: ArenaEnqueueResult; error?: string } {
  const ctx = buildCtx(sessionId)
  if (!ctx) return { snapshot: null, error: '세션을 찾을 수 없어요' }
  const { session } = ctx
  const st = session.state
  const db = getDb()
  const setReached = db.prepare('UPDATE arena_combos SET stage_reached = ? WHERE id = ?')
  if (session.stage === 'prelim') {
    const top = rankedVisible(ctx)
      .slice(0, MAIN_SIZE)
      .map((c) => c.id)
    const revive = (opts.reviveIds ?? [])
      .filter((id) => ctx.byId.has(id) && !top.includes(id))
      .slice(0, REVIVE_COUNT)
    const ids = [...top, ...revive]
    if (ids.length < 4) return { snapshot: snapshotOf(ctx), error: '본선에 올릴 조합이 모자라요' }
    db.transaction(() => {
      for (const id of ids) {
        setReached.run('main', id)
        for (const s of lay(ctx).main) ensureRender(sessionId, id, s)
      }
    })()
    st.mainIds = ids
    session.stage = 'main'
  } else if (session.stage === 'main') {
    const ids = (st.mainIds ?? [])
      .slice()
      .sort((a, b) => (ctx.score.get(b) ?? 0) - (ctx.score.get(a) ?? 0))
      .slice(0, FINAL_SIZE)
    if (ids.length < 2) return { snapshot: snapshotOf(ctx), error: '결선에 올릴 조합이 모자라요' }
    db.transaction(() => {
      for (const id of ids) {
        setReached.run('final', id)
        for (const s of lay(ctx).all) ensureRender(sessionId, id, s)
      }
    })()
    st.finalIds = ids
    st.finalPairs = roundRobin(ids, Math.random)
    session.stage = 'final'
  } else if (['final', 'tune', 'order', 'confirm', 'done'].includes(session.stage)) {
    // 결선이 끝난 뒤에는 순위 화면에서 다른 결선 조합으로 다듬기 대상을 바꿀 수 있다
    if (session.stage === 'final' && !finalDone(ctx) && opts.tuneComboId == null)
      return { snapshot: snapshotOf(ctx), error: '결선을 먼저 끝내 주세요' }
    const baseId = opts.tuneComboId ?? bestFinal(ctx)
    const base = baseId != null ? ctx.byId.get(baseId) : undefined
    if (!base) return { snapshot: snapshotOf(ctx), error: '다듬을 조합을 골라 주세요' }
    const artists = tuneArtistsFor(ctx, base.id)
    const options: Record<string, number[]> = {}
    db.transaction(() => {
      artists.forEach((artist, k) => {
        const current = base.pairs.find((p) => p.tag === artist)?.weight ?? 1
        const slot = lay(ctx).tune[k % lay(ctx).tune.length]
        // 기준 조합의 그 장면 이미지도 필요하다 (지금 값 칸)
        ensureRender(sessionId, base.id, slot)
        options[artist] = tuneWeights(current).map((w) => {
          const pairs = base.pairs.map((p) => (p.tag === artist ? { ...p, weight: w } : p))
          const id = insertCombo(sessionId, pairs, 'tune', {
            parentId: base.id,
            generation: base.generation + 1,
            hidden: true
          })
          ensureRender(sessionId, id, slot)
          return id
        })
      })
    })()
    st.tune = { baseComboId: base.id, artists, chosen: {}, options }
    st.confirmedComboId = undefined
    session.stage = 'tune'
    if (artists.length === 0) startOrderStep(ctx)
  } else {
    return { snapshot: snapshotOf(ctx), error: '이 단계에서는 넘어갈 수 없어요' }
  }
  st.currentDuel = null
  st.lastIds = undefined
  saveSession(session)
  const enqueue = enqueueMissing(sessionId, { limit: opts.limit })
  return { snapshot: getSnapshot(sessionId), enqueue }
}

export function retune(sessionId: number): ArenaSnapshot | null {
  const s = readSession(sessionId)
  if (!s || !s.state.tune) return getSnapshot(sessionId)
  s.state.tune.chosen = {}
  s.state.tune.orderIds = undefined
  s.state.tune.tunedComboId = undefined
  s.state.currentDuel = null
  s.stage = 'tune'
  saveSession(s)
  if (s.state.tune.artists.length === 0) {
    const ctx = buildCtx(sessionId)
    if (ctx && startOrderStep(ctx)) {
      saveSession(ctx.session)
      enqueueMissing(sessionId)
    }
  }
  return getSnapshot(sessionId)
}

export function confirm(sessionId: number): ArenaSnapshot | null {
  const s = readSession(sessionId)
  const tunedId = s?.state.tune?.tunedComboId
  if (!s || tunedId == null) return getSnapshot(sessionId)
  getDb()
    .prepare(
      "UPDATE arena_combos SET hidden = 0, favorite = 1, stage_reached = 'final', source = CASE WHEN source IN ('tune','order') THEN 'tuned' ELSE source END WHERE id = ?"
    )
    .run(tunedId)
  s.state.confirmedComboId = tunedId
  s.stage = 'done'
  saveSession(s)
  return getSnapshot(sessionId)
}

/** 새 조합 더하기 — 판 기록이 쌓였으면 모델 70 · 교배 10 · 무작위 20 */
export function addCombos(
  sessionId: number,
  count: number
): { added: number; enqueue: ArenaEnqueueResult } {
  const ctx = buildCtx(sessionId)
  if (!ctx || ctx.session.target === 'negative' || ctx.session.stage !== 'prelim')
    return { added: 0, enqueue: { queued: 0, missing: 0 } }
  const cfg = ctx.session.config
  const ranked = rankedVisible(ctx).map((c) => ({
    pairs: c.pairs,
    certain: (ctx.se.get(c.id) ?? 1) < 0.6
  }))
  const batch = generateBatch({
    count: Math.max(1, Math.min(200, Math.round(count))),
    pool: likedPool(),
    shape: cfg,
    model: ctx.model,
    ranked,
    existingKeys: new Set(ctx.combos.map((c) => c.key)),
    rng: Math.random
  })
  const perSlot = new Map<number, number>()
  for (const r of ctx.renders) perSlot.set(r.slot, (perSlot.get(r.slot) ?? 0) + 1)
  const gen = Math.max(0, ...ctx.combos.map((c) => c.generation)) + 1
  getDb().transaction(() => {
    for (const b of batch) {
      const cid = insertCombo(sessionId, b.pairs, b.source, { generation: gen })
      let slot = 0
      for (const s of lay(ctx).all) if ((perSlot.get(s) ?? 0) < (perSlot.get(slot) ?? 0)) slot = s
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1)
      ensureRender(sessionId, cid, slot)
    }
  })()
  return { added: batch.length, enqueue: enqueueMissing(sessionId) }
}
