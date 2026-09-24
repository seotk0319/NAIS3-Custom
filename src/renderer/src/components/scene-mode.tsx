import {
  CalendarX,
  ChevronDown,
  Copy,
  FileDown,
  FileUp,
  FolderArchive,
  FolderOpen,
  ImageOff,
  ListChecks,
  Loader2,
  Minus,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Trash2,
  UserRound,
  UsersRound
} from 'lucide-react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'motion/react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { Scene, ScenePreset } from '@shared/types'
import { RESOLUTIONS, imageUrl, thumbnailUrl } from '../lib/constants'
import { useCharactersStore } from '../stores/characters-store'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore } from '../stores/scenes-store'
import { useResolutionsStore } from '../stores/resolutions-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { SceneCuration } from './scene-curation'
import { SceneDetail } from './scene-detail'
import { SceneCardImage } from './scene-card-image'
import { formatEta, useQueueRun } from '../lib/queue-run'
import { PresetManager } from './preset-manager'
import { SortableList, SortableRow } from './sortable-list'
import { Button } from './ui/button'
import { EditableCount } from './ui/editable-count'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function SceneMode(): React.JSX.Element {
  const scenes = useScenesStore((s) => s.scenes)
  const selectedId = useScenesStore((s) => s.selectedId)
  const loadPresets = useScenesStore((s) => s.loadPresets)

  useEffect(() => {
    void loadPresets()
  }, [loadPresets])

  const selected = scenes.find((s) => s.id === selectedId) ?? null
  if (selected) return <SceneDetail scene={selected} />
  return <SceneGrid />
}

