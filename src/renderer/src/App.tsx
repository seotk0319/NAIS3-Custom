import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { HistoryPanel } from './components/history-panel'
import { LoadingScreen } from './components/loading-screen'
import { Toaster } from './components/toaster'
import { PreviewPane } from './components/preview-pane'
import { DirectorMode } from './components/director-mode'
import { LibraryView } from './components/library-view'
import { InboxView } from './components/inbox-view'
import { ArenaView } from './components/arena/arena-view'
import { InpaintHost } from './components/inpaint-host'
import { CensorEditor } from './components/censor-editor'
import { ArtistTagsDialog } from './components/artist-tags-dialog'
import { MetadataDialog } from './components/metadata-dialog'
import { PromptPanel } from './components/prompt-panel'
import { SceneMode } from './components/scene-mode'
import { Titlebar } from './components/titlebar'
import { SettingsDialog } from './components/token-dialog'
import { TextPromptHost } from './components/text-prompt-host'
import { TooltipProvider } from './components/ui/tooltip'
import { useCharactersStore } from './stores/characters-store'
import { useFragmentsStore } from './stores/fragments-store'
import { useCharRefsStore, useVibesStore } from './stores/refs-store'
import { bindGenerationEvents, useGenerationStore } from './stores/generation-store'
import { bindSceneEvents } from './stores/scenes-store'
import { bindShortcuts, refreshWork, useShortcutsStore } from './stores/shortcuts-store'
import { bindUpdateEvents } from './stores/update-store'
import { bindNavMouse } from './lib/nav-history'
import { useLayoutStore, type CenterMode } from './stores/layout-store'
import { useThemeStore } from './stores/theme-store'

export default function App(): React.JSX.Element {
  const leftOpen = useLayoutStore((s) => s.leftOpen)
  const rightOpen = useLayoutStore((s) => s.rightOpen)
  const settingsOpen = useLayoutStore((s) => s.settingsOpen)
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const centerMode = useLayoutStore((s) => s.centerMode)
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  // 한 번 연 가운데 화면은 지우지 않고 숨겨 둔다. 탭을 옮길 때마다 씬 1,000개·디렉터 같은 큰 화면을
  // 새로 만들고 지우느라 끊기던 것을 없앤다. 패널을 여닫아도 가운데 화면은 다시 그리지 않는다.
  const [visited, setVisited] = useState<CenterMode[]>(() => [centerMode])
  if (!visited.includes(centerMode)) setVisited([...visited, centerMode])
  const views = useMemo(
    () =>
      visited.map((mode) => ({
        mode,
        node:
          mode === 'inbox' ? (
            <InboxView />
          ) : mode === 'arena' ? (
            <ArenaView />
          ) : mode === 'scene' ? (
            <SceneMode />
          ) : mode === 'director' ? (
            <DirectorMode />
          ) : mode === 'library' ? (
            <LibraryView />
          ) : (
            <PreviewPane />
          )
      })),
    [visited]
  )
  const [ready, setReady] = useState(false)
  // 좌우 패널: 한 번 만들면 지우지 않고 숨기기만 한다 (탭을 옮길 때마다 새로 만들던 비용 제거)
  const showLeft = leftOpen && centerMode !== 'inbox' && centerMode !== 'arena'
  const showRight = rightOpen && centerMode !== 'inbox' && centerMode !== 'arena'
  const [leftMounted, setLeftMounted] = useState(showLeft)
  const [rightMounted, setRightMounted] = useState(showRight)
  if (showLeft && !leftMounted) setLeftMounted(true)
  if (showRight && !rightMounted) setRightMounted(true)

  // 안 열어 본 탭은 앱이 한가할 때 미리 만들어 둔다 (처음 열 때 70~120ms 끊기던 것 제거)
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let timer = 0
    const order: CenterMode[] = ['scene', 'director', 'library', 'arena']
    // 알림 탭은 Custom 1에만 있다
    void window.nais.invoke('app:profile', undefined).then(({ profile }) => {
      if (profile === 1) order.push('inbox')
    })
    const next = (i: number): void => {
      if (cancelled || i >= order.length) return
      timer = window.setTimeout(() => {
        const run = (): void => {
          if (cancelled) return
          setVisited((v) => (v.includes(order[i]) ? v : [...v, order[i]]))
          next(i + 1)
        }
        if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 })
        else run()
      }, 1500)
    }
    next(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ready])

  // 사이드바 폭 드래그 조절
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useLayoutStore.getState().sidebarWidth
    const onMove = (ev: MouseEvent): void =>
      useLayoutStore.getState().setSidebarWidth(startW + (ev.clientX - startX))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    // 초기 하이드레이션 — 완료되면 로딩 스플래시 해제
    void (async () => {
      await Promise.allSettled([
        useThemeStore.getState().hydrate(),
        useLayoutStore.getState().hydrate(),
        useGenerationStore.getState().hydrate(),
        useCharactersStore.getState().load(),
        useFragmentsStore.getState().load(),
        useVibesStore.getState().load(),
        useCharRefsStore.getState().load(),
        useShortcutsStore.getState().hydrate()
      ])
      // 스플래시가 너무 순식간에 사라지지 않게 최소 표시 시간 확보
      setTimeout(() => setReady(true), 350)
    })()
    const unbindGen = bindGenerationEvents()
    const unbindScene = bindSceneEvents()
    const unbindKeys = bindShortcuts()
    const unbindUpdate = bindUpdateEvents()
    const unbindNav = bindNavMouse() // 마우스 4/5번 버튼 뒤로/앞으로
    // Ctrl/Cmd+R은 브라우저 기본 리로드 대신 작업 새로고침으로 처리한다.
    // F5는 재설정 가능한 단축키 시스템(refreshWork)이 처리한다.
    const onReloadKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const isReload =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')
      if (isReload) {
        e.preventDefault()
        void refreshWork()
      }
    }
    window.addEventListener('keydown', onReloadKey)
    return () => {
      unbindGen()
      unbindScene()
      unbindKeys()
      unbindUpdate()
      unbindNav()
      window.removeEventListener('keydown', onReloadKey)
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-paper">
        <Titlebar />
        <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
          {/* 폭은 한 번에 바뀌고(가운데 화면 배치 1회) 안쪽만 transform으로 미끄러져 들어온다 */}
          {leftMounted && (
            <div
              className={
                showLeft ? 'panel-in-left relative h-full shrink-0 overflow-hidden' : 'hidden'
              }
              style={{ width: sidebarWidth }}
            >
              <div style={{ width: sidebarWidth }} className="h-full">
                <PromptPanel />
              </div>
              {/* 폭 조절 핸들 */}
              <div
                className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-accent/30"
                onMouseDown={startResize}
              />
            </div>
          )}
          {views.map(({ mode, node }) => (
            <div
              key={mode}
              className={mode === centerMode ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}
            >
              {node}
            </div>
          ))}
          {rightMounted && (
            <div
              className={
                showRight ? 'panel-in-right h-full w-[240px] shrink-0 overflow-hidden' : 'hidden'
              }
            >
              <HistoryPanel />
            </div>
          )}
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <TextPromptHost />
        <InpaintHost />
        <CensorEditor />
        <MetadataDialog />
        <ArtistTagsDialog />
        <Toaster />
        <AnimatePresence>{!ready && <LoadingScreen key="loading" />}</AnimatePresence>
      </div>
    </TooltipProvider>
  )
}
