// DeepL API 연결부. 크롬 확장(comment-translator)의 deepl.js를 옮겼다.
// 키가 :fx로 끝나면 무료 API 주소를 쓴다. 실패는 code가 붙은 DeepLError로 던진다.
export type DeepLCode =
  | 'NO_KEY'
  | 'AUTH'
  | 'QUOTA'
  | 'RATE'
  | 'TOO_LONG'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'NETWORK'
  | 'TIMEOUT'

export class DeepLError extends Error {
  constructor(
    public code: DeepLCode,
    public status: number | null = null
  ) {
    super(code)
    this.name = 'DeepLError'
  }
}

const TIMEOUT_MS = 20_000
export const isFreeKey = (key: string): boolean => /:fx$/i.test(key.trim())
export const deeplBase = (key: string): string =>
  isFreeKey(key) ? 'https://api-free.deepl.com' : 'https://api.deepl.com'

export function codeForStatus(status: number): DeepLCode {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 456) return 'QUOTA'
  if (status === 429) return 'RATE'
  if (status === 413 || status === 414) return 'TOO_LONG'
  if (status >= 500) return 'SERVER'
  if (status >= 400) return 'BAD_REQUEST'
  return 'SERVER'
}

type Fetch = typeof fetch
async function request(
  key: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  fetcher: Fetch
): Promise<unknown> {
  if (!key.trim()) throw new DeepLError('NO_KEY')
  let response: Response
  try {
    response = await fetcher(deeplBase(key) + path, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: 'DeepL-Auth-Key ' + key.trim(),
        ...(init.body ? { 'Content-Type': 'application/json' } : {})
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const name = (error as { name?: string })?.name
    throw new DeepLError(name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK')
  }
  if (!response.ok) throw new DeepLError(codeForStatus(response.status), response.status)
  try {
    return await response.json()
  } catch {
    throw new DeepLError('SERVER', response.status)
  }
}

export async function deeplTranslate(
  key: string,
  options: { text: string; target: string; source?: string | null },
  fetcher: Fetch = fetch
): Promise<{ text: string; detected: string | null }> {
  const body: Record<string, unknown> = {
    text: [options.text],
    target_lang: options.target,
    preserve_formatting: true
  }
  if (options.source) body.source_lang = options.source
  const data = (await request(
    key,
    '/v2/translate',
    { method: 'POST', body: JSON.stringify(body) },
    fetcher
  )) as { translations?: { text?: unknown; detected_source_language?: unknown }[] }
  const first = Array.isArray(data?.translations) ? data.translations[0] : null
  if (!first || typeof first.text !== 'string') throw new DeepLError('SERVER')
  const detected =
    typeof first.detected_source_language === 'string'
      ? first.detected_source_language
      : options.source || null
  return { text: first.text, detected }
}

export async function deeplUsage(
  key: string,
  fetcher: Fetch = fetch
): Promise<{ used: number | null; limit: number | null }> {
  const data = (await request(key, '/v2/usage', { method: 'GET' }, fetcher)) as {
    character_count?: unknown
    character_limit?: unknown
  }
  return {
    used: typeof data?.character_count === 'number' ? data.character_count : null,
    limit: typeof data?.character_limit === 'number' ? data.character_limit : null
  }
}
