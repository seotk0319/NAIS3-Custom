import { ArrowLeft, ChevronLeft, ChevronRight, FolderDown, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '../../lib/utils'
import { useLayoutStore } from '../../stores/layout-store'
import { useMangaStore } from '../../stores/manga-store'
import { MangaPageView } from './manga-page'

/** 만화 크게 보기: 한 페이지씩, 좌우 화살표·키보드로 넘긴다 */
export function MangaReader(): React.JSX.Element | null {
  const snap = useMangaStore((s) => s.snap)
  const index = useMangaStore((s) => s.readerIndex)
  const setView = useMangaStore((s) => s.setView)
  const openReader = useMangaStore((s) => s.openReader)
  const render = useMangaStore((s) => s.render)
  const reseed = useMangaStore((s) => s.reseed)
  const exportPages = useMangaStore((s) => s.exportPages)
  const visible = useLayoutStore((s) => s.centerMode === 'manga')
  const pages = snap?.project.pages ?? []
  const i = Math.max(0, Math.min(pages.length - 1, index))
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown')
        openReader(Math.min(pages.length - 1, i + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') openReader(Math.max(0, i - 1))
      else if (e.key === 'Escape') setView('work')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, i, pages.length, openReader, setView])
  if (!snap || pages.length === 0) return null
  const p = snap.project
  const page = pages[i]
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-[#16161c] text-[#e8e8ee]">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <button
          onClick={() => setView('work')}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#26262f] px-3 text-[13px] font-semibold text-[#d5d5e0]"
        >
          <ArrowLeft size={15} /> 작업실
        </button>
        <b className="text-[16px]">{p.title}</b>
        <span className="text-[13px] text-[#8e8e9a]">
          {i + 1} / {pages.length}쪽
        </span>
        <div className="flex-1" />
        <button
          disabled={page.state === 'queued'}
          onClick={async () => {
            if (page.filePath) await reseed(page.id)
            void render(page.id)
          }}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#26262f] px-3 text-[13px] font-semibold text-[#d5d5e0] disabled:opacity-40"
        >
          <RefreshCw size={14} /> {page.filePath ? '이 페이지 다시 그리기' : '이 페이지 그리기'} ·
          V5 1장
        </button>
        <button
          onClick={() => void exportPages()}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#26262f] px-3 text-[13px] font-semibold text-[#d5d5e0]"
        >
          <FolderDown size={14} /> 내보내기
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-6 px-6">
        <Arrow disabled={i === 0} onClick={() => openReader(i - 1)}>
          <ChevronLeft size={22} />
        </Arrow>
        <div className="flex h-full min-h-0 items-center py-2">
          <MangaPageView
            project={p}
            page={page}
            className="h-full max-h-full shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
          />
        </div>
        <Arrow disabled={i >= pages.length - 1} onClick={() => openReader(i + 1)}>
          <ChevronRight size={22} />
        </Arrow>
      </div>
      <div className="flex shrink-0 justify-center gap-2.5 overflow-x-auto px-6 py-4 no-scrollbar">
        {pages.map((g, k) => (
          <button
            key={g.id}
            onClick={() => openReader(k)}
            className={cn(
              'w-12 shrink-0 rounded-md transition',
              k === i
                ? 'outline outline-2 outline-offset-2 outline-[#8b8cf5]'
                : 'opacity-55 hover:opacity-90'
            )}
          >
            <MangaPageView project={p} page={g} showState={false} className="w-full" />
          </button>
        ))}
      </div>
    </div>
  )
}

function Arrow({
  disabled,
  onClick,
  children
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-[#26262f] text-[#d5d5e0] disabled:opacity-25"
    >
      {children}
    </button>
  )
}
