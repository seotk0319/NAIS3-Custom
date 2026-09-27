/**
 * 만화 탭 서비스: 작품 저장(DB 한 줄에 JSON), 글 모델 작업, 페이지 그리기 대기열 연결, 자동 이어 쓰기.
 */
import { randomUUID } from 'crypto'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { shell } from 'electron'
import { getDb } from '../db'
import { getNaiAccounts } from '../db/settings'
import type { GenerationQueue } from '../queue/generation-queue'
import type { GenerationRequest, QueueStatus } from '../../shared/types'
import {
  MANGA_MAX_PANELS,
  pageLayout,
  placePanels,
  type MangaBrief,
  type MangaCastInput,
  type MangaDialogueMode,
  type MangaIntent,
  type MangaPage,
  type MangaPanel,
  type MangaProject,
  type MangaSnapshot,
  type MangaSummary,
  type Poly
} from '../../shared/manga'
import { buildPageRequest, composePage } from './render'
import { propose, writeNext, writeStart } from './story'

type Emit = (payload: { projectId: number }) => void

let queue: GenerationQueue | null = null
let emit: Emit = () => undefined
const busy = new Map<number, string>()
const lastError = new Map<number, string>()
const locks = new Map<number, Promise<unknown>>()
/** 대기열 id → 그리는 페이지 */
const queued = new Map<string, { projectId: number; pageId: string; layout: Poly[] }>()
const autoRunning = new Set<number>()
const autoBase = new Map<number, GenerationRequest>()

export function initManga(q: GenerationQueue, broadcast: Emit): void {
  queue = q
  emit = broadcast
  // 대기열은 메모리에만 있다 — 지난 실행에서 그리던 페이지는 다시 그릴 수 있게 되돌린다
  const rows = getDb().prepare('SELECT id, data_json FROM manga_projects').all() as {
    id: number
    data_json: string
  }[]
  for (const r of rows) {
    const p = parse(r.id, r.data_json)
    if (!p) continue
    let changed = false
    for (const page of p.pages) {
      if (page.state === 'queued') {
        page.state = page.filePath ? 'done' : 'draft'
        changed = true
      }
    }
    if (p.auto) {
      p.auto = false
      changed = true
    }
    if (changed) write(p)
  }
  q.on('changed', onQueueChanged)
}

function onQueueChanged(status: QueueStatus): void {
  if (queued.size === 0) return
  for (const item of status.items) {
    const ref = queued.get(item.id)
    if (!ref) continue
    if (item.state === 'failed' || item.state === 'cancelled') {
      queued.delete(item.id)
      mutate(ref.projectId, (p) => {
        const page = p.pages.find((x) => x.id === ref.pageId)
        if (!page) return
        page.state = page.filePath ? 'done' : 'failed'
        page.error = item.state === 'cancelled' ? '취소했어요' : (item.error ?? '그리지 못했어요')
      })
    }
  }
}

// ───────────────────────── 저장 ─────────────────────────

function parse(id: number, json: string): MangaProject | null {
  try {
    const p = JSON.parse(json) as MangaProject
    p.id = id
    return p
  } catch {
    return null
  }
}

function read(id: number): MangaProject | null {
  const row = getDb().prepare('SELECT data_json FROM manga_projects WHERE id = ?').get(id) as
    { data_json: string } | undefined
  return row ? parse(id, row.data_json) : null
}

function write(p: MangaProject): void {
  p.updatedAt = new Date().toISOString()
  getDb()
    .prepare(
      "UPDATE manga_projects SET title = ?, data_json = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(p.title, JSON.stringify(p), p.id)
}

function mutate(id: number, fn: (p: MangaProject) => void): MangaProject | null {
  const p = read(id)
  if (!p) return null
  fn(p)
  write(p)
  emit({ projectId: id })
  return p
}

function snapshot(p: MangaProject): MangaSnapshot {
  return { project: p, busy: busy.get(p.id) ?? null, lastError: lastError.get(p.id) ?? null }
}

/** 같은 작품의 글 모델 작업은 하나씩 */
function locked<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  locks.set(id, next)
  return next
}

