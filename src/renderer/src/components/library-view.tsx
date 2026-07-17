import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GalleryVertical,
  Images,
  Layers3,
  LayoutGrid,
  Loader2,
  Menu,
  Pencil,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HistoryItem,
  LibraryDateGroup,
  LibraryStackSummary,
  LibraryVirtualFolder
} from '@shared/types'
import { cn } from '../lib/utils'
import {
  LIBRARY_ENTRY_MIME,
  LIBRARY_FOLDER_MIME,
  readLibraryEntry,
  setImagePathDrag,
  setLibraryEntryDrag
} from '../lib/image-drag'
import { useGenerationStore } from '../stores/generation-store'
import { useStorageSettingsStore } from '../stores/storage-settings-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { ImageContextMenu } from './image-context-menu'
import { Lightbox } from './lightbox'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const PAGE = 60
type Fit = 'square' | 'natural'
type LibraryMode = 'classic' | 'folders'
type FolderSelection = 'all' | 'unfiled' | number

interface FolderNode extends LibraryVirtualFolder {
  children: FolderNode[]
}

export function LibraryView(): React.JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const [cols, setCols] = useState(() => Number(localStorage.getItem('library_cols')) || 4)
  const [fit, setFit] = useState<Fit>(
    () => (localStorage.getItem('library_fit') as Fit) || 'square'
  )
  const [mode, setMode] = useState<LibraryMode>('classic')
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem('library_panel_open') !== '0'
  )
  const [dates, setDates] = useState<LibraryDateGroup[]>([])
  const [folders, setFolders] = useState<LibraryVirtualFolder[]>([])
  const [stacks, setStacks] = useState<LibraryStackSummary[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all')

  const historyTotal = useGenerationStore((s) => s.historyTotal)
  const historyDeleteFile = useStorageSettingsStore((s) => s.historyDeleteFile)
  const loadStorageSettings = useStorageSettingsStore((s) => s.load)
  const itemsRef = useRef<HistoryItem[]>([])
  const loadingRef = useRef(false)
  const requestSeq = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const requestFilter = useMemo(() => {
    const filter: { date?: string; virtualFolderId?: number; unfiledOnly?: boolean } = {}
    if (selectedDate) filter.date = selectedDate
    if (mode === 'folders') {
      if (selectedFolder === 'unfiled') filter.unfiledOnly = true
      else if (typeof selectedFolder === 'number') filter.virtualFolderId = selectedFolder
    }
    return filter
  }, [mode, selectedDate, selectedFolder])

  const loadNavigation = useCallback(async (): Promise<void> => {
    const [dateRes, folderRes] = await Promise.all([
      window.nais.invoke('library:dates', undefined),
      window.nais.invoke('library:folders', undefined)
    ])
    setDates(dateRes.items)
    setFolders(folderRes.folders)
    setStacks(folderRes.stacks)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await window.nais.invoke('images:list', {
        limit: PAGE,
        offset: 0,
        ...requestFilter
      })
      if (seq !== requestSeq.current) return
      itemsRef.current = res.items
      setItems(res.items)
      setTotal(res.total)
    } finally {
      if (seq === requestSeq.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [requestFilter])

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingRef.current || itemsRef.current.length >= total) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await window.nais.invoke('images:list', {
        limit: PAGE,
        offset: itemsRef.current.length,
        ...requestFilter
      })
      setTotal(res.total)
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id))
        const next = [...previous, ...res.items.filter((item) => !seen.has(item.id))]
        itemsRef.current = next
        return next
      })
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [requestFilter, total])

  useEffect(() => {
    queueMicrotask(() => void loadStorageSettings())
    void window.nais.invoke('settings:get', { key: 'library_view_mode' }).then(({ value }) => {
      setMode(value === 'folders' ? 'folders' : 'classic')
    })
    const onMode = (event: Event): void => {
      const value = (event as CustomEvent<LibraryMode>).detail
      setMode(value === 'folders' ? 'folders' : 'classic')
      if (value !== 'folders') setSelectedFolder('all')
    }
    window.addEventListener('nais:library-view-mode', onMode)
    return () => window.removeEventListener('nais:library-view-mode', onMode)
  }, [loadStorageSettings])

  useEffect(() => {
    queueMicrotask(() => {
      void reload()
      void loadNavigation()
    })
  }, [historyTotal, loadNavigation, reload])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore()
      },
      { rootMargin: '600px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const setColsPersist = (value: number): void => {
    setCols(value)
    localStorage.setItem('library_cols', String(value))
  }
  const setFitPersist = (value: Fit): void => {
    setFit(value)
    localStorage.setItem('library_fit', value)
  }
  const togglePanel = (): void => {
    const next = !panelOpen
    setPanelOpen(next)
    localStorage.setItem('library_panel_open', next ? '1' : '0')
  }

  const onDelete = async (id: number): Promise<void> => {
    if (historyDeleteFile) {
      const ok = await askConfirm('파일까지 영구 삭제', {
        message: '라이브러리 기록과 저장된 이미지 파일을 함께 삭제합니다.',
        confirmLabel: '영구 삭제',
        danger: true
      })
      if (!ok) return
    }
    await window.nais.invoke('images:delete', { id, deleteFile: historyDeleteFile })
    void useGenerationStore.getState().refreshHistory()
    await Promise.all([reload(), loadNavigation()])
  }

  const assignEntry = async (
    entry: { type: 'image' | 'stack'; id: number },
    folderId: number | null
  ): Promise<void> => {
    await window.nais.invoke('library:assign', {
      imageIds: entry.type === 'image' ? [entry.id] : undefined,
      stackIds: entry.type === 'stack' ? [entry.id] : undefined,
      folderId
    })
    await Promise.all([reload(), loadNavigation()])
  }

  const openStorageFolder = async (): Promise<void> => {
    const { ok } = await window.nais.invoke('library:openStorageFolder', undefined)
    if (!ok) toast('이미지 저장 폴더를 열 수 없습니다', 'error')
  }

  const visibleStacks = useMemo(() => {
    if (mode !== 'folders' || selectedDate) return []
    if (selectedFolder === 'all') return stacks
    if (selectedFolder === 'unfiled') return stacks.filter((stack) => stack.virtualFolderId == null)
    return stacks.filter((stack) => stack.virtualFolderId === selectedFolder)
  }, [mode, selectedDate, selectedFolder, stacks])

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface">
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <HeaderIconButton tip="실제 이미지 저장 폴더 열기" onClick={() => void openStorageFolder()}>
          <FolderOpen size={16} className="text-amber-400" />
        </HeaderIconButton>
        <Images size={16} className="text-muted" />
        <span className="text-[14px] font-semibold">라이브러리</span>
        <span className="font-mono text-[11px] text-faint">{total.toLocaleString()}</span>
        {selectedDate && (
          <span className="no-drag rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
            {selectedDate}
          </span>
        )}
        {mode === 'folders' && selectedFolder !== 'all' && (
          <span className="no-drag rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
            {selectedFolder === 'unfiled'
              ? '미분류'
              : (folders.find((folder) => folder.id === selectedFolder)?.name ?? '가상 폴더')}
          </span>
        )}

        <div className="flex-1" />

        <div className="no-drag flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          <SegIcon
            active={fit === 'square'}
            tip="정사각 크롭"
            onClick={() => setFitPersist('square')}
          >
            <LayoutGrid size={15} />
          </SegIcon>
          <SegIcon
            active={fit === 'natural'}
            tip="원본 비율"
            onClick={() => setFitPersist('natural')}
          >
            <GalleryVertical size={15} />
          </SegIcon>
        </div>

        <div className="no-drag flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          {[2, 3, 4, 5, 6].map((value) => (
            <button
              key={value}
              onClick={() => setColsPersist(value)}
              className={cn(
                'grid h-6 w-6 place-items-center rounded text-[12px] font-medium transition-colors',
                cols === value ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <HeaderIconButton
          tip={panelOpen ? '탐색 패널 닫기' : '탐색 패널 열기'}
          active={panelOpen}
          onClick={togglePanel}
        >
          <Menu size={16} />
        </HeaderIconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {panelOpen && (
          <LibrarySidebar
            mode={mode}
            dates={dates}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            folders={folders}
            selectedFolder={selectedFolder}
            onSelectFolder={setSelectedFolder}
            onAssign={assignEntry}
            onReload={async () => {
              await Promise.all([reload(), loadNavigation()])
            }}
          />
        )}

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
          {visibleStacks.length > 0 && (
            <div className="mb-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                <Layers3 size={13} /> 스택 {visibleStacks.length}
              </div>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {visibleStacks.map((stack) => (
                  <StackCard key={stack.id} stack={stack} />
                ))}
              </div>
              <div className="my-3 h-px bg-line" />
            </div>
          )}

          {items.length === 0 && visibleStacks.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
              <Images size={40} strokeWidth={1.3} className="opacity-40" />
              <p className="text-[13px]">이 분류에는 이미지가 없습니다</p>
            </div>
          ) : fit === 'natural' ? (
            <div style={{ columnCount: cols, columnGap: '8px' }}>
              {items.map((item, index) => (
                <ImageCardNatural
                  key={item.id}
                  item={item}
                  onOpen={() => setLightboxIdx(index)}
                  onDelete={() => void onDelete(item.id)}
                  deleteFile={historyDeleteFile}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {items.map((item, index) => (
                <ImageCardSquare
                  key={item.id}
                  item={item}
                  onOpen={() => setLightboxIdx(index)}
                  onDelete={() => void onDelete(item.id)}
                  deleteFile={historyDeleteFile}
                />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loading && (
            <div className="flex items-center justify-center py-4 text-faint">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
        </div>
      </div>

      {lightboxIdx >= 0 && (
        <Lightbox
          filePaths={items.map((item) => item.filePath)}
          index={lightboxIdx}
          onIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
        />
      )}
    </div>
  )
}

function LibrarySidebar({
  mode,
  dates,
  selectedDate,
  onSelectDate,
  folders,
  selectedFolder,
  onSelectFolder,
  onAssign,
  onReload
}: {
  mode: LibraryMode
  dates: LibraryDateGroup[]
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
  folders: LibraryVirtualFolder[]
  selectedFolder: FolderSelection
  onSelectFolder: (folder: FolderSelection) => void
  onAssign: (
    entry: { type: 'image' | 'stack'; id: number },
    folderId: number | null
  ) => Promise<void>
  onReload: () => Promise<void>
}): React.JSX.Element {
  const tree = useMemo(() => buildFolderTree(folders), [folders])

  const createFolder = async (parentId: number | null): Promise<void> => {
    const name = await askText(parentId == null ? '새 가상 폴더' : '새 하위 폴더', '새 폴더')
    if (!name) return
    await window.nais.invoke('library:folderCreate', { name, parentId })
    await onReload()
  }
  const renameFolder = async (folder: LibraryVirtualFolder): Promise<void> => {
    const name = await askText('가상 폴더 이름 변경', folder.name)
    if (!name) return
    await window.nais.invoke('library:folderRename', { id: folder.id, name })
    await onReload()
  }
  const deleteFolder = async (folder: LibraryVirtualFolder): Promise<void> => {
    const ok = await askConfirm('가상 폴더 삭제', {
      message: `"${folder.name}" 폴더를 삭제합니다. 이미지·스택과 하위 폴더는 상위 폴더로 안전하게 이동합니다.`,
      confirmLabel: '폴더 삭제',
      danger: true
    })
    if (!ok) return
    await window.nais.invoke('library:folderDelete', { id: folder.id })
    if (selectedFolder === folder.id) onSelectFolder(folder.parentId ?? 'unfiled')
    await onReload()
  }
  const toggleFolder = async (folder: LibraryVirtualFolder): Promise<void> => {
    await window.nais.invoke('library:folderCollapse', {
      id: folder.id,
      collapsed: !folder.collapsed
    })
    await onReload()
  }
  const moveFolder = async (id: number, parentId: number | null): Promise<void> => {
    const { moved } = await window.nais.invoke('library:folderMove', { id, parentId })
    if (!moved) toast('폴더를 자기 하위로 이동할 수 없습니다', 'error')
    await onReload()
  }

  const rootDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const entry = readLibraryEntry(e)
    if (entry) {
      void onAssign(entry, null)
      return
    }
    const folderId = Number(e.dataTransfer.getData(LIBRARY_FOLDER_MIME))
    if (Number.isInteger(folderId) && folderId > 0) void moveFolder(folderId, null)
  }

  return (
    <aside className="no-scrollbar w-56 shrink-0 overflow-y-auto border-r border-line bg-paper/45 p-2">
      <SectionTitle label="날짜" />
      <SideRow active={selectedDate == null} onClick={() => onSelectDate(null)}>
        <Images size={14} /> 전체 날짜
      </SideRow>
      {dates.map((group) => (
        <SideRow
          key={group.date}
          active={selectedDate === group.date}
          onClick={() => onSelectDate(group.date)}
          count={group.count}
        >
          <Folder size={14} /> {group.date}
        </SideRow>
      ))}

      {mode === 'folders' && (
        <>
          <div className="my-3 h-px bg-line" />
          <SectionTitle
            label="가상 폴더"
            action={
              <button
                className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink"
                title="루트 폴더 생성"
                onClick={() => void createFolder(null)}
              >
                <FolderPlus size={14} />
              </button>
            }
          />
          <SideRow active={selectedFolder === 'all'} onClick={() => onSelectFolder('all')}>
            <Images size={14} /> 전체 보기
          </SideRow>
          <div
            onDragOver={(e) => {
              if (
                e.dataTransfer.types.includes(LIBRARY_ENTRY_MIME) ||
                e.dataTransfer.types.includes(LIBRARY_FOLDER_MIME)
              ) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }
            }}
            onDrop={rootDrop}
          >
            <SideRow
              active={selectedFolder === 'unfiled'}
              onClick={() => onSelectFolder('unfiled')}
            >
              <FolderOpen size={14} /> 미분류
            </SideRow>
          </div>
          <div className="mt-1">
            {tree.map((node) => (
              <VirtualFolderRow
                key={node.id}
                node={node}
                depth={0}
                selected={selectedFolder}
                onSelect={onSelectFolder}
                onCreate={createFolder}
                onRename={renameFolder}
                onDelete={deleteFolder}
                onToggle={toggleFolder}
                onMove={moveFolder}
                onAssign={onAssign}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

function VirtualFolderRow({
  node,
  depth,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onToggle,
  onMove,
  onAssign
}: {
  node: FolderNode
  depth: number
  selected: FolderSelection
  onSelect: (folder: FolderSelection) => void
  onCreate: (parentId: number | null) => Promise<void>
  onRename: (folder: LibraryVirtualFolder) => Promise<void>
  onDelete: (folder: LibraryVirtualFolder) => Promise<void>
  onToggle: (folder: LibraryVirtualFolder) => Promise<void>
  onMove: (id: number, parentId: number | null) => Promise<void>
  onAssign: (
    entry: { type: 'image' | 'stack'; id: number },
    folderId: number | null
  ) => Promise<void>
}): React.JSX.Element {
  const hasChildren = node.children.length > 0
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const entry = readLibraryEntry(e)
    if (entry) {
      void onAssign(entry, node.id)
      return
    }
    const folderId = Number(e.dataTransfer.getData(LIBRARY_FOLDER_MIME))
    if (Number.isInteger(folderId) && folderId > 0) void onMove(folderId, node.id)
  }

  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(LIBRARY_FOLDER_MIME, String(node.id))
        }}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(LIBRARY_ENTRY_MIME) ||
            e.dataTransfer.types.includes(LIBRARY_FOLDER_MIME)
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={onDrop}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => void onRename(node)}
        className={cn(
          'group flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-[12px] transition-colors',
          selected === node.id
            ? 'bg-accent-soft text-accent'
            : 'text-muted hover:bg-surface-2 hover:text-ink'
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        title="드래그로 폴더 이동 · 이미지/스택을 놓아 분류"
      >
        <button
          className="grid size-5 shrink-0 place-items-center rounded hover:bg-paper/70"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) void onToggle(node)
          }}
          aria-label={node.collapsed ? '펼치기' : '접기'}
        >
          {hasChildren ? (
            node.collapsed ? (
              <ChevronRight size={13} />
            ) : (
              <ChevronDown size={13} />
            )
          ) : (
            <span className="size-3" />
          )}
        </button>
        <Folder size={14} className="shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <FolderAction title="하위 폴더 생성" onClick={() => void onCreate(node.id)}>
          <FolderPlus size={12} />
        </FolderAction>
        <FolderAction title="이름 변경" onClick={() => void onRename(node)}>
          <Pencil size={11} />
        </FolderAction>
        <FolderAction danger title="삭제" onClick={() => void onDelete(node)}>
          <Trash2 size={11} />
        </FolderAction>
      </div>
      {!node.collapsed &&
        node.children.map((child) => (
          <VirtualFolderRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            onCreate={onCreate}
            onRename={onRename}
            onDelete={onDelete}
            onToggle={onToggle}
            onMove={onMove}
            onAssign={onAssign}
          />
        ))}
    </>
  )
}

function StackCard({ stack }: { stack: LibraryStackSummary }): React.JSX.Element {
  return (
    <div
      draggable
      onDragStart={(e) => setLibraryEntryDrag(e, { type: 'stack', id: stack.id })}
      className="group relative aspect-square cursor-grab overflow-hidden rounded-lg border border-line bg-paper active:cursor-grabbing"
      title="가상 폴더로 드래그해 스택 분류"
    >
      {stack.thumbnail ? (
        <img
          src={`data:image/webp;base64,${stack.thumbnail}`}
          className="size-full object-cover opacity-80"
          draggable={false}
          alt=""
        />
      ) : (
        <div className="grid size-full place-items-center text-faint">
          <Layers3 size={30} strokeWidth={1.3} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6 text-white">
        <p className="truncate text-[12px] font-medium">{stack.name}</p>
        <p className="text-[10.5px] text-white/70">{stack.imageCount}장</p>
      </div>
    </div>
  )
}

function ImageCardSquare({
  item,
  onOpen,
  onDelete,
  deleteFile
}: {
  item: HistoryItem
  onOpen: () => void
  onDelete: () => void
  deleteFile: boolean
}): React.JSX.Element {
  return (
    <ImageContextMenu
      filePath={item.filePath}
      onDelete={onDelete}
      deleteLabel={deleteFile ? '파일까지 영구 삭제' : '기록에서 제거'}
    >
      <button
        draggable
        onDragStart={(e) => {
          setImagePathDrag(e, item.filePath)
          setLibraryEntryDrag(e, { type: 'image', id: item.id })
        }}
        className="relative aspect-square overflow-hidden rounded-lg border border-line bg-paper transition-all hover:ring-2 hover:ring-accent/60"
        title={`seed ${item.seed ?? '?'} · 레퍼런스/가상 폴더로 드래그 가능`}
        onClick={onOpen}
      >
        {item.thumbnail && (
          <img
            src={`data:image/webp;base64,${item.thumbnail}`}
            className="size-full object-cover"
            loading="lazy"
            draggable={false}
            alt=""
          />
        )}
      </button>
    </ImageContextMenu>
  )
}

function ImageCardNatural({
  item,
  onOpen,
  onDelete,
  deleteFile
}: {
  item: HistoryItem
  onOpen: () => void
  onDelete: () => void
  deleteFile: boolean
}): React.JSX.Element {
  return (
    <ImageContextMenu
      filePath={item.filePath}
      onDelete={onDelete}
      deleteLabel={deleteFile ? '파일까지 영구 삭제' : '기록에서 제거'}
    >
      <button
        draggable
        onDragStart={(e) => {
          setImagePathDrag(e, item.filePath)
          setLibraryEntryDrag(e, { type: 'image', id: item.id })
        }}
        className="mb-2 block w-full overflow-hidden rounded-lg border border-line bg-paper transition-all [break-inside:avoid] hover:ring-2 hover:ring-accent/60"
        title={`seed ${item.seed ?? '?'} · 레퍼런스/가상 폴더로 드래그 가능`}
        onClick={onOpen}
      >
        {item.thumbnail && (
          <img
            src={`data:image/webp;base64,${item.thumbnail}`}
            className="w-full"
            loading="lazy"
            draggable={false}
            alt=""
          />
        )}
      </button>
    </ImageContextMenu>
  )
}

function buildFolderTree(folders: LibraryVirtualFolder[]): FolderNode[] {
  const map = new Map<number, FolderNode>()
  for (const folder of folders) map.set(folder.id, { ...folder, children: [] })
  const roots: FolderNode[] = []
  for (const folder of folders) {
    const node = map.get(folder.id)!
    const parent = folder.parentId == null ? null : map.get(folder.parentId)
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (nodes: FolderNode[]): void => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    nodes.forEach((node) => sort(node.children))
  }
  sort(roots)
  return roots
}

function SectionTitle({
  label,
  action
}: {
  label: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-1 flex h-7 items-center px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
      {label}
      <div className="flex-1" />
      {action}
    </div>
  )
}

function SideRow({
  active,
  onClick,
  count,
  children
}: {
  active: boolean
  onClick: () => void
  count?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
      )}
    >
      {children}
      {count != null && <span className="ml-auto font-mono text-[10px] text-faint">{count}</span>}
    </button>
  )
}

function FolderAction({
  title,
  danger,
  onClick,
  children
}: {
  title: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100',
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-paper/80'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function HeaderIconButton({
  tip,
  active,
  onClick,
  children
}: {
  tip: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'no-drag grid size-7 place-items-center rounded transition-colors',
            active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
          )}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function SegIcon({
  active,
  tip,
  onClick,
  children
}: {
  active: boolean
  tip: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'grid size-7 place-items-center rounded transition-colors',
            active ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
