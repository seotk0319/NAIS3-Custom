import { describe, expect, it } from 'vitest'
import {
  buildDisplayRows,
  canonicalize,
  moveRow,
  rowKey
} from '../src/renderer/src/lib/folder-list'
import type { ListFolder } from '../src/shared/types'

const folders: ListFolder[] = [
  { id: 1, name: 'A', collapsed: false },
  { id: 2, name: 'B', collapsed: false }
]
const items = [
  { id: 10, folderId: null },
  { id: 11, folderId: 1 },
  { id: 12, folderId: 1 },
  { id: 13, folderId: 2 }
]

function keys(f: ListFolder[], i: { id: number; folderId: number | null }[]): string[] {
  return buildDisplayRows(f, i).map(rowKey)
}

describe('폴더 리스트 이동 로직', () => {
  it('정규 순서: 미분류 → 폴더1(아이템) → 폴더2(아이템)', () => {
    expect(keys(folders, items)).toEqual(['i-10', 'f-1', 'i-11', 'i-12', 'f-2', 'i-13'])
  })

  it('아이템을 다른 폴더로 이동하면 소속이 바뀐다', () => {
    const r = moveRow(folders, items, 'i-11', 'i-13')
    expect(r.items.find((i) => i.id === 11)?.folderId).toBe(2)
    expect(keys(r.folders, canonicalize(r.folders, r.items))).toEqual([
      'i-10', 'f-1', 'i-12', 'f-2', 'i-13', 'i-11'
    ])
  })

  it('아이템을 첫 폴더 위로 올리면 미분류가 된다', () => {
    const r = moveRow(folders, items, 'i-12', 'i-10')
    expect(r.items.find((i) => i.id === 12)?.folderId).toBeNull()
  })

  it('폴더 이동 시 소속 아이템이 블록째 따라간다', () => {
    const r = moveRow(folders, items, 'f-1', 'f-2')
    expect(keys(r.folders, r.items)).toEqual(['i-10', 'f-2', 'i-13', 'f-1', 'i-11', 'i-12'])
  })

  it('폴더를 미분류 아이템 위로 올리면 폴더 순서만 바뀐다 (미분류는 항상 최상단)', () => {
    const r = moveRow(folders, items, 'f-2', 'i-10')
    expect(r.folders.map((f) => f.id)).toEqual([2, 1])
    expect(keys(r.folders, r.items)).toEqual(['i-10', 'f-2', 'i-13', 'f-1', 'i-11', 'i-12'])
  })
})
