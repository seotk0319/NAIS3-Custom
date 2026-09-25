import type {
  LibraryDateGroup,
  LibraryStackSummary,
  LibraryVirtualFolder
} from '../../shared/types'
import { getDb } from '../db'

interface FolderRow {
  id: number
  name: string
  parent_id: number | null
  collapsed: number
  sort_order: number
}

export function listLibraryDates(): LibraryDateGroup[] {
  // images 한 줄엔 썸네일 BLOB이 들어 있어 표를 훑으면 3만 장에 3~5초 본체가 멈췄다.
  // created_at 인덱스만 읽어(covering) UTC 10분 단위로 묶고, 월드컵 이미지는 kind 인덱스로 따로 빼며,
  // 로컬 날짜 변환은 여기서 한다 (시간대가 :30·:45인 곳도 맞게).
  const db = getDb()
  const all = db
    .prepare('SELECT substr(created_at, 1, 15) AS bucket, COUNT(*) AS count FROM images GROUP BY bucket')
    .all() as { bucket: string; count: number }[]
  const arena = db
    .prepare(
      "SELECT substr(created_at, 1, 15) AS bucket, COUNT(*) AS count FROM images WHERE kind = 'arena' GROUP BY bucket"
    )
    .all() as { bucket: string; count: number }[]
  const minus = new Map(arena.map((r) => [r.bucket, r.count]))
  const rows = all.map((r) => ({ bucket: r.bucket, count: r.count - (minus.get(r.bucket) ?? 0) }))
  const byDate = new Map<string, number>()
  for (const r of rows) {
    if (r.count <= 0) continue
    const d = new Date(r.bucket.replace(' ', 'T') + '0:00Z')
    if (Number.isNaN(d.getTime())) continue
    const key = localDateKey(d)
    byDate.set(key, (byDate.get(key) ?? 0) + r.count)
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, count]) => ({ date, count }))
}

function localDateKey(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

/** 로컬 날짜(YYYY-MM-DD) 하루를 created_at(UTC 'YYYY-MM-DD HH:MM:SS') 범위로 — 인덱스를 탄다 */
export function localDateRange(date: string): [string, string] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const fmt = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ')
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const day = Number(m[3])
  return [fmt(new Date(y, mo, day)), fmt(new Date(y, mo, day + 1))]
}

export function listLibraryFolders(): {
  folders: LibraryVirtualFolder[]
  stacks: LibraryStackSummary[]
} {
  const db = getDb()
  const folders = (
    db
      .prepare(
        `SELECT id, name, parent_id, collapsed, sort_order
         FROM library_virtual_folders
         ORDER BY parent_id IS NOT NULL, parent_id, sort_order, id`
      )
      .all() as FolderRow[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    collapsed: row.collapsed === 1,
    sortOrder: row.sort_order
  }))

  const stackRows = db
    .prepare(
      `SELECT s.id, s.name, s.folder_id,
              COUNT(li.id) AS image_count,
              (SELECT thumbnail FROM library_images latest
               WHERE latest.stack_id = s.id AND latest.thumbnail IS NOT NULL
               ORDER BY latest.sort_order DESC, latest.id DESC LIMIT 1) AS thumbnail
       FROM library_stacks s
       LEFT JOIN library_images li ON li.stack_id = s.id
       GROUP BY s.id
       ORDER BY s.id DESC`
    )
    .all() as {
    id: number
    name: string
    folder_id: number | null
    image_count: number
    thumbnail: Buffer | null
  }[]

  return {
    folders,
    stacks: stackRows.map((row) => ({
      id: row.id,
      name: row.name,
      thumbnail: row.thumbnail?.toString('base64') ?? '',
      imageCount: row.image_count,
      virtualFolderId: row.folder_id
    }))
  }
}

