import { BookOpenText, FolderDown, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { askConfirm } from '../../stores/dialog-store'
import { useLayoutStore } from '../../stores/layout-store'
import { bindMangaEvents, useMangaStore } from '../../stores/manga-store'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select'
import { MangaEditor } from './manga-editor'
import { MangaReader } from './manga-reader'
import { MangaStart } from './manga-start'
import { MangaWork } from './manga-work'
import { StudioTabs } from '../studio-tabs'

let autoOpened = false

/** 만화 탭. 이야기(글 모델) → 컷 → 페이지 한 장(V5 인페인팅)으로 만화를 만든다 */
export function MangaView(): React.JSX.Element {
  const visible = useLayoutStore((s) => s.centerMode === 'manga')
  const view = useMangaStore((s) => s.view)
  const snap = useMangaStore((s) => s.snap)

  useEffect(() => bindMangaEvents(), [])
  useEffect(() => {
    if (!visible) return
    const st = useMangaStore.getState()
    void st.loadList()
    // 앱을 켠 뒤 처음 열 때만 지난 작품을 연다 (새 이야기로 옮긴 뒤엔 그대로 둔다)
    if (!autoOpened && st.currentId == null) {
      autoOpened = true
      const last = Number(localStorage.getItem('manga_current'))
      if (last) void st.open(last)
    }
  }, [visible])

  const body =
    view === 'start' || !snap ? (
      <MangaStart />
    ) : view === 'reader' ? (
      <MangaReader />
    ) : view === 'editor' ? (
      <MangaEditor />
    ) : (
      <MangaWork />
    )
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-surface">
      {view !== 'reader' && <Header />}
      <div
        className={
          view === 'reader' ? 'flex min-h-0 flex-1 p-3' : 'flex min-h-0 flex-1 flex-col px-5 pb-5'
        }
      >
        {body}
      </div>
    </div>
  )
}

function Header(): React.JSX.Element {
  const list = useMangaStore((s) => s.list)
  const currentId = useMangaStore((s) => s.currentId)
  const view = useMangaStore((s) => s.view)
  const open = useMangaStore((s) => s.open)
  const newStory = useMangaStore((s) => s.newStory)
  const remove = useMangaStore((s) => s.remove)
  const exportPages = useMangaStore((s) => s.exportPages)
  const isNew = view === 'start' || currentId == null
  const current = list.find((m) => m.id === currentId)
  return (
    <div className="drag flex h-16 shrink-0 items-center gap-3 px-5">
      <StudioTabs />
      <Select
        value={isNew ? 'new' : String(currentId)}
        onValueChange={(v) => (v === 'new' ? newStory() : void open(Number(v)))}
        onOpenChange={(o) => o && void useMangaStore.getState().loadList()}
      >
        <SelectTrigger className="no-drag h-9 w-[260px] shrink-0 rounded-xl border-transparent bg-paper px-3">
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
            {isNew ? (
              <>
                <Plus size={14} className="text-accent" /> 새 이야기
              </>
            ) : (
              <>
                <BookOpenText size={14} className="shrink-0 text-accent" />
                <span className="truncate">{current?.title ?? '작품'}</span>
              </>
            )}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">+ 새 이야기</SelectItem>
          {list.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.title} · {m.ended ? '완성' : m.pages + '/' + m.targetPages + '쪽'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex-1" />
      {!isNew && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="no-drag grid size-9 place-items-center rounded-xl bg-paper text-muted hover:text-ink">
              <MoreHorizontal size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <button
              onClick={() => void exportPages()}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-ink hover:bg-surface-2"
            >
              <FolderDown size={14} /> 완성본 폴더로 모으기
            </button>
            <button
              onClick={async () => {
                if (currentId == null) return
                if (
                  await askConfirm('작품 지우기', {
                    message:
                      '"' +
                      (current?.title ?? '') +
                      '" 작품을 지울까요? 그린 이미지 파일은 남아요.',
                    confirmLabel: '지우기',
                    danger: true
                  })
                )
                  void remove(currentId)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-danger hover:bg-surface-2"
            >
              <Trash2 size={14} /> 작품 지우기
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