async function withBusy<T>(id: number, message: string, fn: () => Promise<T>): Promise<T> {
  busy.set(id, message)
  lastError.delete(id)
  emit({ projectId: id })
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    lastError.set(id, msg)
    throw new Error(msg)
  } finally {
    busy.delete(id)
    emit({ projectId: id })
  }
}

function token(): string {
  const t = getNaiAccounts()[0]?.token?.trim()
  if (!t) throw new Error('설정에서 NAI 계정 토큰을 먼저 등록해 주세요')
  return t
}

function newSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

const newPageId = (): string => 'g' + randomUUID().slice(0, 8)

// ───────────────────────── 읽기 ─────────────────────────

export function listProjects(): MangaSummary[] {
  const rows = getDb()
    .prepare('SELECT id, data_json FROM manga_projects ORDER BY updated_at DESC, id DESC')
    .all() as { id: number; data_json: string }[]
  return rows
    .map((r) => parse(r.id, r.data_json))
    .filter((p): p is MangaProject => !!p)
    .map((p) => ({
      id: p.id,
      title: p.title,
      pages: p.pages.length,
      targetPages: p.brief.targetPages,
      drawn: p.pages.filter((g) => g.filePath).length,
      ended: p.ended,
      updatedAt: p.updatedAt,
      cover: p.pages.find((g) => g.filePath)?.filePath
    }))
}

export function getSnapshot(id: number): MangaSnapshot | null {
  const p = read(id)
  return p ? snapshot(p) : null
}

// ───────────────────────── 이야기 ─────────────────────────

function clampBrief(b: MangaBrief): MangaBrief {
  const n = (v: number, lo: number, hi: number, d: number): number =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d
  const maxCuts = n(b.maxCuts, 1, MANGA_MAX_PANELS, 4)
  return {
    seed: String(b.seed ?? '').slice(0, 6000),
    direction: String(b.direction ?? '').slice(0, 400),
    place: String(b.place ?? '').slice(0, 400),
    action: String(b.action ?? '').slice(0, 400),
    stateChange: String(b.stateChange ?? '').slice(0, 400),
    dialogue: b.dialogue === 'with' || b.dialogue === 'none' ? b.dialogue : 'auto',
    targetPages: n(b.targetPages, 1, 40, 6),
    minCuts: Math.min(n(b.minCuts, 1, MANGA_MAX_PANELS, 2), maxCuts),
    maxCuts,
    startCuts: n(b.startCuts, 1, 4, 2)
  }
}

export async function createProject(input: {
  brief: MangaBrief
  cast: MangaCastInput[]
  style: { prompt: string; negative: string }
}): Promise<MangaSnapshot> {
  const brief = clampBrief(input.brief)
  if (!brief.seed.trim()) throw new Error('어떤 이야기인지 한 줄이라도 적어 주세요')
  const now = new Date().toISOString()
  const info = getDb()
    .prepare("INSERT INTO manga_projects (title, data_json) VALUES (?, '{}')")
    .run('새 이야기')
  const id = Number(info.lastInsertRowid)
  const project: MangaProject = {
    id,
    title: '새 이야기',
    brief,
    cast: [],
    setting: brief.place,
    style: { prompt: input.style.prompt ?? '', negative: input.style.negative ?? '' },
    panels: [],
    pages: [],
    ended: false,
    proposal: null,
    auto: false,
    autoRender: false,
    createdAt: now,
    updatedAt: now
  }
  write(project)
  emit({ projectId: id })
  try {
    await locked(id, () =>
      withBusy(id, '글 모델이 첫 컷을 쓰고 있어요', async () => {
        const start = await writeStart(token(), brief, input.cast)
        mutate(id, (p) => {
          p.title = start.title
          p.setting = start.setting
          p.cast = start.cast
          p.panels = start.panels
          p.ended = start.ended
          p.pages = placePanels([], start.panels, { ...brief, newId: newPageId, newSeed })
        })
      })
    )
  } catch (e) {
    // 첫 컷을 못 받으면 빈 작품은 남기지 않는다
    getDb().prepare('DELETE FROM manga_projects WHERE id = ?').run(id)
    throw e
  }
  return getSnapshot(id)!
}

