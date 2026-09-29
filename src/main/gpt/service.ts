/**
 * GPT 이미지 작업. 누른 장 수만큼 바로 동시에 보낸다 (상한 없음).
 * ChatGPT가 잠시 기다리라고 하거나(429) 서버가 일시적으로 실패하면 그 장만 기다렸다가 다시 보낸다.
 */
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import type { GptAuthStatus, GptJob, GptRef, GptRequest } from '../../shared/gpt'
import type { HistoryItem } from '../../shared/types'
import { getDb } from '../db'
import { saveGeneratedImage } from '../images/storage'
import { GptAuthError, getCredentials } from './auth'
import { GptHttpError, GptNoImageError, requestImage } from './client'

type Broadcast = (jobs: GptJob[]) => void
type Added = (item: HistoryItem) => void

const MAX_ATTEMPTS = 6
const KEEP_FINISHED = 60
const jobs = new Map<string, GptJob>()
const controllers = new Map<string, AbortController>()
let emit: Broadcast = () => undefined
let added: Added = () => undefined

export function initGpt(broadcast: Broadcast, onAdded: Added): void {
  emit = broadcast
  added = onAdded
}

function changed(): void {
  // 끝난 작업은 최근 것만 남긴다
  const finished = [...jobs.values()].filter(
    (j) => j.state === 'done' || j.state === 'failed' || j.state === 'cancelled'
  )
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) jobs.delete(j.id)
  emit(listJobs())
}

export function listJobs(): GptJob[] {
  return [...jobs.values()]
}

export async function authStatus(): Promise<GptAuthStatus> {
  try {
    const c = await getCredentials()
    return { ready: true, email: c.email, plan: c.plan }
  } catch (e) {
    return { ready: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** 큰 레퍼런스는 긴 변 2048px로 줄인다 (요청이 너무 커지지 않게) */
async function prepareRefs(refs: GptRef[]): Promise<GptRef[]> {
  return Promise.all(
    refs.slice(0, 16).map(async (r) => {
      const buf = Buffer.from(r.b64, 'base64')
      const meta = await sharp(buf).metadata()
      const big =
        (meta.width ?? 0) > 2048 || (meta.height ?? 0) > 2048 || buf.length > 6 * 1024 * 1024
      const okMime = r.mime === 'image/png' || r.mime === 'image/jpeg' || r.mime === 'image/webp'
      if (!big && okMime) return r
      const out = await sharp(buf)
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      return { ...r, b64: out.toString('base64'), mime: 'image/png' }
    })
  )
}

export async function generate(req: GptRequest, count: number): Promise<{ ids: string[] }> {
  const prompt = req.prompt.trim()
  if (!prompt) throw new Error('프롬프트를 적어 주세요')
  const refs = await prepareRefs(req.refs)
  const n = Math.max(1, Math.min(100, Math.round(count) || 1))
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const id = randomUUID()
    jobs.set(id, {
      id,
      state: 'running',
      prompt,
      size: req.size,
      model: req.model,
      refCount: refs.length,
      startedAt: Date.now(),
      attempt: 1
    })
    ids.push(id)
    void run(id, { ...req, prompt, refs })
  }
  changed()
  return { ids }
}

export function cancel(id: string): void {
  controllers.get(id)?.abort()
  const j = jobs.get(id)
  if (j && (j.state === 'running' || j.state === 'retrying')) {
    j.state = 'cancelled'
    j.finishedAt = Date.now()
    changed()
  }
}

export function clearFinished(): void {
  for (const [id, j] of jobs) if (j.state !== 'running' && j.state !== 'retrying') jobs.delete(id)
  changed()
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

function friendly(e: unknown): string {
  if (e instanceof GptAuthError) return e.message
  if (e instanceof GptNoImageError) return '그림 대신 글로 답했어요: ' + e.message.slice(0, 160)
  if (e instanceof GptHttpError) {
    if (e.status === 429) return 'ChatGPT 사용 한도에 걸렸어요. 잠시 뒤 다시 해 주세요.'
    if (e.status === 401 || e.status === 403)
      return 'ChatGPT 로그인이 거절됐어요. Codex에서 다시 로그인해 주세요.'
    return 'ChatGPT 오류 (' + e.status + '): ' + e.message.slice(0, 160)
  }
  return e instanceof Error ? e.message : String(e)
}

function retryable(e: unknown): boolean {
  if (e instanceof GptHttpError) return e.status === 429 || e.status >= 500
  if (e instanceof GptNoImageError || e instanceof GptAuthError) return false
  // 네트워크 끊김 등
  return !(e instanceof Error && e.name === 'AbortError')
}

async function run(id: string, req: GptRequest): Promise<void> {
  const controller = new AbortController()
  controllers.set(id, controller)
  const job = (): GptJob | undefined => jobs.get(id)
  let forced = false
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const j = job()
      if (!j || controller.signal.aborted) return
      j.attempt = attempt
      try {
        const creds = await getCredentials(forced)
        const { png, revisedPrompt, sent } = await requestImage(creds, req, controller.signal)
        const now = new Date()
        const day =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0')
        const saved = await saveGeneratedImage({
          png,
          sentPayload: JSON.stringify({ ...sent, revised_prompt: revisedPrompt }),
          seed: 0,
          kind: 'gpt',
          subDir: 'gpt/' + day,
          format: 'png'
        })
        const done = job()
        if (done) {
          done.state = 'done'
          done.filePath = saved.filePath
          done.revisedPrompt = revisedPrompt
          done.finishedAt = Date.now()
          done.error = undefined
        }
        added(saved)
        changed()
        return
      } catch (e) {
        if (controller.signal.aborted) return
        // 토큰이 막 만료됐으면 한 번만 갱신해서 다시
        if (e instanceof GptHttpError && e.status === 401 && !forced) {
          forced = true
          continue
        }
        const cur = job()
        if (!cur) return
        if (!retryable(e) || attempt === MAX_ATTEMPTS) {
          cur.state = 'failed'
          cur.error = friendly(e)
          cur.finishedAt = Date.now()
          changed()
          return
        }
        const wait = Math.max(
          e instanceof GptHttpError ? e.retryAfterMs : 0,
          Math.min(60000, 5000 * 2 ** (attempt - 1))
        )
        cur.state = 'retrying'
        cur.error = friendly(e)
        cur.retryAt = Date.now() + wait
        changed()
        await sleep(wait, controller.signal)
        const again = job()
        if (again && again.state === 'retrying') {
          again.state = 'running'
          again.retryAt = undefined
          changed()
        }
      }
    }
  } finally {
    controllers.delete(id)
  }
}

/** GPT 탭 결과 목록 (최근 것부터) */
export function listImages(limit: number, offset: number): { items: HistoryItem[]; total: number } {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT id, file_path, thumbnail, kind, seed, created_at, library_folder_id FROM images WHERE kind = 'gpt' ORDER BY id DESC LIMIT ? OFFSET ?"
    )
    .all(limit, offset) as {
    id: number
    file_path: string
    thumbnail: Buffer | null
    kind: string
    seed: number | null
    created_at: string
    library_folder_id: number | null
  }[]
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM images WHERE kind = 'gpt'").get() as {
    n: number
  }
  return {
    items: rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      kind: r.kind,
      seed: r.seed,
      createdAt: r.created_at,
      virtualFolderId: r.library_folder_id
    })),
    total: n
  }
}
