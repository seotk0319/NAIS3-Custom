/**
 * GPT 이미지 (ChatGPT 로그인). Codex 로그인 파일의 토큰으로 ChatGPT의 Codex 응답 API에
 * image_generation 도구를 붙여 보낸다. 요청 모양은 ima2-gen(MIT, lidge-jun)을 참고했다.
 */

export const GPT_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini'
] as const
export type GptModel = (typeof GPT_MODELS)[number]

export const GPT_SIZES = [
  { value: 'auto', label: '자동' },
  { value: '1024x1024', label: '정사각' },
  { value: '1024x1536', label: '세로 2:3' },
  { value: '1536x1024', label: '가로 3:2' }
] as const
export type GptSize = (typeof GPT_SIZES)[number]['value']

export const GPT_QUALITIES = [
  { value: 'auto', label: '자동' },
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' }
] as const
export type GptQuality = (typeof GPT_QUALITIES)[number]['value']

/** direct: 프롬프트 그대로 / auto: 모델이 알아서 다듬기 */
export type GptPromptMode = 'direct' | 'auto'

export interface GptRef {
  /** data URL 없는 base64 */
  b64: string
  mime: string
  name?: string
}

export interface GptRequest {
  prompt: string
  refs: GptRef[]
  size: GptSize
  quality: GptQuality
  model: GptModel
  mode: GptPromptMode
}

export type GptJobState = 'running' | 'retrying' | 'done' | 'failed' | 'cancelled'

export interface GptJob {
  id: string
  state: GptJobState
  prompt: string
  size: GptSize
  model: GptModel
  refCount: number
  startedAt: number
  finishedAt?: number
  attempt: number
  /** 재시도까지 남은 시간 표시용 */
  retryAt?: number
  error?: string
  filePath?: string
  revisedPrompt?: string
}

export interface GptAuthStatus {
  ready: boolean
  email?: string
  plan?: string
  /** 준비가 안 됐을 때 안내 문구 */
  reason?: string
}