export function expand(
  id: number,
  req: {
    count: number
    intent: MangaIntent
    dialogue: MangaDialogueMode
    instruction?: string
    finish?: boolean
  }
): Promise<MangaSnapshot> {
  return locked(id, () =>
    withBusy(id, req.finish ? '마무리 컷을 쓰고 있어요' : '다음 컷을 쓰고 있어요', async () => {
      const p = read(id)
      if (!p) throw new Error('작품을 찾지 못했어요')
      const count = Math.max(1, Math.min(2, Math.round(req.count)))
      const next = await writeNext(token(), p, { ...req, count })
      mutate(id, (q) => {
        q.panels.push(...next.panels)
        q.pages = placePanels(q.pages, next.panels, { ...q.brief, newId: newPageId, newSeed })
        q.ended = req.finish ? true : next.ended
        q.proposal = null
      })
      return getSnapshot(id)!
    })
  )
}

export function proposeNext(id: number): Promise<MangaSnapshot> {
  return locked(id, () =>
    withBusy(id, '편집자가 다음 컷을 고르고 있어요', async () => {
      const p = read(id)
      if (!p) throw new Error('작품을 찾지 못했어요')
      const proposal = await propose(token(), p)
      mutate(id, (q) => {
        q.proposal = proposal
      })
      return getSnapshot(id)!
    })
  )
}

export async function acceptProposal(id: number): Promise<MangaSnapshot> {
  const p = read(id)
  const pr = p?.proposal
  if (!p || !pr) throw new Error('받을 제안이 없어요')
  if (pr.action === 'stop') {
    mutate(id, (q) => {
      q.ended = true
      q.proposal = null
    })
    return getSnapshot(id)!
  }
  return expand(id, {
    count: pr.count,
    intent: pr.intent,
    dialogue: pr.dialogue,
    instruction: pr.instruction,
    finish: pr.action === 'finish'
  })
}

// ───────────────────────── 편집 ─────────────────────────

export function updatePanel(
  id: number,
  panelId: string,
  patch: Partial<
    Pick<
      MangaPanel,
      'description' | 'descriptionKo' | 'dialogueKo' | 'importance' | 'framing' | 'angle'
    >
  >
): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    const panel = q.panels.find((x) => x.id === panelId)
    if (!panel) return
    Object.assign(panel, patch)
    if (patch.dialogueKo !== undefined && !patch.dialogueKo) panel.speaker = null
    else if (patch.dialogueKo && !panel.speaker) panel.speaker = panel.subjects[0] ?? null
    const page = q.pages.find((g) => g.panelIds.includes(panelId))
    if (page && patch.importance !== undefined) page.layout = null
  })
  return p ? snapshot(p) : null
}

export function deletePanel(id: number, panelId: string): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    q.panels = q.panels.filter((x) => x.id !== panelId)
    for (const g of q.pages) {
      if (g.panelIds.includes(panelId)) {
        g.panelIds = g.panelIds.filter((x) => x !== panelId)
        g.layout = null
      }
    }
    q.pages = q.pages.filter((g) => g.panelIds.length > 0 || g.filePath)
  })
  return p ? snapshot(p) : null
}

