import { Bell, Image, Images, LayoutGrid, Trophy, Wand2, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { useLayoutStore } from '../stores/layout-store'

type Page = 'main' | 'scene' | 'director' | 'library' | 'arena' | 'inbox'

const PAGES: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'main', label: '메인', icon: Image },
  { id: 'scene', label: '씬', icon: LayoutGrid },
  { id: 'director', label: '디렉터', icon: Wand2 },
  { id: 'library', label: '라이브러리', icon: Images },
  { id: 'arena', label: '그림체', icon: Trophy },
  { id: 'inbox', label: '알림', icon: Bell }
]

/**
 * 상단 중앙 페이지 네비게이션 (NAIS2 AnimatedNavBar 이식).
 * 활성 탭 표시(pill)는 버튼 위치를 미리 재 두고 transform으로만 옮긴다.
 * (layoutId 방식은 탭을 바꿀 때마다 화면 배치를 강제로 다시 계산해 전환이 끊겼다)
 */
export function PageNav(): React.JSX.Element {
  const centerMode = useLayoutStore((s) => s.centerMode)
  const setCenterMode = useLayoutStore((s) => s.setCenterMode)
  const hiddenPages = useLayoutStore((s) => s.hiddenPages)
  const [profile, setProfile] = useState(0)
  useEffect(() => {
    void window.nais.invoke('app:profile', undefined).then((v) => setProfile(v.profile))
  }, [])
  const visible = PAGES.filter(
    (p) => (p.id !== 'inbox' || profile === 1) && (p.id === 'main' || !hiddenPages.includes(p.id))
  )
  const navRef = useRef<HTMLElement>(null)
  const [boxes, setBoxes] = useState<Record<string, { x: number; w: number }>>({})
  const [animate, setAnimate] = useState(false)
  const visibleKey = visible.map((p) => p.id).join(',')
  // 버튼 위치는 목록이 바뀌거나 크기가 바뀔 때만 잰다 (탭 전환 때는 재지 않음)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = (): void => {
      const next: Record<string, { x: number; w: number }> = {}
      nav.querySelectorAll<HTMLButtonElement>('button[data-page]').forEach((b) => {
        next[b.dataset.page!] = { x: b.offsetLeft, w: b.offsetWidth }
      })
      setBoxes(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    // 글꼴이 늦게 로드되면 폭이 바뀐다
    void document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [visibleKey])
  // 첫 위치는 애니메이션 없이, 그다음부터 미끄러지게
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 50)
    return () => window.clearTimeout(t)
  }, [])
  const pill = boxes[centerMode]

  return (
    <nav
      ref={navRef}
      className="no-drag pointer-events-auto relative flex items-center gap-0.5 rounded-xl bg-surface-2 p-[3px]"
    >
      {pill && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-[3px] h-[34px] rounded-[9px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.04)] motion-reduce:transition-none',
            animate &&
              'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          )}
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      )}
      {visible.map((page) => {
        const active = centerMode === page.id
        return (
          <button
            key={page.id}
            data-page={page.id}
            onClick={() => setCenterMode(page.id)}
            className={cn(
              'relative h-[34px] whitespace-nowrap rounded-[9px] px-4 text-[13px] font-semibold transition-colors',
              active ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            <span className="relative z-10 flex items-center gap-2">
              <page.icon className={cn('size-4', active && 'text-accent')} />
              {page.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
