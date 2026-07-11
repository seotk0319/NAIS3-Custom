import { randomUUID } from 'crypto'
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { isAbsolute, join, relative } from 'path'
import sharp from 'sharp'
import { backupNow, getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'

/**
 * NAIS3 데이터 내보내기/가져오기 (백업/이전).
 * 외부 백업은 데이터일 뿐 SQL 스키마나 로컬 파일 경로로 신뢰하지 않는다.
 */

const TABLES = [
  'character_folders',
  'character_prompts',
  'fragment_folders',
  'fragments',
  'vibe_folders',
  'vibe_images',
  'charref_folders',
  'charref_images',
  'scene_presets',
  'gen_scenes',
  'prompt_presets'
] as const

type TableName = (typeof TABLES)[number]
type Row = Record<string, unknown>

const IMAGE_TABLES = new Set<TableName>(['vibe_images', 'charref_images'])

// 외부 키는 절대 SQL 식별자로 사용하지 않는다. id/file_path/encoded는 의도적으로 제외한다.
const ALLOWED_COLUMNS: Record<TableName, readonly string[]> = {
  character_folders: ['name', 'sort_order', 'collapsed', 'color'],
  character_prompts: [
    'name',
    'prompt',
    'negative_prompt',
    'folder',
    'thumbnail',
    'settings_json',
    'sort_order',
    'created_at',
    'updated_at',
    'enabled',
    'center_x',
    'center_y',
    'folder_id'
  ],
  fragment_folders: ['name', 'sort_order', 'collapsed', 'color'],
  fragments: ['name', 'content', 'folder', 'sort_order', 'created_at', 'updated_at', 'folder_id'],
  vibe_folders: ['name', 'sort_order', 'collapsed', 'color'],
  vibe_images: [
    'name',
    'enabled',
    'strength',
    'info_extracted',
    'folder_id',
    'sort_order',
    'created_at'
  ],
  charref_folders: ['name', 'sort_order', 'collapsed', 'color'],
  charref_images: [
    'name',
    'enabled',
    'ref_type',
    'strength',
    'fidelity',
    'folder_id',
    'sort_order',
    'created_at'
  ],
  scene_presets: ['name', 'sort_order', 'default_width', 'default_height'],
  gen_scenes: [
    'name',
    'prompt',
    'negative_prompt',
    'width',
    'height',
    'sort_order',
    'created_at',
    'updated_at',
    'preset_id',
    'reserve_count'
  ],
  prompt_presets: [
    'name',
    'prompt',
    'negative_prompt',
    'sort_order',
    'base_prompt',
    'params_json',
    'prompt_parts_json'
  ]
}

const FOREIGN_KEYS: Partial<Record<TableName, Record<string, TableName>>> = {
  character_prompts: { folder_id: 'character_folders' },
  fragments: { folder_id: 'fragment_folders' },
  vibe_images: { folder_id: 'vibe_folders' },
  charref_images: { folder_id: 'charref_folders' },
  gen_scenes: { preset_id: 'scene_presets' }
}

const MAX_ROWS = 100_000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 1024 * 1024 * 1024
const MAX_IMAGE_PIXELS = 64_000_000
const MAX_BLOB_BYTES = 4 * 1024 * 1024
const MAX_MAIN_PARAMS = 2 * 1024 * 1024

interface PreparedImage {
  table: TableName
  rowIndex: number
  stagePath: string
  finalPath: string
  thumbnail: Buffer
}

function encodeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { __blob: value.toString('base64') }
  return value
}

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('__blob' in value)) return value
  const encoded = (value as { __blob?: unknown }).__blob
  if (typeof encoded !== 'string' || encoded.length > Math.ceil((MAX_BLOB_BYTES * 4) / 3) + 8) {
    throw new Error('백업 BLOB 크기 제한을 초과했습니다')
  }
  const decoded = decodeBase64(encoded)
  if (decoded.length > MAX_BLOB_BYTES) throw new Error('백업 BLOB 크기 제한을 초과했습니다')
  return decoded
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('유효하지 않은 base64 데이터입니다')
  }
  return Buffer.from(value, 'base64')
}

export function exportAll(): Record<string, unknown> {
  const db = getDb()
  const tables: Record<string, Row[]> = {}
  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Row[]
    tables[table] = rows.map((source) => {
      const output: Row = {}
      for (const [key, value] of Object.entries(source)) output[key] = encodeValue(value)
      if (IMAGE_TABLES.has(table) && typeof source.file_path === 'string') {
        try {
          output.__image = readFileSync(source.file_path).toString('base64')
        } catch {
          output.__image = null
        }
      }
      return output
    })
  }
  return {
    _app: 'NAIS3',
    _version: 1,
    mainParams: getSetting('main_params') || null,
    tables
  }
}