export function createLibraryFolder(name: string, parentId: number | null): number {
  const db = getDb()
  const parent = parentId == null ? null : existingFolderId(parentId)
  const max = db
    .prepare(
      parent == null
        ? 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM library_virtual_folders WHERE parent_id IS NULL'
        : 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM library_virtual_folders WHERE parent_id = ?'
    )
    .get(...(parent == null ? [] : [parent])) as { m: number }
  return Number(
    db
      .prepare('INSERT INTO library_virtual_folders (name, parent_id, sort_order) VALUES (?, ?, ?)')
      .run(cleanName(name), parent, max.m + 1).lastInsertRowid
  )
}

export function renameLibraryFolder(id: number, name: string): void {
  getDb()
    .prepare('UPDATE library_virtual_folders SET name = ? WHERE id = ?')
    .run(cleanName(name), id)
}

export function collapseLibraryFolder(id: number, collapsed: boolean): void {
  getDb()
    .prepare('UPDATE library_virtual_folders SET collapsed = ? WHERE id = ?')
    .run(collapsed ? 1 : 0, id)
}

export function moveLibraryFolder(id: number, parentId: number | null): boolean {
  if (parentId === id || !existingFolderId(id)) return false
  const parent = parentId == null ? null : existingFolderId(parentId)
  if (parentId != null && parent == null) return false

  // 자기 하위로 이동하면 순환 트리가 되므로 거부한다.
  let cursor = parent
  while (cursor != null) {
    if (cursor === id) return false
    const row = getDb()
      .prepare('SELECT parent_id FROM library_virtual_folders WHERE id = ?')
      .get(cursor) as { parent_id: number | null } | undefined
    cursor = row?.parent_id ?? null
  }

  const max = getDb()
    .prepare(
      parent == null
        ? 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM library_virtual_folders WHERE parent_id IS NULL'
        : 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM library_virtual_folders WHERE parent_id = ?'
    )
    .get(...(parent == null ? [] : [parent])) as { m: number }
  getDb()
    .prepare('UPDATE library_virtual_folders SET parent_id = ?, sort_order = ? WHERE id = ?')
    .run(parent, max.m + 1, id)
  return true
}

export function deleteLibraryFolder(id: number): void {
  const db = getDb()
  const row = db.prepare('SELECT parent_id FROM library_virtual_folders WHERE id = ?').get(id) as
    { parent_id: number | null } | undefined
  if (!row) return
  db.transaction(() => {
    db.prepare('UPDATE images SET library_folder_id = ? WHERE library_folder_id = ?').run(
      row.parent_id,
      id
    )
    db.prepare('UPDATE library_stacks SET folder_id = ? WHERE folder_id = ?').run(row.parent_id, id)
    db.prepare('UPDATE library_virtual_folders SET parent_id = ? WHERE parent_id = ?').run(
      row.parent_id,
      id
    )
    db.prepare('DELETE FROM library_virtual_folders WHERE id = ?').run(id)
  })()
}

export function assignLibraryEntries(input: {
  imageIds?: number[]
  stackIds?: number[]
  folderId: number | null
}): void {
  const db = getDb()
  const folderId = input.folderId == null ? null : existingFolderId(input.folderId)
  const imageIds = uniqueIds(input.imageIds)
  const stackIds = uniqueIds(input.stackIds)
  db.transaction(() => {
    if (imageIds.length > 0) {
      db.prepare(
        `UPDATE images SET library_folder_id = ? WHERE id IN (${imageIds.map(() => '?').join(',')})`
      ).run(folderId, ...imageIds)
    }
    if (stackIds.length > 0) {
      db.prepare(
        `UPDATE library_stacks SET folder_id = ? WHERE id IN (${stackIds.map(() => '?').join(',')})`
      ).run(folderId, ...stackIds)
    }
  })()
}

function existingFolderId(id: number): number | null {
  return getDb().prepare('SELECT id FROM library_virtual_folders WHERE id = ?').pluck().get(id) ==
    null
    ? null
    : id
}

function uniqueIds(ids?: number[]): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isInteger(id) && id > 0))]
}

function cleanName(name: string): string {
  return name.trim().slice(0, 120) || '새 폴더'
}