/** 컷을 앞 페이지 끝 / 다음 페이지 처음으로 옮긴다 */
export function movePanel(id: number, panelId: string, dir: -1 | 1): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    const i = q.pages.findIndex((g) => g.panelIds.includes(panelId))
    if (i < 0) return
    const page = q.pages[i]
    const at = page.panelIds.indexOf(panelId)
    if (dir === -1) {
      // 페이지의 첫 컷만 앞 페이지로 갈 수 있다 (읽는 순서 유지)
      if (i === 0 || at !== 0) return
      const prev = q.pages[i - 1]
      if (prev.panelIds.length >= MANGA_MAX_PANELS) return
      prev.panelIds.push(panelId)
      prev.layout = null
    } else {
      // 이 컷부터 뒤는 다음 페이지로
      const moving = page.panelIds.slice(at)
      if (at === 0 && i === q.pages.length - 1) return
      let next = q.pages[i + 1]
      if (
        !next ||
        next.state !== 'draft' ||
        next.panelIds.length + moving.length > MANGA_MAX_PANELS
      ) {
        next = { id: newPageId(), panelIds: [], layout: null, seed: newSeed(), state: 'draft' }
        q.pages.splice(i + 1, 0, next)
      }
      next.panelIds.unshift(...moving)
      next.layout = null
      page.panelIds = page.panelIds.slice(0, at)
    }
    page.panelIds = page.panelIds.filter((x) => x !== panelId || dir === 1)
    page.layout = null
    q.pages = q.pages.filter((g) => g.panelIds.length > 0)
  })
  return p ? snapshot(p) : null
}

export function setLayout(id: number, pageId: string, layout: Poly[] | null): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    const page = q.pages.find((g) => g.id === pageId)
    if (!page) return
    page.layout = layout && layout.length === page.panelIds.length ? layout : null
  })
  return p ? snapshot(p) : null
}

export function setSeed(id: number, pageId: string): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    const page = q.pages.find((g) => g.id === pageId)
    if (page) page.seed = newSeed()
  })
  return p ? snapshot(p) : null
}

export function updateProject(
  id: number,
  patch: Partial<Pick<MangaProject, 'title' | 'style' | 'ended' | 'cast'>> & {
    brief?: Partial<MangaBrief>
  }
): MangaSnapshot | null {
  const p = mutate(id, (q) => {
    if (patch.title !== undefined) q.title = patch.title.slice(0, 60) || q.title
    if (patch.style) q.style = patch.style
    if (patch.ended !== undefined) q.ended = patch.ended
    if (patch.cast) q.cast = patch.cast
    if (patch.brief) q.brief = clampBrief({ ...q.brief, ...patch.brief })
  })
  return p ? snapshot(p) : null
}

export function deleteProject(id: number): void {
  for (const [qid, ref] of queued) if (ref.projectId === id) queue?.cancel([qid])
  getDb().prepare('DELETE FROM manga_projects WHERE id = ?').run(id)
}

// ───────────────────────── 그리기 ─────────────────────────

export async function renderPage(
  id: number,
  pageId: string,
  base: GenerationRequest
): Promise<{ ok: boolean; reason?: string }> {
  const p = read(id)
  const page = p?.pages.find((g) => g.id === pageId)
  if (!p || !page || !queue) return { ok: false, reason: '페이지를 찾지 못했어요' }
  if (page.state === 'queued') return { ok: false, reason: '이미 그리는 중이에요' }
  if (page.panelIds.length === 0) return { ok: false, reason: '컷이 없는 페이지예요' }
  const layout = pageLayout(page, p.panels)
  const request = await buildPageRequest(p, page, base)
  request.mangaPage = { projectId: id, pageId }
  const result = queue.tryEnqueueQuick(request)
  if (result.blockedReason || !result.ids[0])
    return { ok: false, reason: result.blockedReason ?? '대기열에 넣지 못했어요' }
  queued.set(result.ids[0], { projectId: id, pageId, layout })
  mutate(id, (q) => {
    const g = q.pages.find((x) => x.id === pageId)
    if (!g) return
    g.state = 'queued'
    g.error = undefined
  })
  return { ok: true }
}

