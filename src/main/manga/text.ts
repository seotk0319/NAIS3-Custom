/**
 * NovelAI 글 모델 (text.novelai.net OpenAI 호환 채팅). 한 번에 받으면 본문이 비어서 오므로 스트리밍으로 받는다.
 * Xialong이 구독 등급 때문에 거절되면 GLM-4.6으로 한 번 바꿔 보낸다 (NAIMangaMaker와 같은 규칙).
 */
const ENDPOINT = 'https://text.novelai.net/oa/v1/chat/completions'

export type TextModel = 'xialong-v1' | 'glm-4-6'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const XIALONG_SYSTEM =
  "You are Xialong (夏龍), an AI model finetuned by Anlatan. You follow the user's instructions precisely while bringing creativity, nuance, and depth to every response. Adapt your voice and style to match what the task demands."

const denied = new Map<string, number>()

export class TextModelError extends Error {
  constructor(
    message: string,
    public readonly raw = ''
  ) {
    super(message)
    this.name = 'TextModelError'
  }
}

async function stream(
  token: string,
  model: TextModel,
  messages: ChatMessage[],
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model,
      temperature: model === 'xialong-v1' ? 0.75 : 0.3,
      max_tokens: maxTokens,
      enable_thinking: false,
      stream: true,
      messages
    })
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    const err = new TextModelError('글 모델 요청 실패 (' + res.status + ')', body.slice(0, 400))
    ;(err as TextModelError & { status: number }).status = res.status
    throw err
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let finish: string | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let event: {
        error?: unknown
        choices?: { delta?: { content?: string }; text?: string; finish_reason?: string | null }[]
      }
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      if (event.error)
        throw new TextModelError('글 모델이 오류를 보냈어요', JSON.stringify(event.error))
      for (const c of event.choices ?? []) {
        text += c.delta?.content ?? c.text ?? ''
        if (c.finish_reason) finish = c.finish_reason
      }
    }
  }
  if (finish === 'length')
    throw new TextModelError('응답이 길이 제한에 걸려 끊겼어요. 컷 수를 줄여 다시 해 주세요.', text)
  if (!finish)
    throw new TextModelError('응답이 끝나기 전에 연결이 끊겼어요. 다시 시도해 주세요.', text)
  return text
}

/** 시스템 문장 하나 + 사용자 과제로 글 모델을 부른다. Xialong 등급 거절이면 GLM으로 바꾼다. */
export async function chat(
  token: string,
  model: TextModel,
  task: string,
  opts: { maxTokens?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4096
  const key = token.slice(-12)
  const until = denied.get(key) ?? 0
  const useModel: TextModel = model === 'xialong-v1' && until > Date.now() ? 'glm-4-6' : model
  const messages = (m: TextModel): ChatMessage[] => [
    {
      role: 'system',
      content: m === 'xialong-v1' ? XIALONG_SYSTEM : 'You are a helpful assistant.'
    },
    { role: 'user', content: task }
  ]
  try {
    return await stream(token, useModel, messages(useModel), maxTokens, opts.signal)
  } catch (e) {
    const status = (e as { status?: number }).status
    const raw = e instanceof TextModelError ? e.raw : ''
    if (
      useModel === 'xialong-v1' &&
      status === 400 &&
      /not allowed for current user tier/i.test(raw)
    ) {
      denied.set(key, Date.now() + 10 * 60 * 1000)
      return stream(token, 'glm-4-6', messages('glm-4-6'), maxTokens, opts.signal)
    }
    throw e
  }
}

/** 응답에서 JSON 객체 하나를 꺼낸다 (코드 울타리·앞뒤 설명 허용) */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let s = raw.trim()
  const fence = s.match(/\u0060\u0060\u0060(?:json)?\s*([\s\S]*?)\u0060\u0060\u0060/)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start)
    throw new TextModelError('글 모델 응답에서 JSON을 찾지 못했어요', raw)
  const body = s.slice(start, end + 1)
  try {
    const v = JSON.parse(body)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // 끝의 쉼표 같은 흔한 실수만 고쳐 본다
    try {
      const v = JSON.parse(body.replace(/,\s*([}\]])/g, '$1'))
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      // 아래에서 알린다
    }
  }
  throw new TextModelError('글 모델 응답의 JSON을 읽지 못했어요', raw)
}
