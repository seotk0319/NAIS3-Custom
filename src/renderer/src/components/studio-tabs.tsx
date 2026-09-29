import { BookOpenText, Sparkles, Trophy, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useLayoutStore, type CenterMode } from '../stores/layout-store'

/** 스튜디오 탭에 묶인 화면들 (상단에는 "스튜디오" 하나만 보인다) */
export const STUDIO_PAGES: { id: CenterMode; label: string; icon: LucideIcon }[] = [
  { id: 'arena', label: '그림체', icon: Trophy },
  { id: 'manga', label: '만화', icon: BookOpenText },
  { id: 'gpt', label: 'GPT 이미지', icon: Sparkles }
]

export function isStudioMode(mode: CenterMode): boolean {
  return STUDIO_PAGES.some((p) => p.id === mode)
}

/** 스튜디오에서 마지막으로 본 화면 (숨긴 화면은 건너뛴다) */
export function lastStudioMode(hidden: CenterMode[]): CenterMode | null {
  const visible = STUDIO_PAGES.filter((p) => !hidden.includes(p.id))
  if (!visible.length) return null
  const last = localStorage.getItem('studio_last') as CenterMode | null
  return visible.find((p) => p.id === last)?.id ?? visible[0].id
}

/** 스튜디오 화면 머리줄 왼쪽: 그림체 · 만화 · GPT 이미지 전환 */
export function StudioTabs(): React.JSX.Element {
  const centerMode = useLayoutStore((s) => s.centerMode)
  const setCenterMode = useLayoutStore((s) => s.setCenterMode)
  const hidden = useLayoutStore((s) => s.hiddenPages)
  const pages = STUDIO_PAGES.filter((p) => !hidden.includes(p.id))
  return (
    <div className="no-drag flex shrink-0 items-center gap-0.5 rounded-xl bg-paper p-1">
      {pages.map((p) => {
        const on = p.id === centerMode
        return (
          <button
            key={p.id}
            onClick={() => {
              localStorage.setItem('studio_last', p.id)
              setCenterMode(p.id)
            }}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-bold transition-colors',
              on ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
            )}
          >
            <p.icon size={15} className={on ? 'text-accent' : ''} />
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
