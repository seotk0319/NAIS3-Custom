import { app } from 'electron'
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import sharp from 'sharp'
import type { DirectorMethod, HistoryItem, ImageMetadata } from '../../shared/types'
import { getDb } from '../db'
import { getSetting } from '../db/settings'
import { sanitizeImageMetadata } from './strip-metadata'

/**
 * 생성 이미지 저장 규칙 (P3의 핵심):
 * - 원본 PNG는 디스크 파일로만. base64를 어디에도 상주시키지 않는다.
 * - DB에는 경로·시드·전송 payload 원본·소형 썸네일(webp BLOB)만.
 */

export interface SavedImage extends HistoryItem {}

/** 기본 저장 폴더 (설정 미지정 시) */
export function defaultImagesRoot(): string {
  return join(app.getPath('pictures'), app.getName())
}

/**
 * 메인 모드 저장 폴더.
 * - 미지정: 기본폴더/NAIS3_output
 * - 지정(save_dir): 그 폴더에 바로 쌓임 (하위 폴더 자동 생성 없음 — 유저가 고른 곳 그대로)
 */
export function imagesRoot(): string {
  const custom = getSetting('save_dir')
  return custom && custom.trim() ? custom : join(defaultImagesRoot(), 'NAIS3_output')
}

/** 씬 모드 저장 루트 — 미지정이면 기본폴더/NAIS3_scene, 지정(scene_save_dir)이면 그 폴더 */
export function scenesRoot(): string {
  const custom = getSetting('scene_save_dir')
  return custom && custom.trim() ? custom : join(defaultImagesRoot(), 'NAIS3_scene')
}

/** 앱 내부 라이브러리 폴더 — 자동 저장 OFF일 때 저장 위치 (히스토리엔 남지만 저장 폴더엔 안 감) */
export function libraryRoot(): string {
  return join(app.getPath('userData'), 'library')
}

