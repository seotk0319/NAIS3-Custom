import { describe, expect, it } from 'vitest'
import {
  assertGenerationRequest,
  assertInteger,
  assertSetting,
  isAllowedExternalUrl
} from '../src/main/ipc-validation'
import type { GenerationRequest } from '../src/shared/types'

const request: GenerationRequest = {
  prompt: '1girl',
  negativePrompt: '',
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: 1,
  variety: false,
  qualityToggle: true,
  ucPreset: 0,
  characterPrompts: [],
  useCoords: false
}

describe('IPC validation', () => {
  it('rejects non-finite and out-of-range integers', () => {
    expect(() => assertInteger(Infinity, 'count', 1, 10)).toThrow()
    expect(() => assertInteger(11, 'count', 1, 10)).toThrow()
  })

  it('allows only known settings', () => {
    expect(() => assertSetting('strip_exif', '1')).not.toThrow()
    expect(() => assertSetting('arbitrary_key', '1')).toThrow(/설정 키/)
  })

  it('validates generation dimensions and source size', () => {
    expect(() => assertGenerationRequest(request)).not.toThrow()
    expect(() => assertGenerationRequest({ ...request, width: Infinity })).toThrow(/너비/)
    expect(() =>
      assertGenerationRequest({
        ...request,
        source: { imageBase64: 'A'.repeat(90_000_000), strength: 1, noise: 0 }
      })
    ).toThrow(/소스 이미지/)
  })

  it.each([
    ['https://github.com/seotk0319/NAIS3-Custom', true],
    ['https://discord.gg/example', true],
    ['javascript:alert(1)', false],
    ['file:///C:/secret.txt', false],
    ['https://example.com', false]
  ])('checks external URL %s', (url, allowed) => {
    expect(isAllowedExternalUrl(url)).toBe(allowed)
  })
})
