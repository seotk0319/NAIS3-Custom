import { describe, expect, it } from 'vitest'
import { resolveInside, sanitizePathSegment } from '../src/main/images/safe-path'

describe('sanitizePathSegment', () => {
  it.each([
    ['.', 'fallback'],
    ['..', 'fallback'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['a:b', 'a_b'],
    ['a?b', 'a_b'],
    ['name. ', 'name'],
    ['\u0000hello', 'hello']
  ])('normalizes %j', (input, expected) => {
    expect(sanitizePathSegment(input, 'fallback')).toBe(expected)
  })

  it('normalizes unicode before creating a segment', () => {
    expect(sanitizePathSegment('ＡＢＣ', 'fallback')).toBe('ABC')
  })
})

describe('resolveInside', () => {
  it('keeps a child inside the root', () => {
    expect(resolveInside('C:/root', 'child', 'file.png')).toMatch(/root[\\/]child[\\/]file\.png$/)
  })

  it.each(['.', '..', '../escape', 'C:/escape'])('rejects %j', (segment) => {
    expect(() => resolveInside('C:/root', segment)).toThrow(/루트/)
  })
})
