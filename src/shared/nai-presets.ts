import type { UcPresetIndex } from './types'

/**
 * NAI 웹이 클라이언트에서 병합하는 프리셋 텍스트 (실캡처 확정).
 * payload 조립(메인)과 토큰 카운트 표시(렌더러)가 공유한다 —
 * 카운트는 병합 "후" 텍스트 기준이어야 웹 표시와 일치한다.
 */

/** 실캡처 확정 (V4.5 full): 프롬프트 "뒤"에 그대로 이어 붙는다 */
export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'

const UC_HEAVY =
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

/** 인덱스 매핑 (실캡처): 0=Heavy, 1=Light, 3=Human Focus, 4=None. 2는 미사용 */
export const UC_PRESETS_V45_FULL: Record<UcPresetIndex, string> = {
  0: UC_HEAVY,
  1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  2: '',
  3: UC_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy',
  4: ''
}

/** 줄 맨 앞(선행 공백 허용)이 #인 주석 줄만 제거한다. 줄 중간의 #은 NAI 문법으로 보존한다. */
export function removeComments(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

/**
 * V5 투명 배경 (NAI 웹 코드 확인): 켜면 퀄리티 접미사 "앞"에 이 태그가 붙는다.
 * 퀄리티 태그가 꺼져 있으면 이 태그만 붙는다.
 */
export const TRANSPARENT_BG_TAG = 'transparent background'

export function mergeQualityTags(
  prompt: string,
  qualityToggle: boolean,
  transparentBackground = false
): string {
  if (!transparentBackground) return qualityToggle ? prompt + QUALITY_TAGS_SUFFIX : prompt
  const suffix = TRANSPARENT_BG_TAG + (qualityToggle ? QUALITY_TAGS_SUFFIX : '')
  return prompt ? prompt + ', ' + suffix : suffix
}

/** 병합된 프롬프트에서 퀄리티·투명 배경 접미사를 떼어 원문과 스위치 상태를 돌려준다. */
export function splitQualityTags(prompt: string): {
  prompt: string
  quality: boolean
  transparent: boolean
} {
  let rest = prompt
  const quality = rest.endsWith(QUALITY_TAGS_SUFFIX)
  if (quality) rest = rest.slice(0, -QUALITY_TAGS_SUFFIX.length)
  let transparent = false
  if (rest === TRANSPARENT_BG_TAG) {
    rest = ''
    transparent = true
  } else if (rest.endsWith(', ' + TRANSPARENT_BG_TAG)) {
    rest = rest.slice(0, -(TRANSPARENT_BG_TAG.length + 2))
    transparent = true
  }
  // 투명 배경 없이 퀄리티만 켠 경우는 예전 형식 그대로 (접미사가 ", "로 시작)
  return { prompt: rest, quality, transparent }
}

/** 캡처 확정: 프리셋 텍스트 + ", " + 유저 네거티브 순서로 병합 */
export function mergeUcPreset(negativePrompt: string, ucPreset: UcPresetIndex): string {
  const preset = UC_PRESETS_V45_FULL[ucPreset]
  if (!preset) return negativePrompt
  return negativePrompt ? preset + ', ' + negativePrompt : preset
}
