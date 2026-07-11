import { describe, expect, it } from 'vitest'
import {
  planSceneZipEntries,
  sanitizeZipName,
  uniqueZipName,
  type SceneZipSource
} from '../src/main/scenes/zip-plan'

function src(partial: Partial<SceneZipSource> & { sceneId: number }): SceneZipSource {
  return { name: `씬${partial.sceneId}`, favoritePaths: [], topPath: null, ...partial }
}

describe('planSceneZipEntries — 선정 규칙 (NAIS2 방식)', () => {
  it('즐겨찾기가 있으면 전부, 최신순 그대로 내보낸다', () => {
    const entries = planSceneZipEntries([
      src({ sceneId: 1, name: '바닷가', favoritePaths: ['C:/i/9.png', 'C:/i/3.png'], topPath: 'C:/i/12.png' })
    ])
    expect(entries.map((e) => e.filePath)).toEqual(['C:/i/9.png', 'C:/i/3.png'])
  })

  it('즐겨찾기가 없으면 최상단(최신) 1장만', () => {
    const entries = planSceneZipEntries([src({ sceneId: 1, name: '바닷가', topPath: 'C:/i/12.png' })])
    expect(entries).toEqual([{ filePath: 'C:/i/12.png', name: '바닷가.png' }])
  })

  it('이미지가 하나도 없는 씬은 건너뛴다', () => {
    expect(planSceneZipEntries([src({ sceneId: 1 })])).toEqual([])
  })
})

describe('planSceneZipEntries — 이름 규칙', () => {
  it('단일 장은 씬 이름 그대로, 확장자는 원본을 따른다', () => {
    const entries = planSceneZipEntries([
      src({ sceneId: 1, name: '노을', favoritePaths: ['C:/i/a.jpg'] })
    ])
    expect(entries[0].name).toBe('노을.jpg')
  })

  it('여러 장(즐겨찾기 다수)일 때만 _1.._N 접미사', () => {
    const entries = planSceneZipEntries([
      src({ sceneId: 1, name: '노을', favoritePaths: ['C:/i/a.png', 'C:/i/b.png', 'C:/i/c.png'] })
    ])
    expect(entries.map((e) => e.name)).toEqual(['노을_1.png', '노을_2.png', '노을_3.png'])
  })

  it('확장자가 없으면 .png 폴백', () => {
    const entries = planSceneZipEntries([src({ sceneId: 1, name: '노을', topPath: 'C:/i/raw' })])
    expect(entries[0].name).toBe('노을.png')
  })

  it('금지 문자는 _로 치환, 공백뿐인 이름은 씬-<id> 폴백', () => {
    expect(sanitizeZipName('a/b:c*d', 'x')).toBe('a_b_c_d')
    expect(sanitizeZipName('   ', 'x')).toBe('x')
    const entries = planSceneZipEntries([src({ sceneId: 7, name: '  ', topPath: 'C:/i/a.png' })])
    expect(entries[0].name).toBe('씬-7.png')
  })

  it('씬 순서를 유지한 채 씬별로 이어붙인다', () => {
    const entries = planSceneZipEntries([
      src({ sceneId: 2, name: 'B', topPath: 'C:/i/b.png' }),
      src({ sceneId: 1, name: 'A', favoritePaths: ['C:/i/a1.png', 'C:/i/a2.png'] })
    ])
    expect(entries.map((e) => e.name)).toEqual(['B.png', 'A_1.png', 'A_2.png'])
  })
})

describe('uniqueZipName — 동명 씬 충돌 폴백', () => {
  it('처음 이름은 그대로, 충돌부터 _ 접두를 쌓는다', () => {
    const used = new Set<string>()
    expect(uniqueZipName('씬.png', used)).toBe('씬.png')
    expect(uniqueZipName('씬.png', used)).toBe('_씬.png')
    expect(uniqueZipName('씬.png', used)).toBe('__씬.png')
    expect(used.size).toBe(3)
  })
})