/** NAIS2식 프리셋 드롭다운 — 현재 프리셋 표시 + 전환/추가/이름변경/삭제 */
function PresetDropdown(): React.JSX.Element {
  const [manageOpen, setManageOpen] = useState(false)
  const presets = useScenesStore((s) => s.presets)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const setActivePreset = useScenesStore((s) => s.setActivePreset)
  const createPreset = useScenesStore((s) => s.createPreset)
  const renamePreset = useScenesStore((s) => s.renamePreset)
  const deletePreset = useScenesStore((s) => s.deletePreset)
  const reorderPresets = useScenesStore((s) => s.reorderPresets)
  const [open, setOpen] = useState(false)
  // 캐릭터 바인드 다이얼로그 대상 프리셋
  const [bindPreset, setBindPreset] = useState<ScenePreset | null>(null)
  // 팝오버가 닫히는 클릭과 같은 틱에 다이얼로그를 열면 dismiss 레이스로 바로 닫힘 — 한 틱 미룸
  const openBindDialog = (p: ScenePreset): void => {
    setOpen(false)
    setTimeout(() => setBindPreset(p), 0)
  }

  const active = presets.find((p) => p.id === activePresetId)

  // 프리셋 선택 + 닫기 — 닫기를 먼저 (선택의 store 재렌더가 끼어들기 전에 확정) (B9)
  const choose = (id: number): void => {
    setOpen(false)
    void setActivePreset(id)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex h-9 min-w-0 max-w-[360px] items-center gap-1.5 rounded-lg bg-paper px-3 text-[13px] font-semibold text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40">
            <span className="min-w-0 flex-1 truncate text-left">{active?.name ?? '프리셋'}</span>
            <ChevronDown size={14} className="shrink-0 text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),24rem)] p-1">
          <div className="max-h-64 overflow-y-auto overflow-x-hidden no-scrollbar">
            {/* 드래그로 순서 변경 */}
            <SortableList
              ids={presets.map((p) => p.id)}
              onReorder={(ids) => void reorderPresets(ids)}
            >
              {presets.map((p) => (
                <SortableRow
                  key={p.id}
                  id={p.id}
                  className="group gap-1"
                  onTap={() => choose(p.id)}
                >
                  <div
                    onClick={() => choose(p.id)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                      p.id === activePresetId && 'font-semibold text-accent'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    {(p.characterIds?.length ?? 0) > 0 && (
                      // 바인드 표시 겸 편집 진입점. 반드시 <button> — SortableRow의 onTap(행 선택)이
                      // button/input에서 시작한 클릭만 제외하므로, span이면 행 선택으로 먹혀버린다
                      <button
                        className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-accent/12 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/25"
                        title="캐릭터 바인드됨 — 클릭해서 편집"
                        onClick={(e) => {
                          e.stopPropagation()
                          openBindDialog(p)
                        }}
                      >
                        <UserRound size={9} /> {p.characterIds!.length}
                      </button>
                    )}
                  </div>
                  {(p.characterIds?.length ?? 0) === 0 && (
                    <button
                      className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-fg group-hover:opacity-100"
                      onClick={() => openBindDialog(p)}
                      title="캐릭터 바인드 — 이 프리셋 생성 시 사이드바 대신 지정 캐릭터 사용"
                    >
                      <UsersRound size={12} />
                    </button>
                  )}
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-fg group-hover:opacity-100"
                    onClick={async () => {
                      const name = await askText('프리셋 이름', p.name)
                      if (name) void renamePreset(p.id, name)
                    }}
                    title="이름 변경"
                  >
                    <Pencil size={12} />
                  </button>
                  {presets.length > 1 && (
                    <button
                      className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                      onClick={async () => {
                        if (
                          await askConfirm('프리셋 삭제', {
                            message: `"${p.name}" 프리셋과 그 안의 씬을 모두 삭제합니다.`,
                            confirmLabel: '삭제',
                            danger: true
                          })
                        )
                          void deletePreset(p.id)
                      }}
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </SortableRow>
              ))}
            </SortableList>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
            onClick={() => {
              setOpen(false)
              setManageOpen(true)
            }}
          >
            <ListChecks size={14} /> 프리셋 관리
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent hover:bg-surface-2"
            onClick={async () => {
              const name = await askText('새 프리셋 이름', '새 프리셋')
              if (name) void createPreset(name)
            }}
          >
            <Plus size={14} /> 새 프리셋
          </button>
        </PopoverContent>
      </Popover>
      {manageOpen && <PresetManager kind="scene" onClose={() => setManageOpen(false)} />}
      {bindPreset && (
        <PresetCharacterDialog preset={bindPreset} onClose={() => setBindPreset(null)} />
      )}
    </>
  )
}

/** 프리셋 캐릭터 바인드 다이얼로그 — 캐릭터 라이브러리에서 체크해 지정 */
function PresetCharacterDialog({
  preset,
  onClose
}: {
  preset: ScenePreset
  onClose: () => void
}): React.JSX.Element {
  const characters = useCharactersStore((s) => s.items)
  const setPresetCharacters = useScenesStore((s) => s.setPresetCharacters)
  const [selected, setSelected] = useState<Set<number>>(new Set(preset.characterIds ?? []))

  const toggle = (id: number): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  // 저장 순서 = 캐릭터 라이브러리 순서 (캐릭터 슬롯 use_order와 일치)
  const save = (): void => {
    const ids = characters.filter((c) => selected.has(c.id)).map((c) => c.id)
    void setPresetCharacters(preset.id, ids.length > 0 ? ids : null)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-4">
        <DialogTitle className="mb-1">캐릭터 바인드 — {preset.name}</DialogTitle>
        <p className="mb-3 text-[12px] text-muted">
          바인드하면 이 프리셋의 씬을 생성할 때 사이드바에서 켜둔 캐릭터 대신 아래 캐릭터로
          생성됩니다. 비우면 기존처럼 사이드바 캐릭터를 사용합니다.
        </p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {characters.length === 0 && (
            <p className="py-6 text-center text-[12px] text-faint">
              캐릭터 라이브러리가 비어 있습니다
            </p>
          )}
          {characters.map((c) => {
            const checked = selected.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition',
                  checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'
                )}
              >
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded border-2',
                    checked ? 'border-accent bg-accent text-white' : 'border-line'
                  )}
                >
                  {checked && <span className="text-[9px] leading-none">✓</span>}
                </span>
                {c.thumbnail ? (
                  <img
                    src={`data:image/webp;base64,${c.thumbnail}`}
                    className="size-7 shrink-0 rounded object-cover"
                    alt=""
                  />
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded bg-surface-2 text-faint">
                    <UserRound size={13} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    {c.name || c.prompt.slice(0, 30) || '빈 캐릭터'}
                  </span>
                  {c.name && c.prompt && (
                    <span className="block truncate font-mono text-[10.5px] text-faint">
                      {c.prompt}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {(preset.characterIds?.length ?? 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={() => {
                void setPresetCharacters(preset.id, null)
                onClose()
              }}
            >
              바인드 해제
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="accent" onClick={save}>
            저장 ({selected.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 아이콘 버튼 + 툴팁 */
function IconBtn({
  icon,
  tip,
  active,
  disabled,
  onClick,
  color
}: {
  icon: React.ReactNode
  tip: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  color?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'grid size-9 place-items-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-35',
            active
              ? 'bg-accent text-white dark:text-paper'
              : cn(color ?? 'text-muted', 'hover:bg-paper', color ? '' : 'hover:text-ink')
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

// 씬 그리드 스크롤 위치 — 다른 페이지/씬 상세를 다녀와도 위치 복원 (언마운트돼도 유지)
let savedGridScroll = 0

// 씬이 많을 때(1,000개 등) 모든 카드를 그리면 패널 여닫기·탭 이동마다 카드 전체를 다시 배치·생성해 끊긴다.
// 카드 높이는 폭과 비율로 정해지므로, 화면 근처 줄만 그리고 위아래는 같은 높이의 여백(padding)으로 채운다.
const GRID_GAP_X = 16 // gap-x-4
const GRID_GAP_Y = 20 // gap-y-5
const CARD_CAPTION = 48 // 이미지 아래 mt-2(8) + 캡션 h-10(40)
// 화면 위아래로 최소 2줄, 또는 화면 높이의 70%만큼 미리 그려 둔다 (스크롤 중 빈 틀 줄이기)
const OVERSCAN_ROWS = 2
const OVERSCAN_VIEWPORT = 0.7

function useGridWindow(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  gridRef: React.RefObject<HTMLDivElement | null>,
  count: number,
  columns: number,
  aspect: string
): { start: number; end: number } {
  const [range, setRange] = useState(() => ({ start: 0, end: Math.min(count, columns * 6) }))
  const rangeRef = useRef(range)
  const rowHRef = useRef(0)
  const restoredRef = useRef(false)

  const applyPadding = useCallback(() => {
    const g = gridRef.current
    const rowH = rowHRef.current
    if (!g || rowH <= 0) return
    const rows = Math.ceil(count / columns)
    const { start, end } = rangeRef.current
    g.style.paddingTop = `${Math.floor(start / columns) * rowH}px`
    g.style.paddingBottom = `${Math.max(0, rows - Math.ceil(end / columns)) * rowH}px`
  }, [gridRef, count, columns])

  const measure = useCallback(() => {
    const s = scrollRef.current
    const g = gridRef.current
    if (!s || !g) return
    const [aw, ah] = aspect.split('/').map(Number)
    const cardW = (g.clientWidth - (columns - 1) * GRID_GAP_X) / columns
    if (!(cardW > 0) || !aw || !ah) return // 숨겨진 탭(display:none)이면 건너뛴다
    const rowH = (cardW * ah) / aw + CARD_CAPTION + GRID_GAP_Y
    rowHRef.current = rowH
    const rows = Math.ceil(count / columns)
    if (!restoredRef.current) {
      // 첫 측정 때 여백을 먼저 깔아야 저장된 스크롤 위치로 돌아갈 수 있다
      restoredRef.current = true
      g.style.paddingBottom = `${rows * rowH}px`
      if (savedGridScroll > 0) s.scrollTop = savedGridScroll
    }
    const top = g.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop
    const overscan = Math.max(OVERSCAN_ROWS, Math.ceil((s.clientHeight * OVERSCAN_VIEWPORT) / rowH))
    const first = Math.max(0, Math.floor((s.scrollTop - top) / rowH) - overscan)
    const last = Math.min(rows, Math.ceil((s.scrollTop + s.clientHeight - top) / rowH) + overscan)
    const next = { start: Math.min(count, first * columns), end: Math.min(count, Math.max(first, last) * columns) }
    if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
      rangeRef.current = next
      setRange(next)
    } else {
      applyPadding()
    }
  }, [scrollRef, gridRef, count, columns, aspect, applyPadding])

  // 새 범위를 그린 직후 여백을 맞춘다 (그리기와 여백이 한 프레임 안에서 같이 바뀌게)
  useLayoutEffect(applyPadding, [range, applyPadding])
  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const s = scrollRef.current
    if (!s) return
    let raf = 0
    const onScroll = (): void => {
      if (s.clientWidth > 0) savedGridScroll = s.scrollTop
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    let hidden = s.clientWidth === 0
    const ro = new ResizeObserver(() => {
      // 숨겨졌던 탭이 다시 보이면 떠날 때의 스크롤 위치로 돌아간다
      const nowHidden = s.clientWidth === 0
      if (hidden && !nowHidden && savedGridScroll > 0) s.scrollTop = savedGridScroll
      hidden = nowHidden
      measure()
    })
    s.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(s)
    return () => {
      cancelAnimationFrame(raf)
      s.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [scrollRef, measure])

  return range
}

function SceneGrid(): React.JSX.Element {
  const scenes = useScenesStore((s) => s.scenes)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const create = useScenesStore((s) => s.create)
  const editMode = useScenesStore((s) => s.editMode)
  const setEditMode = useScenesStore((s) => s.setEditMode)
  const columns = useScenesStore((s) => s.columns)
  const setColumns = useScenesStore((s) => s.setColumns)
  const cardOrientation = useScenesStore((s) => s.cardOrientation)
  const setCardOrientation = useScenesStore((s) => s.setCardOrientation)
  const setReserveAll = useScenesStore((s) => s.setReserveAll)
  const clearReserveAll = useScenesStore((s) => s.clearReserveAll)
  // 필터: 전체 / 이미지 없음 / 예약됨. 필터 중에도 드래그 재정렬은 전체 순서 기준으로 동작한다.
  const [filter, setFilter] = useState<'all' | 'empty' | 'reserved'>('all')
  // "씬마다 N장" 예약 값 — 마지막 값을 기억
  const [perScene, setPerScene] = useState(() => {
    const v = Number(localStorage.getItem('scene_per_scene_reserve'))
    return Number.isInteger(v) && v > 0 ? v : 1
  })
  const selection = useScenesStore((s) => s.selection)
  const reorder = useScenesStore((s) => s.reorder)
  const [curationOpen, setCurationOpen] = useState(false)
  const queueBusy = useGenerationStore(
    (s) => s.queue?.items.some((i) => i.state === 'generating' || i.state === 'pending') ?? false
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // 드래그 재정렬 (5px 이동해야 시작 — 클릭과 구분).
  // DragOverlay 사용: 드래그 중엔 가벼운 클론이 커서를 따라가고 원본은 숨겨 프레임 저하 방지
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragScene, setDragScene] = useState<Scene | null>(null)
  const onDragStart = (e: DragStartEvent): void => {
    setDragScene(scenes.find((s) => `scene-${s.id}` === e.active.id) ?? null)
  }
  const onDragEnd = (e: DragEndEvent): void => {
    setDragScene(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = scenes.map((s) => `scene-${s.id}`)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void reorder(arrayMove(scenes, from, to).map((s) => s.id))
  }

  // 스트리밍: 현재 생성 중인 씬과 미리보기 프레임 (해당 씬 카드에만 전달)
  const previewPng = useGenerationStore((s) => s.previewPng)
  const generatingSceneId = useGenerationStore(
    (s) => s.queue?.items.find((i) => i.state === 'generating')?.request.sceneId ?? null
  )
  // 씬별 큐 잔여 장수(대기+생성 중) — 연속 생성 중 각 씬에 몇 장 남았는지 표시용
  const queueItems = useGenerationStore((s) => s.queue?.items)
  const remainingByScene = useMemo(() => {
    const m = new Map<number, number>()
    for (const it of queueItems ?? []) {
      const sid = it.request.sceneId
      if (sid != null && (it.state === 'pending' || it.state === 'generating')) {
        m.set(sid, (m.get(sid) ?? 0) + 1)
      }
    }
    return m
  }, [queueItems])

  // 씬 개수와 이미지 장수는 서로 다른 단위라 따로 센다.
  const stats = useMemo(() => {
    let images = 0
    let reserved = 0
    let empty = 0
    let reservedScenes = 0
    let queued = 0
    for (const sc of scenes) {
      images += sc.imageCount
      reserved += sc.reserveCount
      if (sc.imageCount === 0) empty++
      if (sc.reserveCount > 0) reservedScenes++
      queued += remainingByScene.get(sc.id) ?? 0
    }
    return { images, reserved, empty, reservedScenes, queued }
  }, [scenes, remainingByScene])
  const visibleScenes = useMemo(
    () =>
      filter === 'empty'
        ? scenes.filter((sc) => sc.imageCount === 0)
        : filter === 'reserved'
          ? scenes.filter((sc) => sc.reserveCount > 0)
          : scenes,
    [scenes, filter]
  )
  // 일괄 예약·취소 대상: 편집 모드 선택 → 지금 필터에 보이는 씬 → 전체 씬
  const reserveTarget = useMemo((): { ids?: number[]; label: string; chip: string } => {
    if (editMode && selection.size > 0) {
      return { ids: [...selection], label: `선택한 씬 ${selection.size}개`, chip: `선택 ${selection.size}개` }
    }
    if (filter !== 'all') {
      const n = visibleScenes.length
      const kind = filter === 'empty' ? '이미지 없는 씬' : '예약된 씬'
      return { ids: visibleScenes.map((sc) => sc.id), label: `${kind} ${n.toLocaleString()}개`, chip: `${n.toLocaleString()}개 씬마다` }
    }
    return { label: '모든 씬', chip: '씬마다' }
  }, [editMode, selection, filter, visibleScenes])
  const targetLabel = reserveTarget.label
  // 격자 칸 수 = 씬 + (전체 보기일 때) 씬 추가 버튼
  const gridCount = visibleScenes.length + (filter === 'all' ? 1 : 0)
  const gridWindow = useGridWindow(scrollRef, gridRef, gridCount, columns, CARD_ASPECT[cardOrientation])
  const targetEmpty = reserveTarget.ids !== undefined && reserveTarget.ids.length === 0
  const targetReserved = useMemo(() => {
    if (reserveTarget.ids === undefined) return stats.reserved > 0
    const ids = new Set(reserveTarget.ids)
    return scenes.some((sc) => sc.reserveCount > 0 && ids.has(sc.id))
  }, [reserveTarget, scenes, stats.reserved])

  async function exportJson(): Promise<void> {
    await window.nais.invoke('scenes:exportJson', { presetId: activePresetId })
  }
  async function importJson(): Promise<void> {
    const { count, presetId, presetName } = await window.nais.invoke('scenes:importJson', {
      presetId: activePresetId
    })
    if (count > 0) {
      if (presetName && presetId !== activePresetId) {
        // 이름 있는 프리셋 파일(NAIS2) → 새 프리셋 생성 후 자동 전환
        await useScenesStore.getState().loadPresets(false)
        await useScenesStore.getState().setActivePreset(presetId)
        toast(`'${presetName}' 프리셋으로 씬 ${count}개 가져옴`, 'success')
      } else {
        toast(`씬 ${count}개 가져옴`, 'success')
        void useScenesStore.getState().load()
      }
    } else {
      toast('가져올 씬이 없습니다', 'info')
    }
  }
  async function exportZip(): Promise<void> {
    await window.nais.invoke('scenes:exportZip', { presetId: activePresetId })
  }
  async function openPresetFolder(): Promise<void> {
    const { ok } = await window.nais.invoke('scenePresets:openFolder', { id: activePresetId })
    if (!ok) toast('활성 씬 프리셋 폴더를 열 수 없습니다', 'error')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-surface">
      {curationOpen ? (
        <SceneCuration onClose={() => setCurationOpen(false)} />
      ) : (
        <>
          {/* 머리줄: 제목 · 프리셋 · 도구 */}
          <div className="flex min-w-0 items-center gap-2.5 px-5 pb-3 pt-4">
            <h1 className="shrink-0 text-[22px] font-bold tracking-tight text-ink">씬</h1>
            <PresetDropdown />
            <div className="min-w-2 flex-1" />
            <Button variant="ghost" className="h-9 shrink-0 bg-paper px-3" onClick={importJson}>
              <FileDown size={15} /> 불러오기
            </Button>
            <Button
              variant="ghost"
              className="h-9 shrink-0 bg-paper px-3"
              onClick={() => void openPresetFolder()}
            >
              <FolderOpen size={15} /> 폴더
            </Button>
            <IconBtn
              icon={<Pencil size={16} />}
              tip="편집 모드 (여러 씬 선택)"
              active={editMode}
              onClick={() => setEditMode(!editMode)}
            />
            <IconBtn
              icon={<ListChecks size={16} />}
              tip="선별 작업"
              disabled={scenes.length === 0 || queueBusy}
              onClick={() => setCurationOpen(true)}
            />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink"
                  title="더 보기"
                >
                  <MoreHorizontal size={17} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <MenuItem icon={<FileUp size={13} />} label="씬 JSON 내보내기" onClick={exportJson} />
                <MenuItem
                  icon={<FolderArchive size={13} />}
                  label="ZIP 내보내기"
                  onClick={() => void exportZip()}
                />
                <div className="my-1 h-px bg-line" />
                <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-faint">카드 비율</p>
                <MenuItem
                  icon={<RectangleVertical size={13} />}
                  label={(cardOrientation === 'portrait' ? '✓ ' : '') + '세로'}
                  onClick={() => setCardOrientation('portrait')}
                />
                <MenuItem
                  icon={<RectangleHorizontal size={13} />}
                  label={(cardOrientation === 'landscape' ? '✓ ' : '') + '가로'}
                  onClick={() => setCardOrientation('landscape')}
                />
                <MenuItem
                  icon={<Square size={13} />}
                  label={(cardOrientation === 'square' ? '✓ ' : '') + '정사각'}
                  onClick={() => setCardOrientation('square')}
                />
              </PopoverContent>
            </Popover>
            {/* 열 수 (2~5) */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-paper p-0.5">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setColumns(n)}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-md text-[12px] font-semibold transition-colors',
                    columns === n ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <RunProgress />

          {/* 요약 줄: 씬 개수와 이미지 장수를 나눠 보여주고, 씬마다 몇 장씩 뽑을지 정한다 */}
          <div className="flex min-w-0 flex-wrap items-center gap-2 px-5 pb-4">
            {(
              [
                ['all', '전체 씬', scenes.length],
                ['empty', '이미지 없음', stats.empty],
                ['reserved', '예약됨', stats.reservedScenes]
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors',
                  filter === key ? 'bg-ink text-paper' : 'bg-paper text-muted hover:text-ink'
                )}
              >
                {label}
                <span className="tabular-nums opacity-60">{count.toLocaleString()}</span>
              </button>
            ))}
            <span className="ml-1 text-[12px] tabular-nums text-muted">
              이미지 <b className="font-semibold text-ink">{stats.images.toLocaleString()}</b>장
              {stats.reserved > 0 && (
                <>
                  {' · '}예약 <b className="font-semibold text-accent">{stats.reserved.toLocaleString()}</b>장
                </>
              )}
              {stats.queued > 0 && (
                <>
                  {' · '}생성 대기 <b className="font-semibold text-ink">{stats.queued.toLocaleString()}</b>장
                </>
              )}
            </span>
            <div className="min-w-2 flex-1" />
            <div
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-paper pl-3 pr-1 text-[12px] font-medium text-muted"
              title={`${targetLabel}의 예약을 이 장수로 맞춥니다`}
            >
              {reserveTarget.chip}
              <EditableCount
                value={perScene}
                min={1}
                max={9999}
                onCommit={(n) => {
                  setPerScene(n)
                  localStorage.setItem('scene_per_scene_reserve', String(n))
                }}
                className="min-w-6 text-center text-[13px] font-bold tabular-nums text-ink"
                inputClassName="w-12"
              />
              장
              <Button
                variant="accent"
                className="ml-1 h-7 rounded-md px-2.5 text-[12px]"
                disabled={targetEmpty}
                onClick={() => void setReserveAll(perScene, reserveTarget.ids)}
              >
                예약
              </Button>
            </div>
            <IconBtn
              icon={<CalendarX size={16} />}
              tip={`${targetLabel} 예약 취소`}
              disabled={!targetReserved}
              onClick={() => void clearReserveAll(false, reserveTarget.ids)}
            />
          </div>

          <AnimatePresence initial={false}>
            {editMode && (
              <motion.div
                key="bulkbar"
                className="overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <BulkBar />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 카드 그리드 (열 수만큼 폭에 꽉 차게). scrollbar-gutter로 스크롤바 등장 시 밀림 방지 */}
          <div
            ref={scrollRef}
            data-scene-scroll
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 no-scrollbar"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragCancel={() => setDragScene(null)}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={visibleScenes.map((s) => `scene-${s.id}`)}
                strategy={rectSortingStrategy}
              >
                <div
                  ref={gridRef}
                  className="grid gap-x-4 gap-y-5"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                  {visibleScenes.slice(gridWindow.start, gridWindow.end).map((scene) => (
                    <SceneCard
                      key={scene.id}
                      scene={scene}
                      live={scene.id === generatingSceneId ? previewPng : null}
                      generating={scene.id === generatingSceneId}
                      remaining={remainingByScene.get(scene.id) ?? 0}
                    />
                  ))}
                  {filter === 'all' && gridWindow.end === gridCount && (
                    <button
                      onClick={() => void create('새 씬')}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-faint transition hover:text-accent"
                      style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
                    >
                      <Plus size={22} />
                      <span className="text-[12px]">씬 추가</span>
                    </button>
                  )}
                </div>
              </SortableContext>
              {/* 드래그 중 커서를 따라가는 가벼운 클론 (원본은 숨김) */}
              <DragOverlay dropAnimation={null}>
                {dragScene && (
                  <div
                    className="relative overflow-hidden rounded-lg border border-accent bg-surface-2 shadow-2xl"
                    style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
                  >
                    {dragScene.thumbnailPath || dragScene.thumbnail ? (
                      <img
                        src={
                          dragScene.thumbnailPath
                            ? thumbnailUrl(
                                dragScene.thumbnailPath,
                                useGenerationStore.getState().imageRevisions[
                                  dragScene.thumbnailPath
                                ]
                              )
                            : `data:image/webp;base64,${dragScene.thumbnail}`
                        }
                        className="h-full w-full object-cover"
                        draggable={false}
                        alt=""
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-paper text-faint">
                        <ImageOff size={26} strokeWidth={1.3} />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                      <div className="truncate text-[13px] font-semibold text-white drop-shadow">
                        {dragScene.name}
                      </div>
                    </div>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {scenes.length === 0 && (
              <p className="mt-6 text-center text-[13px] text-faint">
                씬을 추가해 프롬프트와 해상도를 저장하고, +로 예약한 뒤 좌측 생성 버튼으로 뽑으세요.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** 편집 모드 일괄 작업 바 */
function BulkBar(): React.JSX.Element {
  const selection = useScenesStore((s) => s.selection)
  const presets = useScenesStore((s) => s.presets)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const selectAll = useScenesStore((s) => s.selectAll)
  const clearSelection = useScenesStore((s) => s.clearSelection)
  const bulkMove = useScenesStore((s) => s.bulkMove)
  const bulkDelete = useScenesStore((s) => s.bulkDelete)
  const bulkSetResolution = useScenesStore((s) => s.bulkSetResolution)
  const customResolutions = useResolutionsStore((s) => s.custom)
  const bulkClearFavorites = useScenesStore((s) => s.bulkClearFavorites)
  const bulkClearImages = useScenesStore((s) => s.bulkClearImages)
  const bulkExportZip = useScenesStore((s) => s.bulkExportZip)

  const n = selection.size
  const disabled = n === 0

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2 text-[13px]">
      <span className="font-medium text-fg">{n}개 선택</span>
      <Button size="sm" variant="ghost" onClick={selectAll}>
        전체 선택
      </Button>
      <Button size="sm" variant="ghost" onClick={clearSelection} disabled={disabled}>
        해제
      </Button>
      <div className="mx-1 h-4 w-px bg-line" />

      {/* 프리셋 이동 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={disabled}>
            프리셋 이동
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {presets
            .filter((p) => p.id !== activePresetId)
            .map((p) => (
              <MenuItem key={p.id} label={p.name} onClick={() => void bulkMove(p.id)} />
            ))}
          {presets.filter((p) => p.id !== activePresetId).length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-faint">다른 프리셋 없음</p>
          )}
        </PopoverContent>
      </Popover>

      {/* 해상도 일괄 (기본 + 커스텀) */}
      <Select
        onValueChange={(v) => {
          const [w, h] = v.split('x').map(Number)
          if (w && h) void bulkSetResolution(w, h)
        }}
      >
        <SelectTrigger className="h-8 w-40" disabled={disabled}>
          <SelectValue placeholder="해상도 변경" />
        </SelectTrigger>
        <SelectContent>
          {[...RESOLUTIONS, ...customResolutions].map((r) => (
            <SelectItem key={r.label} value={`${r.width}x${r.height}`}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void bulkExportZip()}>
        <FolderArchive size={13} /> ZIP
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => void bulkClearFavorites()}
      >
        즐겨찾기 해제
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={async () => {
          if (
            await askConfirm('이미지 비우기', {
              message: `선택한 ${n}개 씬의 생성 이미지를 모두 삭제합니다. 되돌릴 수 없습니다.`,
              confirmLabel: '비우기',
              danger: true
            })
          )
            void bulkClearImages()
        }}
      >
        이미지 비우기
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        disabled={disabled}
        onClick={async () => {
          if (
            await askConfirm('씬 삭제', {
              message: `선택한 ${n}개 씬을 삭제합니다.`,
              confirmLabel: '삭제',
              danger: true
            })
          )
            void bulkDelete()
        }}
      >
        <Trash2 size={13} /> 삭제
      </Button>
    </div>
  )
}

// 카드 비율은 해상도와 무관하게 고정 (혼합 해상도에서도 레이아웃 균일)
const CARD_ASPECT = { portrait: '832 / 1216', landscape: '1216 / 832', square: '1 / 1' } as const

function dndStyle(sortable: ReturnType<typeof useSortable>): CSSProperties {
  const t = sortable.transform
  return {
    // 드래그되는 원본은 숨긴다 — 실제 이동은 DragOverlay 클론이 담당 (프레임 저하 방지)
    transform: t ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)` : undefined,
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0 : undefined
  }
}

const SceneCard = memo(function SceneCard(props: {
  scene: Scene
  live: string | null
  generating: boolean
  remaining: number
}): React.JSX.Element {
  const sortable = useSortable({ id: `scene-${props.scene.id}` })
  return <SceneCardBody {...props} sortable={sortable} />
})

function SceneCardBody({
  scene,
  live,
  generating,
  remaining,
  sortable
}: {
  scene: Scene
  live: string | null
  generating: boolean
  /** 이 씬의 큐 잔여 장수(대기+생성 중). 0이면 배지 숨김 */
  remaining: number
  sortable: ReturnType<typeof useSortable>
}): React.JSX.Element {
  const editMode = useScenesStore((s) => s.editMode)
  const cardOrientation = useScenesStore((s) => s.cardOrientation)
  const selection = useScenesStore((s) => s.selection)
  const toggleSelected = useScenesStore((s) => s.toggleSelected)
  const select = useScenesStore((s) => s.select)
  const update = useScenesStore((s) => s.update)
  const duplicate = useScenesStore((s) => s.duplicate)
  const remove = useScenesStore((s) => s.remove)
  const adjustReserve = useScenesStore((s) => s.adjustReserve)
  const thumbnailRevision = useGenerationStore((s) =>
    scene.thumbnailPath ? s.imageRevisions[scene.thumbnailPath] : undefined
  )
  const checked = selection.has(scene.id)
  // 이번 생성 묶음에서 이 씬에 걸린 장수 ("생성 중 12 / 20")
  const runTotal = useQueueRun((s) => s.run?.perScene.get(scene.id) ?? 0)
  // Fetch the existing 512px thumbnail on demand, not the full-resolution original.
  // Revision keys keep whitepaint/undo edits fresh without invalidating other cards.
  const src = scene.thumbnailPath
    ? thumbnailUrl(scene.thumbnailPath, thumbnailRevision)
    : scene.thumbnail
      ? `data:image/webp;base64,${scene.thumbnail}`
      : null

  // 우클릭 메뉴/3-dot 공용 액션
  const renameScene = async (): Promise<void> => {
    const name = await askText('씬 이름', scene.name)
    if (name) void update(scene.id, { name })
  }
  const openFolder = async (): Promise<void> => {
    const { ok } = await window.nais.invoke('scenes:openFolder', { sceneId: scene.id })
    if (!ok) toast('아직 생성된 이미지 폴더가 없습니다', 'info')
  }
  const removeScene = async (): Promise<void> => {
    if (
      await askConfirm('씬 삭제', {
        message: `"${scene.name}" 씬을 삭제합니다.`,
        confirmLabel: '삭제',
        danger: true
      })
    )
      void remove(scene.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={sortable.setNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          className="group touch-none select-none"
          style={dndStyle(sortable)}
          onClick={(e) => (editMode ? toggleSelected(scene.id, e.shiftKey) : select(scene.id))}
        >
          {/* 이미지 (생성 중이면 스트리밍 프리뷰) */}
          <div
            className={cn(
              'relative overflow-hidden rounded-xl bg-paper transition',
              editMode && checked && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              sortable.isDragging && 'shadow-xl'
            )}
            style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
          >
            {src || live ? (
              <SceneCardImage
                src={src ?? ''}
                fullSrc={
                  scene.thumbnailPath ? imageUrl(scene.thumbnailPath, thumbnailRevision) : undefined
                }
                live={live}
              />
            ) : (
              <div className="flex h-full w-full cursor-pointer items-center justify-center text-faint">
                <ImageOff size={26} strokeWidth={1.3} />
              </div>
            )}

            {/* 생성 준비 중(프리뷰 뜨기 전) 스피너 */}
            {generating && !live && (
              <div className="absolute inset-0 grid place-items-center bg-black/40">
                <Loader2 size={28} className="animate-spin text-white" strokeWidth={2} />
              </div>
            )}

            {/* 좌측 상단: 예약 장수 · 생성 중/큐 잔여 장수 */}
            {(scene.reserveCount > 0 || remaining > 0) && (
              <div className="absolute left-2 top-2 flex items-center gap-1">
                {scene.reserveCount > 0 && (
                  <span
                    className="flex h-6 items-center rounded-lg bg-danger px-2 text-[11px] font-bold text-white shadow"
                    title={`예약 ${scene.reserveCount}장`}
                  >
                    예약 {scene.reserveCount.toLocaleString()}
                  </span>
                )}
                {remaining > 0 && (
                  <span
                    className="flex h-6 items-center gap-1 rounded-lg bg-accent px-2 text-[11px] font-bold text-white shadow dark:text-paper"
                    title={`이 씬 큐 잔여 ${remaining}장`}
                  >
                    {generating && <Loader2 size={11} className="animate-spin" />}
                    {generating
                      ? runTotal > 1
                        ? `생성 중 ${(runTotal - remaining).toLocaleString()} / ${runTotal.toLocaleString()}`
                        : '생성 중'
                      : `대기 · 남은 ${remaining}장`}
                  </span>
                )}
              </div>
            )}
            {/* 이 씬의 이번 묶음 진행 막대 (여러 장을 뽑을 때만) */}
            {generating && runTotal > 1 && (
              <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-black/30">
                <i
                  className="block h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${((runTotal - remaining) / runTotal) * 100}%` }}
                />
              </div>
            )}

            {/* 우측 상단 — 편집 체크박스 / 3점 메뉴 */}
            <div className="absolute right-2 top-2 flex items-center gap-1">
              {editMode ? (
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded border-2 transition',
                    checked ? 'border-accent bg-accent text-white' : 'border-white/80 bg-black/30'
                  )}
                >
                  {checked && <span className="text-[11px] leading-none">✓</span>}
                </span>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition hover:bg-black/70 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <MoreVertical size={14} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-40 p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MenuItem
                      icon={<Pencil size={13} />}
                      label="이름 변경"
                      onClick={() => void renameScene()}
                    />
                    <MenuItem
                      icon={<Copy size={13} />}
                      label="복제"
                      onClick={() => void duplicate(scene.id)}
                    />
                    <MenuItem
                      icon={<FolderOpen size={13} />}
                      label="폴더 열기"
                      onClick={() => void openFolder()}
                    />
                    <MenuItem
                      icon={<Trash2 size={13} />}
                      label="삭제"
                      danger
                      onClick={() => void removeScene()}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* 이미지 아래: 이름 · 이미지 장수 · 예약 +/- */}
          <div className="mt-2 flex h-10 items-center gap-2 px-0.5">
            <div className="min-w-0 flex-1">
              {editMode ? (
                <input
                  className="w-full truncate rounded-md bg-paper px-1.5 py-0.5 text-[13px] font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/40"
                  value={scene.name}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => void update(scene.id, { name: e.target.value })}
                />
              ) : (
                <div className="truncate text-[13px] font-semibold text-ink" title={scene.name}>
                  {scene.name}
                </div>
              )}
              <div className="mt-0.5 truncate text-[11px] tabular-nums text-faint">
                {scene.imageCount > 0 ? `이미지 ${scene.imageCount.toLocaleString()}장` : '아직 이미지 없음'}
              </div>
            </div>
            {/* 예약 +/- */}
            <div
              className={cn(
                'flex shrink-0 items-center rounded-lg p-0.5',
                scene.reserveCount > 0 ? 'bg-accent-soft text-accent' : 'bg-paper text-muted'
              )}
              title="예약 장수"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                className="grid size-6 place-items-center rounded-md hover:bg-surface-2 disabled:opacity-30"
                disabled={scene.reserveCount === 0}
                onClick={() => void adjustReserve(scene.id, -1)}
              >
                <Minus size={13} />
              </button>
              <EditableCount
                value={scene.reserveCount}
                min={0}
                max={9999}
                onCommit={(n) => void update(scene.id, { reserveCount: n })}
                className="min-w-5 text-center text-[12px] font-bold tabular-nums"
                inputClassName="w-10"
              />
              <button
                className="grid size-6 place-items-center rounded-md hover:bg-surface-2"
                onClick={() => void adjustReserve(scene.id, 1)}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void renameScene()}>
          <Pencil size={13} /> 이름 변경
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void duplicate(scene.id)}>
          <Copy size={13} /> 복제
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void openFolder()}>
          <FolderOpen size={13} className="text-amber-400" /> 폴더 열기
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={() => void removeScene()}>
          <Trash2 size={13} /> 삭제
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * 씬 생성 진행 줄: 이번 묶음의 완료 장수 / 전체 장수, 막대, 씬 완료 수, 속도와 남은 시간.
 * 씬 개수와 이미지 장수는 단위가 달라 큰 숫자는 장수로, 씬은 옆의 작은 글씨로 센다.
 */
function RunProgress(): React.JSX.Element | null {
  const run = useQueueRun((s) => s.run)
  if (!run || run.sceneTotal === 0 || run.total === 0) return null
  const finished = run.done + run.failed + run.cancelled
  const pct = Math.min(100, (finished / run.total) * 100)
  const eta = run.perMinute ? formatEta(run.remaining / run.perMinute) : null
  return (
    <div className="flex min-w-0 items-center gap-4 px-5 pb-3">
      <div className="shrink-0 whitespace-nowrap text-[13px] text-muted">
        <b className="mr-0.5 text-[20px] font-bold tabular-nums text-ink">{run.done.toLocaleString()}</b>/{' '}
        {run.total.toLocaleString()}장
      </div>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-paper">
        <i
          className="block h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="shrink-0 truncate whitespace-nowrap text-[12px] tabular-nums text-faint">
        씬 {run.sceneDone.toLocaleString()} / {run.sceneTotal.toLocaleString()}개 완료
        {run.failed > 0 && <span className="text-danger"> · 실패 {run.failed.toLocaleString()}</span>}
        {run.perMinute ? ` · 분당 약 ${Math.round(run.perMinute)}장` : ''}
        {eta ? ` · ${eta} 남음` : ' · 남은 시간 계산 중'}
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  danger
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
        danger && 'text-danger'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
