import { describe, expect, it } from 'vitest'
import {
  MANGA_H,
  MANGA_W,
  autoLayout,
  mergePolys,
  pageRect,
  pointInPoly,
  polyArea,
  polyCenter,
  readingOrder,
  splitPoly
} from '../src/shared/manga'

const inside = (poly: [number, number][]): boolean =>
  poly.every(([x, y]) => x >= 39.5 && y >= 39.5 && x <= MANGA_W - 39.5 && y <= MANGA_H - 39.5)

describe('manga panels', () => {
  it('splits a panel along a slanted line and leaves a gutter between the halves', () => {
    const rect = pageRect()
    const parts = splitPoly(rect, [0, 500], [MANGA_W, 700], 24)
    expect(parts).not.toBeNull()
    const [a, b] = parts!
    const total = polyArea(rect)
    // 두 조각 + 여백 띠 = 원래 칸
    expect(polyArea(a) + polyArea(b)).toBeLessThan(total)
    expect(polyArea(a) + polyArea(b)).toBeGreaterThan(total - 24 * 900)
    expect(pointInPoly(polyCenter(a), b)).toBe(false)
  })

  it('refuses a split that would leave a sliver', () => {
    expect(splitPoly(pageRect(), [0, 60], [MANGA_W, 60], 24)).toBeNull()
  })

  it('merging the two halves covers the original panel again', () => {
    const [a, b] = splitPoly(pageRect(), [300, 0], [500, MANGA_H], 24)!
    expect(polyArea(mergePolys(a, b))).toBeCloseTo(polyArea(pageRect()), -2)
  })

  it('reads top row first, then left to right', () => {
    const [top, bottom] = readingOrder(splitPoly(pageRect(), [0, 600], [MANGA_W, 600])!)
    expect(polyCenter(top)[1]).toBeLessThan(polyCenter(bottom)[1])
    const [l, r] = readingOrder(splitPoly(top, [400, 0], [420, MANGA_H])!)
    expect(polyCenter(l)[0]).toBeLessThan(polyCenter(r)[0])
  })

  it('auto layout gives one panel per cut inside the page, in reading order, for 1 to 6 cuts', () => {
    for (let n = 1; n <= 6; n++) {
      for (const seed of [1, 2, 3, 99]) {
        const polys = autoLayout(n, { seed })
        expect(polys).toHaveLength(n)
        for (const p of polys) {
          expect(inside(p)).toBe(true)
          expect(polyArea(p)).toBeGreaterThan(150 * 150)
        }
        expect(readingOrder(polys).map((p) => polyCenter(p))).toEqual(
          polys.map((p) => polyCenter(p))
        )
      }
    }
  })

  it('gives the emphasized cut its own, larger row', () => {
    const plain = autoLayout(4, { seed: 5 })
    const big = autoLayout(4, { seed: 5, emphasis: 1 })
    expect(big).toHaveLength(4)
    expect(polyArea(big[1])).toBeGreaterThan(polyArea(plain[1]))
  })
})
