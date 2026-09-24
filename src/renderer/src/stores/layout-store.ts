import { create } from 'zustand'
import { recordNav } from '../lib/nav-history'

export type CenterMode = 'main' | 'scene' | 'director' | 'library' | 'inbox'

type PanelPrefs = Record<CenterMode, { left: boolean; right: boolean }>

/**
 * 탭마다 필요한 패널만 기본으로 연다. 생성 패널은 프롬프트를 쓰는 메인·씬에서,
 * 히스토리는 라이브러리를 뺀 곳에서. 사용자가 탭에서 토글하면 그 탭 값만 바뀐다.
 */
const DEFAULT_PANELS: PanelPrefs = {
  main: { left: true, right: true },
  scene: { left: true, right: true },
  director: { left: false, right: true },
  library: { left: false, right: false },
  inbox: { left: false, right: false }
}

interface LayoutState {
  leftOpen: boolean
  rightOpen: boolean
  /** 탭별 패널 열림 상태 — leftOpen/rightOpen은 현재 탭의 값을 비춘다 */
  panels: PanelPrefs
  settingsOpen: boolean
  centerMode: CenterMode
  /** 좌측 사이드바 폭 (드래그로 조절, 영속) */
  sidebarWidth: number
  /** 상단 탭에서 숨긴 페이지 (메인은 숨길 수 없음) */
  hiddenPages: CenterMode[]
  toggleLeft: () => void
  toggleRight: () => void
  setSettingsOpen: (open: boolean) => void
  setCenterMode: (mode: CenterMode) => void
  setSidebarWidth: (w: number) => void
  setPageHidden: (page: CenterMode, hidden: boolean) => void
  hydrate: () => Promise<void>
}

export const SIDEBAR_MIN = 340
export const SIDEBAR_MAX = 640

function persistPanels(panels: PanelPrefs): void {
  void window.nais.invoke('settings:set', { key: 'ui_panels', value: JSON.stringify(panels) })
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  leftOpen: true,
  rightOpen: true,
  panels: DEFAULT_PANELS,
  settingsOpen: false,
  centerMode: 'main',
  sidebarWidth: Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, Number(localStorage.getItem('sidebar_width')) || 400)
  ),
  setSidebarWidth: (w) => {
    const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
    set({ sidebarWidth: clamped })
    localStorage.setItem('sidebar_width', String(clamped))
  },
  hiddenPages: [],
  setCenterMode: (centerMode) => {
    if (centerMode !== get().centerMode) recordNav() // 마우스 뒤로/앞으로용 히스토리
    const p = get().panels[centerMode]
    set({ centerMode, leftOpen: p.left, rightOpen: p.right })
  },
  setPageHidden: (page, hidden) => {
    if (page === 'main') return // 메인은 항상 표시
    const hiddenPages = hidden
      ? [...new Set([...get().hiddenPages, page])]
      : get().hiddenPages.filter((p) => p !== page)
    set({ hiddenPages })
    void window.nais.invoke('settings:set', {
      key: 'ui_hidden_pages',
      value: JSON.stringify(hiddenPages)
    })
    // 지금 보고 있는 탭을 숨기면 메인으로
    if (hidden && get().centerMode === page) get().setCenterMode('main')
  },
  toggleLeft: () => {
    const { centerMode, panels } = get()
    const leftOpen = !get().leftOpen
    const next = { ...panels, [centerMode]: { ...panels[centerMode], left: leftOpen } }
    set({ leftOpen, panels: next })
    persistPanels(next)
  },
  toggleRight: () => {
    const { centerMode, panels } = get()
    const rightOpen = !get().rightOpen
    const next = { ...panels, [centerMode]: { ...panels[centerMode], right: rightOpen } }
    set({ rightOpen, panels: next })
    persistPanels(next)
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  hydrate: async () => {
    const [left, right, hidden, saved] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'ui_left_open' }),
      window.nais.invoke('settings:get', { key: 'ui_right_open' }),
      window.nais.invoke('settings:get', { key: 'ui_hidden_pages' }),
      window.nais.invoke('settings:get', { key: 'ui_panels' })
    ])
    let hiddenPages: CenterMode[] = []
    try {
      if (hidden.value) hiddenPages = JSON.parse(hidden.value) as CenterMode[]
    } catch {
      // 손상된 값은 무시
    }
    // 탭별 값이 없으면 기본값에 예전 전역 토글(메인·씬)을 얹는다.
    let panels: PanelPrefs = {
      ...DEFAULT_PANELS,
      main: { left: left.value !== '0', right: right.value !== '0' },
      scene: { left: left.value !== '0', right: right.value !== '0' }
    }
    try {
      if (saved.value) {
        const parsed = JSON.parse(saved.value) as Partial<PanelPrefs>
        panels = { ...panels, ...parsed }
      }
    } catch {
      // 손상된 값은 무시
    }
    const current = panels[get().centerMode]
    set({ panels, leftOpen: current.left, rightOpen: current.right, hiddenPages })
  }
}))