/** 기존 라이브러리를 안전하게 교체한다. 외부 id/path/cache는 복원하지 않는다. */
export async function importAll(
  data: Record<string, unknown>
): Promise<{ imported: number; skipped: number; backupPath: string }> {
  const rawTables = isRecord(data.tables) ? data.tables : {}
  const refsRoot = join(app.getPath('userData'), 'refs')
  const finalDir = join(refsRoot, 'imported')
  const stageDir = join(refsRoot, `.import-${randomUUID()}`)
  mkdirSync(stageDir, { recursive: true })
  mkdirSync(finalDir, { recursive: true })

  let rowCount = 0
  let totalImageBytes = 0
  let skipped = 0
  const preparedImages = new Map<string, PreparedImage>()

  try {
    for (const table of TABLES) {
      const rows = rawTables[table]
      if (!Array.isArray(rows)) continue
      rowCount += rows.length
      if (rowCount > MAX_ROWS) throw new Error(`백업 행 개수 제한(${MAX_ROWS})을 초과했습니다`)

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const raw = rows[rowIndex]
        if (!isRecord(raw)) throw new Error(`${table}[${rowIndex}] 행 형식이 올바르지 않습니다`)
        if (!IMAGE_TABLES.has(table)) continue
        if (typeof raw.__image !== 'string') {
          skipped++
          continue
        }
        if (raw.__image.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) {
          throw new Error(`${table}[${rowIndex}] 이미지 크기 제한을 초과했습니다`)
        }
        const image = decodeBase64(raw.__image)
        if (image.length === 0 || image.length > MAX_IMAGE_BYTES) {
          throw new Error(`${table}[${rowIndex}] 이미지 크기 제한을 초과했습니다`)
        }
        totalImageBytes += image.length
        if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
          throw new Error('백업 이미지 전체 크기 제한을 초과했습니다')
        }

        const metadata = await sharp(image, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
        const width = metadata.width ?? 0
        const height = metadata.height ?? 0
        if (
          width <= 0 ||
          height <= 0 ||
          width * height > MAX_IMAGE_PIXELS ||
          !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')
        ) {
          throw new Error(`${table}[${rowIndex}] 지원하지 않는 이미지입니다`)
        }
        const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format!
        const fileName = `${randomUUID()}.${extension}`
        const stagePath = join(stageDir, fileName)
        const finalPath = join(finalDir, fileName)
        writeFileSync(stagePath, image, { flag: 'wx' })
        const thumbnail = await sharp(image, { limitInputPixels: MAX_IMAGE_PIXELS })
          .resize(192, 192, { fit: 'cover' })
          .webp({ quality: 82 })
          .toBuffer()
        preparedImages.set(`${table}:${rowIndex}`, {
          table,
          rowIndex,
          stagePath,
          finalPath,
          thumbnail
        })
      }
    }

    const backupPath = backupNow()
    const db = getDb()
    const oldRefPaths = (
      db
        .prepare(`SELECT file_path FROM vibe_images UNION ALL SELECT file_path FROM charref_images`)
        .all() as { file_path: string }[]
    ).map((entry) => entry.file_path)
    const movedPaths: string[] = []
    let imported = 0

    const replace = db.transaction(() => {
      for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run()

      const idMaps = new Map<TableName, Map<string, number>>()
      for (const table of TABLES) idMaps.set(table, new Map())
      let fallbackPresetId: number | null = null

      for (const table of TABLES) {
        const rows = rawTables[table]
        if (!Array.isArray(rows)) continue
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const raw = rows[rowIndex]
          if (!isRecord(raw)) continue
          const prepared = preparedImages.get(`${table}:${rowIndex}`)
          if (IMAGE_TABLES.has(table) && !prepared) continue

          const row: Row = {}
          for (const column of ALLOWED_COLUMNS[table]) {
            if (!(column in raw)) continue
            row[column] = decodeValue(raw[column])
          }

          for (const [column, parentTable] of Object.entries(FOREIGN_KEYS[table] ?? {})) {
            const original = raw[column]
            const remapped = idMaps.get(parentTable)?.get(String(original))
            if (column === 'preset_id') {
              if (remapped !== undefined) row[column] = remapped
              else {
                if (fallbackPresetId === null) {
                  fallbackPresetId = Number(
                    db
                      .prepare(`INSERT INTO scene_presets (name, sort_order) VALUES ('기본', -1)`)
                      .run().lastInsertRowid
                  )
                }
                row[column] = fallbackPresetId
              }
            } else {
              row[column] = remapped ?? null
            }
          }

          if (prepared) {
            renameSync(prepared.stagePath, prepared.finalPath)
            movedPaths.push(prepared.finalPath)
            row.file_path = prepared.finalPath
            row.thumbnail = prepared.thumbnail
            // 가져온 이미지가 복원 직후 외부 API로 자동 전송되지 않게 명시적으로 비활성화한다.
            row.enabled = 0
          }

          const columns = Object.keys(row)
          if (columns.length === 0) continue
          const placeholders = columns.map(() => '?').join(', ')
          const result = db
            .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
            .run(...columns.map((column) => row[column] as never))
          imported++
          if (raw.id !== undefined) {
            idMaps.get(table)!.set(String(raw.id), Number(result.lastInsertRowid))
          }
        }
      }

      if (
        typeof data.mainParams === 'string' &&
        Buffer.byteLength(data.mainParams, 'utf8') <= MAX_MAIN_PARAMS
      ) {
        setSetting('main_params', data.mainParams)
      }
    })

    try {
      replace()
    } catch (error) {
      for (const filePath of movedPaths) rmSync(filePath, { force: true })
      throw error
    }

    const newPaths = new Set(movedPaths)
    for (const oldPath of oldRefPaths) {
      if (!newPaths.has(oldPath) && isInside(refsRoot, oldPath)) {
        try {
          unlinkSync(oldPath)
        } catch {
          // 이미 없는 내부 파일은 무시한다.
        }
      }
    }
    rmSync(stageDir, { recursive: true, force: true })
    return { imported, skipped, backupPath }
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true })
    throw error
  }
}

function isRecord(value: unknown): value is Row {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isInside(parent: string, child: string): boolean {
  if (!existsSync(parent) || !isAbsolute(child)) return false
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
