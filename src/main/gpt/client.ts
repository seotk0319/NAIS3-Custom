/**
 * ChatGPT Codex 응답 API로 이미지 한 장을 만든다. 요청 모양은 ima2-gen(MIT)을 참고했다.
 */
import type { GptRequest } from '../../shared/gpt'
import type { GptCredentials } from './auth'

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const CLIENT_VERSION = '0.144.0'

const BASE_RULES =
  'Your only job is to call the image_generation tool once. Never reply with text only. ' +
  'Any visible text in the image (including Korean) must be spelled exactly as written in the prompt.'

const DIRECT_RULES =
  'Pass the user prompt to the image_generation tool unchanged. Do not add, remove or reinterpret anything.'

const AUTO_RULES =
  "Turn the user prompt into a clear, detailed visual prompt that keeps the user's intent, subjects, style and any quoted text exactly. Keep the user's requested style; do not default to photorealism."

export class GptHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs = 0
  ) {
    super(message)
    this.name = 'GptHttpError'
  }
}

/** 이미지가 안 오고 글만 왔을 때 (거절 등) */
export class GptNoImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GptNoImageError'
  }
}

function sizeLine(size: string): string {
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return ''
  const w = Number(m[1])
  const h = Number(m[2])
  const shape =
    w > h ? 'a wide landscape canvas' : w < h ? 'a tall portrait canvas' : 'a square canvas'
  return 'Generate it at ' + size + ' as ' + shape + '.\n\n'
}

export function buildBody(req: GptRequest): Record<string, unknown> {
  const text =
    sizeLine(req.size) +
    (req.mode === 'direct' ? 'Generate an image with this exact prompt: ' : 'Generate an image: ') +
    req.prompt
  const content = req.refs.length
    ? [
        ...req.refs.map((r) => ({
          type: 'input_image',
          image_url: 'data:' + r.mime + ';base64,' + r.b64
        })),
        { type: 'input_text', text }
      ]
    : text
  return {
    model: req.model,
    instructions: '',
    input: [
      {
        role: 'developer',
        content: BASE_RULES + ' ' + (req.mode === 'direct' ? DIRECT_RULES : AUTO_RULES)
      },
      { role: 'user', content }
    ],
    tools: [{ type: 'image_generation', quality: req.quality, size: req.size, moderation: 'low' }],
    tool_choice: 'required',
    reasoning: { effort: 'none' },
    store: false,
    stream: true
  }
}

export interface StreamResult {
  b64: string | null
  revisedPrompt?: string
  text: string
  error?: string
}

/** 서버가 보내는 이벤트 스트림(SSE)을 줄 단위로 읽는다. 조각이 줄 중간에서 끊겨도 된다 */
export class SseReader {
  private buf = ''
  result: StreamResult = { b64: null, text: '' }

  push(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      this.line(line)
    }
  }

  end(): StreamResult {
    if (this.buf.trim()) this.line(this.buf.trim())
    this.buf = ''
    return this.result
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let e: {
      type?: string
      item?: { type?: string; result?: string; revised_prompt?: string }
      text?: string
      error?: { message?: string }
      message?: string
      response?: { error?: { message?: string } }
    }
    try {
      e = JSON.parse(data)
    } catch {
      return
    }
    if (
      e.type === 'response.output_item.done' &&
      e.item?.type === 'image_generation_call' &&
      e.item.result
    ) {
      this.result.b64 = e.item.result
      if (typeof e.item.revised_prompt === 'string')
        this.result.revisedPrompt = e.item.revised_prompt
    } else if (e.type === 'response.output_text.done' && typeof e.text === 'string') {
      this.result.text += e.text
    } else if (e.type === 'error' || e.type === 'response.failed') {
      this.result.error = e.error?.message ?? e.response?.error?.message ?? e.message ?? '생성 실패'
    }
  }
}

function retryAfter(res: Response): number {
  const v = res.headers.get('retry-after')
  if (!v) return 0
  const s = Number(v)
  if (Number.isFinite(s)) return s * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : 0
}

export async function requestImage(
  creds: GptCredentials,
  req: GptRequest,
  signal: AbortSignal
): Promise<{ png: Buffer; revisedPrompt?: string; sent: Record<string, unknown> }> {
  const body = buildBody(req)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      Authorization: 'Bearer ' + creds.accessToken,
      'chatgpt-account-id': creds.accountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      version: CLIENT_VERSION,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let message = text.slice(0, 300)
    try {
      const j = JSON.parse(text) as { detail?: string; error?: { message?: string } }
      message = j.error?.message ?? j.detail ?? message
    } catch {
      // 원문 사용
    }
    throw new GptHttpError(message || 'HTTP ' + res.status, res.status, retryAfter(res))
  }
  const reader = new SseReader()
  const stream = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { value, done } = await stream.read()
    if (done) break
    reader.push(dec.decode(value, { stream: true }))
  }
  const out = reader.end()
  if (out.error) throw new GptHttpError(out.error, 500)
  if (!out.b64) throw new GptNoImageError(out.text.trim() || '그림 없이 응답이 끝났어요')
  // 저장용 기록에는 레퍼런스 이미지 원본을 넣지 않는다
  const sent = { ...body, input: '(생략)', prompt: req.prompt, refs: req.refs.length }
  return { png: Buffer.from(out.b64, 'base64'), revisedPrompt: out.revisedPrompt, sent }
}
