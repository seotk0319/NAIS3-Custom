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
  return getDb()
    .prepare(
      `SELECT date(created_at, 'localtime') AS date, COUNT(*) AS count
       FROM images
       GROUP BY date(created_at, 'localtime')
       ORDER BY date DESC`
    )
    .all() as LibraryDateGroup[]
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
