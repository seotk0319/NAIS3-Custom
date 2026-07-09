import { GalleryVertical, Images, LayoutGrid, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryItem } from '@shared/types'
import { cn } from '../lib/utils'
import { useGenerationStore } from '../stores/generation-store'
import { ImageContextMenu } from './image-context-menu'
import { Lightbox } from './lightbox'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const PAGE = 60
type Fit = 'square' | 'natural'

/**
 * 이미지 라이브러리 — 생성한 모든 이미지를 휴대폰 갤러리처럼 나열.
 * 상단에서 열 수(2~6)와 배열(정사각 크롭 / 원본 비율 메이슨리)을 고른다.
 * 히스토리 패널(우측 좁은 목록)과 달리 전체 이미지를 넓게 스크롤로 훑는 용도.
 */
export function LibraryView(): React.JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const [cols, setCols] = useState(() => Number(localStorage.getItem('library_cols')) || 4)
  const [fit, setFit] = useState<Fit>(
    () => (localStorage.getItem('library_fit') as Fit) || 'square'
  )

  // 새 이미지가 생성되면(historyTotal 변화) 첫 화면을 다시 불러와 최신본을 위에 반영
  const historyTotal = useGenerationStore((s) => s.historyTotal)

  const itemsRef = useRef<HistoryItem[]>([])
  itemsRef.current = items
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const setColsPersist = (n: number): void => {
    setCols(n)
    localStorage.setItem('library_cols', String(n))
  }
  const setFitPersist = (f: Fit): void => {
    setFit(f)
    localStorage.setItem('library_fit', f)
  }

  // 다음 페이지 추가 (무한 스크롤)
  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const offset = itemsRef.current.length
    const res = await window.nais.invoke('images:list', { limit: PAGE, offset })
    setTotal(res.total)
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id))
      return [...prev, ...res.items.filter((i) => !seen.has(i.id))]
    })
    loadingRef.current = false
    setLoading(false)
  }, [])

  // 첫 페이지(또는 현재까지 로드한 범위)를 다시 로드 — 최신 이미지가 위에 오도록
  const reload = useCallback(async (): Promise<void> => {
    const limit = Math.max(PAGE, itemsRef.current.length)
    const res = await window.nais.invoke('images:list', { limit, offset: 0 })
    setTotal(res.total)
    setItems(res.items)
  }, [])

  useEffect(() => {
    void reload()
  }, [historyTotal, reload])

  // 바닥 근처 도달 시 다음 페이지
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && itemsRef.current.length < total && !loadingRef.current) {
          void loadMore()
        }
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [total, loadMore])

  const onDelete = async (id: number): Promise<void> => {
    await window.nais.invoke('images:delete', { id })
    setItems((prev) => prev.filter((i) => i.id !== id))
    setTotal((t) => Math.max(0, t - 1))
    void useGenerationStore.getState().refreshHistory()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface">
      {/* 헤더 — 제목/개수 + 배열/열 수 컨트롤. 상단 얇은 영역은 창 드래그 */}
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Images size={16} className="text-muted" />
        <span className="text-[14px] font-semibold">라이브러리</span>
        <span className="font-mono text-[11px] text-faint">{total.toLocaleString()}</span>

        <div className="flex-1" />

        {/* 배열: 정사각 / 원본 비율 */}
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

        {/* 열 수 2~6 */}
        <div className="no-drag flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          {[2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setColsPersist(n)}
              className={cn(
                'grid h-6 w-6 place-items-center rounded text-[12px] font-medium transition-colors',
                cols === n ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* 갤러리 */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
            <Images size={40} strokeWidth={1.3} className="opacity-40" />
            <p className="text-[13px]">아직 생성한 이미지가 없습니다</p>
          </div>
        ) : fit === 'natural' ? (
          // 원본 비율 — CSS 컬럼 메이슨리 (휴대폰 갤러리의 자연스러운 높이)
          <div style={{ columnCount: cols, columnGap: '8px' }}>
            {items.map((item, i) => (
              <ImageContextMenu
                key={item.id}
                filePath={item.filePath}
                onDelete={() => void onDelete(item.id)}
              >
                <button
                  className="mb-2 block w-full overflow-hidden rounded-lg border border-line bg-paper transition-all [break-inside:avoid] hover:ring-2 hover:ring-accent/60"
                  title={`seed ${item.seed ?? '?'}`}
                  onClick={() => setLightboxIdx(i)}
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
            ))}
          </div>
        ) : (
          // 정사각 크롭 — 균일 그리드
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {items.map((item, i) => (
              <ImageContextMenu
                key={item.id}
                filePath={item.filePath}
                onDelete={() => void onDelete(item.id)}
              >
                <button
                  className="relative aspect-square overflow-hidden rounded-lg border border-line bg-paper transition-all hover:ring-2 hover:ring-accent/60"
                  title={`seed ${item.seed ?? '?'}`}
                  onClick={() => setLightboxIdx(i)}
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

      {lightboxIdx >= 0 && (
        <Lightbox
          filePaths={items.map((i) => i.filePath)}
          index={lightboxIdx}
          onIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
        />
      )}
    </div>
  )
}

/** 세그먼트 아이콘 버튼 (툴팁) */
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
