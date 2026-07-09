import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageMetadata } from '../src/shared/types'
import {
  modelFromMetadata,
  requestFromMetadata,
  snap64
} from '../src/renderer/src/lib/metadata-request'

describe('metadata request 유틸', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('모델명 매핑과 64 스냅은 메타데이터 복구 규칙을 유지한다', () => {
    expect(modelFromMetadata('NAI Diffusion 4.5 Curated')).toBe('nai-diffusion-4-5-curated')
    expect(modelFromMetadata('NAI Diffusion 4.5 Full')).toBe('nai-diffusion-4-5-full')
    expect(modelFromMetadata('NovelAI Diffusion Furry V3')).toBe('nai-diffusion-furry-3')
    expect(modelFromMetadata('NAI Diffusion V4 Curated')).toBe('nai-diffusion-4-curated-preview')
    expect(modelFromMetadata('NAI Diffusion V4 Full')).toBe('nai-diffusion-4-full')
    expect(modelFromMetadata('NAI Diffusion V3')).toBe('nai-diffusion-3')
    expect(modelFromMetadata('unknown')).toBe('nai-diffusion-4-5-full')
    expect(snap64(1000)).toBe(1024)
    expect(snap64(1)).toBe(64)
  })

  it('메타 기반 요청은 원문 프롬프트와 이미지 치수 스냅, 캐릭터 좌표 사용을 보존한다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const meta: ImageMetadata = {
      prompt: 'p',
      negativePrompt: 'n',
      model: 'NAI Diffusion 4.5 Full',
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      characterPrompts: [{ prompt: 'c', negativePrompt: 'cn', center: { x: 0.25, y: 0.75 } }],
      useCoords: false
    }

    const request = requestFromMetadata({
      meta,
      imageBase64: 'image',
      dimensions: { width: 1000, height: 1300 },
      strength: 0.5,
      noise: 0,
      useCoords: (meta.characterPrompts ?? []).length > 0
    })

    expect(request).toMatchObject({
      prompt: 'p',
      negativePrompt: 'n',
      model: 'nai-diffusion-4-5-full',
      width: 1024,
      height: 1280,
      steps: 28,
      cfgScale: 5,
      cfgRescale: 0,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      variety: false,
      qualityToggle: false,
      ucPreset: 4,
      characterPrompts: [
        { prompt: 'c', negativePrompt: 'cn', center: { x: 0.25, y: 0.75 }, enabled: true }
      ],
      useCoords: true,
      skipWildcards: true,
      source: { imageBase64: 'image', strength: 0.5, noise: 0 }
    })
    expect(request.promptParts).toBeUndefined()
    expect(request.seed).toBe(Math.floor(0.25 * 4294967295))
  })

  it('씬 인페인트 요청은 명시 치수와 입력 폴백을 그대로 쓴다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const request = requestFromMetadata({
      meta: {
        prompt: 'meta prompt',
        negativePrompt: 'meta neg',
        characterPrompts: [{ prompt: 'face', negativePrompt: 'bad' }],
        useCoords: false
      },
      imageBase64: 'source',
      width: 777,
      height: 555,
      maskBase64: 'mask',
      strength: 0.8,
      noise: 0,
      fallbacks: {
        steps: 31,
        cfgScale: 6,
        cfgRescale: 0.2,
        sampler: 'k_dpmpp_2m',
        noiseSchedule: 'exponential'
      }
    })

    expect(request).toMatchObject({
      prompt: 'meta prompt',
      negativePrompt: 'meta neg',
      width: 777,
      height: 555,
      steps: 31,
      cfgScale: 6,
      cfgRescale: 0.2,
      sampler: 'k_dpmpp_2m',
      noiseSchedule: 'exponential',
      useCoords: false,
      skipWildcards: true,
      source: { imageBase64: 'source', maskBase64: 'mask', strength: 0.8, noise: 0 }
    })
    expect(request.seed).toBe(Math.floor(0.5 * 4294967295))
  })
})
