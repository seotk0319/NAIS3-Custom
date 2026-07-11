import type { GenerationRequest } from '../shared/types'

export const MAX_QUEUE_BATCH = 1_000
export const MAX_QUEUE_MANY = 10_000
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 64_000_000

export const SETTING_KEYS = new Set([
  'alert_native',
  'alert_sound',
  'auto_save',
  'date_folders',
  'gen_delay_ms',
  'gen_streaming',
  'history_delete_file',
  'image_format',
  'main_params',
  'mosaic_brush',
  'mosaic_pixel',
  'nai_tier',
  'prompt_size',
  'prompt_split_enabled',
  'shortcuts',
  'strip_exif',
  'ui_font',
  'ui_hidden_pages',
  'ui_left_open',
  'ui_right_open',
  'ui_size',
  'ui_theme',
  'ui_theme_preset'
])

export function assertInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} 값이 허용 범위를 벗어났습니다`)
  }
}

export function assertString(
  value: unknown,
  name: string,
  maximumBytes: number
): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new Error(`${name} 문자열 크기 제한을 초과했습니다`)
  }
}

export function assertSetting(key: unknown, value?: unknown): asserts key is string {
  if (typeof key !== 'string' || !SETTING_KEYS.has(key)) {
    throw new Error('허용되지 않은 설정 키입니다')
  }
  if (value !== undefined) {
    const limit = key === 'main_params' ? 2 * 1024 * 1024 : 256 * 1024
    assertString(value, '설정값', limit)
  }
}

export function assertGenerationRequest(request: GenerationRequest): void {
  if (!request || typeof request !== 'object') throw new Error('생성 요청 형식이 올바르지 않습니다')
  assertString(request.prompt, '프롬프트', 2 * 1024 * 1024)
  assertString(request.negativePrompt, '네거티브 프롬프트', 2 * 1024 * 1024)
  assertString(request.model, '모델', 128)
  assertInteger(request.width, '너비', 64, 32_768)
  assertInteger(request.height, '높이', 64, 32_768)
  if (request.width * request.height > MAX_IMAGE_PIXELS) {
    throw new Error('생성 요청 픽셀 수 제한을 초과했습니다')
  }
  assertInteger(request.steps, '스텝', 1, 100)
  assertInteger(request.seed, '시드', 0, 4_294_967_295)
  if (!Array.isArray(request.characterPrompts) || request.characterPrompts.length > 6) {
    throw new Error('캐릭터 프롬프트 개수 제한을 초과했습니다')
  }
  if (request.extraCharRefs && request.extraCharRefs.length > 16) {
    throw new Error('추가 레퍼런스 개수 제한을 초과했습니다')
  }
  if (request.source) {
    assertBase64Size(request.source.imageBase64, '소스 이미지')
    if (request.source.maskBase64) assertBase64Size(request.source.maskBase64, '인페인트 마스크')
  }
}

export function assertBase64Size(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${name} 형식이 올바르지 않습니다`)
  const raw = value.replace(/^data:[^,]+,/, '')
  if (raw.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) {
    throw new Error(`${name} 크기 제한을 초과했습니다`)
  }
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      ['github.com', 'discord.gg', 'patreon.com', 'www.patreon.com'].includes(url.hostname)
    )
  } catch {
    return false
  }
}
