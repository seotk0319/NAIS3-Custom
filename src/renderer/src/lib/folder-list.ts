import type { CharacterOrderEntry, ListFolder } from '@shared/types'

/**
 * 캐릭터/조각 공용 "폴더 리스트" 모델의 순수 로직.
 * - 정규 순서: [미분류 아이템..., 폴더1, 폴더1 아이템..., 폴더2, ...]
 * - 아이템의 폴더 소속은 "직전 폴더 행"에서 파생 (첫 폴더 위 = 미분류)
 * - 폴더 이동 시 소속 아이템이 블록으로 함께 이동한다
 */

export interface FolderListItem {
  id: number
  folderId: number | null
}

export type DisplayRow<T extends FolderListItem> =
  | { type: 'folder'; folder: ListFolder }
  | { type: 'item'; item: T; hidden: boolean }

export function rowKey<T extends FolderListItem>(row: DisplayRow<T>): string {
  return row.type === 'folder' ? `f-${row.folder.id}` : `i-${row.item.id}`
}

export function canonicalize<T extends FolderListItem>(folders: ListFolder[], items: T[]): T[] {
  const roots = items.filter((c) => c.folderId == null)
  return [...roots, ...folders.flatMap((f) => items.filter((c) => c.folderId === f.id))]
}

export function buildDisplayRows<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[]
): DisplayRow<T>[] {
  const rows: DisplayRow<T>[] = items
    .filter((c) => c.folderId == null)
    .map((item) => ({ type: 'item' as const, item, hidden: false }))
  for (const folder of folders) {
    rows.push({ type: 'folder', folder })
    for (const item of items.filter((c) => c.folderId === folder.id)) {
      rows.push({ type: 'item', item, hidden: folder.collapsed })
    }
  }
  return rows
}

interface Block<T extends FolderListItem> {
  folder: ListFolder | null // null = 미분류 단일 아이템 블록
  items: T[]
}

function toBlocks<T extends FolderListItem>(folders: ListFolder[], items: T[]): Block<T>[] {
  const blocks: Block<T>[] = items
    .filter((c) => c.folderId == null)
    .map((item) => ({ folder: null, items: [item] }))
  for (const folder of folders) {
    blocks.push({ folder, items: items.filter((c) => c.folderId === folder.id) })
  }
  return blocks
}

function fromBlocks<T extends FolderListItem>(
  blocks: Block<T>[]
): { folders: ListFolder[]; items: T[] } {
  const folders: ListFolder[] = []
  const items: T[] = []
  for (const block of blocks) {
    if (block.folder) {
      folders.push(block.folder)
      for (const item of block.items) items.push({ ...item, folderId: block.folder.id })
    } else {
      for (const item of block.items) items.push({ ...item, folderId: null })
    }
  }
  return { folders, items }
}

/**
 * 드래그 결과 반영. activeKey/overKey는 rowKey 형식 ("f-1" | "i-3").
 * - 아이템 이동: 도착 위치의 폴더 문맥으로 소속 변경
 * - 폴더 이동: 소속 아이템이 블록째 함께 이동, 도착 위치는 블록 경계로 스냅
 */
export function moveRow<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[],
  activeKey: string,
  overKey: string
): { folders: ListFolder[]; items: T[] } {
  if (activeKey === overKey) return { folders, items }
  const [activeKind, activeIdStr] = activeKey.split('-')
  const activeId = Number(activeIdStr)

  if (activeKind === 'f') {
    // 폴더 블록 이동
    const blocks = toBlocks(folders, items)
    const fromIdx = blocks.findIndex((b) => b.folder?.id === activeId)
    if (fromIdx < 0) return { folders, items }
    const [block] = blocks.splice(fromIdx, 1)

    const [overKind, overIdStr] = overKey.split('-')
    const overId = Number(overIdStr)
    let toIdx = blocks.findIndex((b) =>
      overKind === 'f' ? b.folder?.id === overId : b.items.some((i) => i.id === overId)
    )
    if (toIdx < 0) toIdx = blocks.length
    else if (toIdx >= fromIdx) toIdx += 1 // 아래로 이동 시 대상 블록 뒤에
    blocks.splice(Math.min(toIdx, blocks.length), 0, block)
    return fromBlocks(blocks)
  }

  // 아이템 이동 — 전체 행 기준으로 위치 재계산
  const rows = buildDisplayRows(folders, items)
  const fromIdx = rows.findIndex((r) => rowKey(r) === activeKey)
  if (fromIdx < 0) return { folders, items }
  const [row] = rows.splice(fromIdx, 1)
  if (row.type !== 'item') return { folders, items }

  let toIdx = rows.findIndex((r) => rowKey(r) === overKey)
  if (toIdx < 0) return { folders, items }
  if (toIdx >= fromIdx) toIdx += 1
  rows.splice(Math.min(toIdx, rows.length), 0, row)

  // 행 순서에서 folders/items 재구성 (소속은 직전 폴더에서 파생)
  const nextFolders: ListFolder[] = []
  const nextItems: T[] = []
  let currentFolder: number | null = null
  for (const r of rows) {
    if (r.type === 'folder') {
      nextFolders.push(r.folder)
      currentFolder = r.folder.id
    } else {
      nextItems.push({ ...r.item, folderId: currentFolder })
    }
  }
  return { folders: nextFolders, items: nextItems }
}

/** DB 반영용 전체 순서 */
export function toOrderEntries<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[]
): CharacterOrderEntry[] {
  const order: CharacterOrderEntry[] = []
  for (const c of items.filter((c) => c.folderId == null)) order.push({ type: 'char', id: c.id })
  for (const f of folders) {
    order.push({ type: 'folder', id: f.id })
    for (const c of items.filter((c) => c.folderId === f.id)) order.push({ type: 'char', id: c.id })
  }
  return order
}
