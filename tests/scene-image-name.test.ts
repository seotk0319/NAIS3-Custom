import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { afterAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'nais3-scene-name-'))
const rows: { file_path: string }[] = []

vi.mock('electron', () => ({ app: { getPath: () => root, getName: () => 'NAIS3' } }))
vi.mock('../src/main/db/settings', () => ({
  getSetting: (key: string) => (key === 'scene_save_dir' ? root : null)
}))
vi.mock('../src/main/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => (sql.includes('LIKE') ? rows : []),
      get: () => undefined,
      run: (filePath: string) => {
        if (rows.some((r) => r.file_path.toLowerCase() === filePath.toLowerCase()))
          throw new Error('UNIQUE constraint failed: images.file_path')
        rows.push({ file_path: filePath })
        return { lastInsertRowid: rows.length }
      }
    })
  })
}))

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('scene image names', () => {
  it('skips names still recorded in the DB after the files were moved out of the folder', async () => {
    const { saveGeneratedImage } = await import('../src/main/images/storage')
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
    const save = (): Promise<{ filePath: string }> =>
      saveGeneratedImage({ png, sentPayload: '{}', seed: 1, kind: 'scene', sceneId: 7, sceneName: '우울', scenePresetName: '프리셋' })

    const a = await save()
    const b = await save()
    // 선별: 두 파일을 폴더 밖으로 옮긴다 (DB 기록은 그대로)
    const dir = join(root, '프리셋', '우울')
    for (const f of readdirSync(dir)) rmSync(join(dir, f))
    const c = await save()

    expect(a.filePath.endsWith('우울.png')).toBe(true)
    expect(b.filePath.endsWith('우울_2.png')).toBe(true)
    expect(c.filePath.endsWith('우울_3.png')).toBe(true)
    expect(readdirSync(dir)).toEqual(['우울_3.png'])
  })
})