/** 씬 이미지 폴더 경로: 프리셋명/씬명 */
export function sceneDir(
  presetName: string | null,
  sceneName: string,
  sceneId?: number
): string {
  const clean = (value: string, fallback: string): string =>
    value.replace(/[/\\:*?"<>|]/g, '_').trim() || fallback
  const preset = clean(presetName ?? '', '기본')
  const scene = clean(sceneName, `씬-${sceneId ?? 0}`)
  return join(scenesRoot(), preset, scene)
}

export async function saveGeneratedImage(input: {
  png: Buffer
  sentPayload: string
  seed: number
  // 디렉터 결과는 개별 req_type(bg-removal 등)을 kind로 저장 → 히스토리 뱃지가 툴별로 표시
  kind: 't2i' | 'i2i' | 'inpaint' | 'scene' | 'upscale' | 'director' | 'mosaic' | DirectorMethod
  sceneId?: number
  /** 저장 파일 확장자 (NAI가 반환한 실제 포맷). 기본 png */
  format?: 'png' | 'webp'
  /** 씬 생성이면 씬 이름 — 씬루트/<프리셋>/<씬 이름>/ 아래에 저장 (NAIS2 구조와 동일 계층) */
  sceneName?: string
  /** 씬이 속한 프리셋 이름 (프리셋 간 동명 씬 충돌 방지) */
  scenePresetName?: string
  /** 전송 payload에는 없는 NAIS3 전용 왕복 메타데이터 */
  localMetadata?: Pick<ImageMetadata, 'promptParts'>
}): Promise<SavedImage> {
  const now = new Date()
  // 자동 저장 OFF면 저장 폴더 대신 앱 내부 라이브러리에 보관 (히스토리엔 남지만
  // 유저가 지정한 저장 폴더/NAIS3_output에는 안 감). 씬·일반·디렉터·업스케일 모두 여기서 판정.
  const autoSave = getSetting('auto_save') !== '0'
  // 구조: 메인 = 메인폴더/[YYYY-MM/] (날짜 폴더는 설정으로 on/off),
  //       씬 = 씬루트/<프리셋>/<씬 이름>/
  let monthDir: string
  if (input.sceneName) {
    monthDir = autoSave
      ? sceneDir(input.scenePresetName ?? null, input.sceneName, input.sceneId)
      : join(libraryRoot(), 'scene')
  } else {
    const out = autoSave ? imagesRoot() : libraryRoot()
    monthDir =
      getSetting('date_folders') !== '0'
        ? join(out, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
        : out
  }
  mkdirSync(monthDir, { recursive: true })

  const ext = input.format ?? 'png'
  let filePath = ''
  const stripExif = getSetting('strip_exif') === '1'
  const metadataBuffer =
    ext === 'png' && input.localMetadata && !stripExif
      ? injectNais3Params(input.png, input.localMetadata)
      : input.png
  const fileBuffer = stripExif ? await sanitizeImageMetadata(metadataBuffer, ext) : metadataBuffer

  if (input.sceneName) {
    // 씬 이미지는 첫 장은 씬 이름 그대로, 중복부터 씬 이름_2, _3 ...
    const safeName = input.sceneName.replace(/[/\\:*?"<>|]/g, '_').trim() || `씬-${input.sceneId ?? 0}`
    let max = 0
    const escaped = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const firstRe = new RegExp(`^${escaped}\\.`)
    const numberedRe = new RegExp(`^${escaped}_(\\d+)\\.`)
    for (const f of readdirSync(monthDir)) {
      if (firstRe.test(f)) max = Math.max(max, 1)
      const m = numberedRe.exec(f)
      if (m) max = Math.max(max, Number(m[1]))
    }
    for (;;) {
      const name = max === 0 ? `${safeName}.${ext}` : `${safeName}_${max + 1}.${ext}`
      filePath = join(monthDir, name)
      try {
        writeFileSync(filePath, fileBuffer, { flag: 'wx' })
        break
      } catch (error) {
        if (!isFileExistsError(error)) throw error
        max++
      }
    }
  } else {
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    filePath = join(monthDir, `NAIS3_${stamp}_${input.seed}_${randomUUID().slice(0, 8)}.${ext}`)
    writeFileSync(filePath, fileBuffer, { flag: 'wx' })
  }

  try {
    // 히스토리/라이브러리용 소형 썸네일. 씬 카드는 원본 경로를 직접 사용한다.
    const thumbnail = await sharp(input.png)
      .resize(512, 512, { fit: 'inside' })
      .webp({ quality: 82 })
      .toBuffer()

    const insert = getDb().prepare(
      'INSERT INTO images (file_path, thumbnail, kind, seed, payload_json, scene_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const values = [
      filePath,
      thumbnail,
      input.kind,
      input.seed,
      payloadWithLocalMetadata(input.sentPayload, input.localMetadata)
    ] as const
    let result
    try {
      result = insert.run(...values, input.sceneId ?? null)
    } catch (error) {
      // 생성 완료 직전에 씬이 삭제된 경우 이미지는 일반 히스토리로 보존한다.
      if (!input.sceneId || !isForeignKeyError(error)) throw error
      result = insert.run(...values, null)
    }
    return {
      id: Number(result.lastInsertRowid),
      filePath,
      thumbnail: thumbnail.toString('base64'),
      kind: input.kind,
      seed: input.seed,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    try {
      unlinkSync(filePath)
    } catch {
      // 저장 실패 cleanup 중 이미 없어진 파일은 무시한다.
    }
    throw error
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}

function isForeignKeyError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  )
}

function payloadWithLocalMetadata(
  sentPayload: string,
  localMetadata?: Pick<ImageMetadata, 'promptParts'>
): string {
  if (!localMetadata) return sentPayload
  try {
    return JSON.stringify({ ...JSON.parse(sentPayload), nais3: localMetadata })
  } catch {
    return sentPayload
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const NAIS3_KEYWORD = 'nais3-params'
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function textChunk(keyword: string, value: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(value, 'latin1')
  ])
  const type = Buffer.from('tEXt', 'ascii')
  const out = Buffer.alloc(4 + 4 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  type.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return out
}

function injectNais3Params(png: Buffer, meta: Pick<ImageMetadata, 'promptParts'>): Buffer {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIG)) return png
  const value = Buffer.from(JSON.stringify({ version: 1, ...meta }), 'utf8').toString('base64')
  const chunk = textChunk(NAIS3_KEYWORD, value)
  const ihdrEnd = 33
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)])
}

export function listImages(limit: number, offset: number): { items: HistoryItem[]; total: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS c FROM images').get() as { c: number }).c
  const rows = db
    .prepare(
      `SELECT id, file_path, thumbnail, kind, seed, created_at
       FROM images ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as {
    id: number
    file_path: string
    thumbnail: Buffer | null
    kind: string
    seed: number | null
    created_at: string
  }[]

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      kind: r.kind,
      seed: r.seed,
      createdAt: r.created_at
    }))
  }
}

export function getImagePayload(id: number): string | null {
  const row = getDb().prepare('SELECT payload_json FROM images WHERE id = ?').get(id) as
    { payload_json: string } | undefined
  return row?.payload_json ?? null
}
