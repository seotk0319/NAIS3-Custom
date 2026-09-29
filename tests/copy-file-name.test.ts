import { describe, expect, it } from 'vitest'
import { fileNameOf } from '../src/renderer/src/lib/copy-file-name'

describe('fileNameOf', () => {
  it('keeps only the file name with its extension', () => {
    expect(fileNameOf('D:\\Work\\씬\\우울_20260929-213015_a1b2c3.png')).toBe(
      '우울_20260929-213015_a1b2c3.png'
    )
    expect(fileNameOf('/home/a/NAIS3_1.webp')).toBe('NAIS3_1.webp')
  })
})
