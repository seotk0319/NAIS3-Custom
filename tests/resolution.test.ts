import { describe, expect, it } from 'vitest'
import { MAX_NAI_PIXELS, snapNaiResolution } from '../src/main/nai/resolution'

describe('snapNaiResolution', () => {
  it.each([
    [832, 1216],
    [608, 2432],
    [2432, 608],
    [10_000, 64],
    [64, 10_000]
  ])('keeps %d x %d on the 64 grid under the pixel limit', (width, height) => {
    const result = snapNaiResolution(width, height)
    expect(result.width % 64).toBe(0)
    expect(result.height % 64).toBe(0)
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_NAI_PIXELS)
  })
})