/** 대기열 파이프라인이 원본을 저장한 뒤 부른다: 완성 페이지를 만들어 붙인다 */
export async function mangaPageSaved(
  ref: { projectId: number; pageId: string },
  rawPath: string
): Promise<void> {
  let layout: Poly[] | null = null
  for (const [qid, r] of queued) {
    if (r.projectId === ref.projectId && r.pageId === ref.pageId) {
      layout = r.layout
      queued.delete(qid)
    }
  }
  const p = read(ref.projectId)
  const page = p?.pages.find((g) => g.id === ref.pageId)
  if (!p || !page) return
  const polys = layout ?? pageLayout(page, p.panels)
  const out = rawPath.replace(/\.(png|webp)$/i, '') + '_page.png'
  try {
    await writeFile(out, await composePage(await readFile(rawPath), polys))
  } catch (e) {
    mutate(ref.projectId, (q) => {
      const g = q.pages.find((x) => x.id === ref.pageId)
      if (!g) return
      g.state = 'failed'
      g.error = '페이지 정리 실패: ' + (e instanceof Error ? e.message : String(e))
    })
    return
  }
  mutate(ref.projectId, (q) => {
    const g = q.pages.find((x) => x.id === ref.pageId)
    if (!g) return
    g.state = 'done'
    g.filePath = out
    g.rawPath = rawPath
    g.error = undefined
    if (polys.length === g.panelIds.length) g.layout = polys
  })
}

export function mangaSubDir(projectId: number): string {
  const p = read(projectId)
  const safe =
    (p?.title ?? 'manga')
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .slice(0, 40) || 'manga'
  return 'manga/' + projectId + '_' + safe
}

// ───────────────────────── 자동 이어 쓰기 ─────────────────────────

/** 완성된 페이지를 읽는 순서대로 01.png, 02.png…로 모아 폴더를 연다 */
export async function exportPages(id: number): Promise<{ folder: string | null; count: number }> {
  const p = read(id)
  const pages = p?.pages.filter((g) => g.filePath) ?? []
  if (!p || pages.length === 0) return { folder: null, count: 0 }
  const safe =
    p.title
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .slice(0, 40) || 'manga'
  const folder = join(dirname(pages[0].filePath!), safe + ' 완성본')
  await mkdir(folder, { recursive: true })
  let n = 0
  for (const g of pages) {
    n++
    await copyFile(g.filePath!, join(folder, String(n).padStart(2, '0') + '.png'))
  }
  void shell.openPath(folder)
  return { folder, count: n }
}

export function setAuto(
  id: number,
  opts: { auto: boolean; autoRender: boolean; base?: GenerationRequest }
): MangaSnapshot | null {
  if (opts.base) autoBase.set(id, opts.base)
  const p = mutate(id, (q) => {
    q.auto = opts.auto
    q.autoRender = opts.autoRender
  })
  if (opts.auto) void runAuto(id)
  return p ? snapshot(p) : null
}

function pageFull(p: MangaProject, page: MangaPage): boolean {
  return page.panelIds.length >= p.brief.maxCuts
}

async function renderReady(id: number): Promise<void> {
  const p = read(id)
  const base = autoBase.get(id)
  if (!p || !p.autoRender || !base) return
  const pages = p.pages.filter(
    (g, i) =>
      g.state === 'draft' && !g.filePath && (i < p.pages.length - 1 || p.ended || pageFull(p, g))
  )
  for (const g of pages) await renderPage(id, g.id, base)
}

async function runAuto(id: number): Promise<void> {
  if (autoRunning.has(id)) return
  autoRunning.add(id)
  try {
    for (let step = 0; step < 60; step++) {
      const p = read(id)
      if (!p || !p.auto || p.ended) break
      if (p.pages.length > p.brief.targetPages + 1) break
      await proposeNext(id)
      const again = read(id)
      if (!again?.auto) break
      await acceptProposal(id)
      await renderReady(id)
    }
  } catch {
    // 오류는 lastError로 화면에 보인다
  } finally {
    autoRunning.delete(id)
    mutate(id, (q) => {
      q.auto = false
    })
    await renderReady(id)
  }
}
