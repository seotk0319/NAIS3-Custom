import { create } from 'zustand'
import { useGenerationStore } from './generation-store'
import { useLayoutStore } from './layout-store'
import { totalReserved, useScenesStore } from './scenes-store'

export type ShortcutAction =
  | 'generate'
  | 'toggleLeft'
  | 'toggleRight'
  | 'openSettings'
  | 'modeMain'
  | 'modeScene'

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  generate: '생성 / 씬 생성',
  toggleLeft: '프롬프트 패널 토글',
  toggleRight: '히스토리 패널 토글',
  openSettings: '설정 열기',
  modeMain: '메인 모드',
  modeScene: '씬 모드'
}

const DEFAULTS: Record<ShortcutAction, string> = {
  generate: 'Mod+Enter',
  toggleLeft: 'Mod+[',
  toggleRight: 'Mod+]',
  openSettings: 'Mod+,',
  modeMain: 'Mod+1',
  modeScene: 'Mod+2'
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

/** KeyboardEvent → 정규화 콤보 문자열 (예: "Mod+Enter") */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const mod = ['Meta', 'Control', 'Shift', 'Alt']
  if (mod.includes(e.key)) return null // 수정자만 눌린 상태는 무시
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('Mod')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join('+')
}

/** 표시용 (⌘/Ctrl, ↵ 등) */
export function formatCombo(combo: string): string {
  return combo
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Enter', '↵')
    .replace('Shift', '⇧')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .split('+')
    .join(' ')
}

interface ShortcutsState {
  bindings: Record<ShortcutAction, string>
  recording: ShortcutAction | null
  setRecording: (a: ShortcutAction | null) => void
  setBinding: (a: ShortcutAction, combo: string) => void
  resetDefaults: () => void
  hydrate: () => Promise<void>
}

function runAction(action: ShortcutAction): void {
  const layout = useLayoutStore.getState()
  switch (action) {
    case 'generate': {
      if (layout.centerMode === 'scene') {
        const scenes = useScenesStore.getState().scenes
        if (totalReserved(scenes) > 0) void useScenesStore.getState().generateReserved()
      } else {
        void useGenerationStore.getState().generate()
      }
      break
    }
    case 'toggleLeft':
      layout.toggleLeft()
      break
    case 'toggleRight':
      layout.toggleRight()
      break
    case 'openSettings':
      layout.setSettingsOpen(true)
      break
    case 'modeMain':
      layout.setCenterMode('main')
      break
    case 'modeScene':
      layout.setCenterMode('scene')
      break
  }
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  bindings: { ...DEFAULTS },
  recording: null,
  setRecording: (recording) => set({ recording }),
  setBinding: (a, combo) => {
    const bindings = { ...get().bindings, [a]: combo }
    set({ bindings, recording: null })
    void window.nais.invoke('settings:set', { key: 'shortcuts', value: JSON.stringify(bindings) })
  },
  resetDefaults: () => {
    set({ bindings: { ...DEFAULTS } })
    void window.nais.invoke('settings:set', {
      key: 'shortcuts',
      value: JSON.stringify(DEFAULTS)
    })
  },
  hydrate: async () => {
    const { value } = await window.nais.invoke('settings:get', { key: 'shortcuts' })
    if (value) {
      try {
        set({ bindings: { ...DEFAULTS, ...JSON.parse(value) } })
      } catch {
        /* 무시 */
      }
    }
  }
}))

/** 전역 키다운 핸들러 — App에서 1회 바인딩 */
export function bindShortcuts(): () => void {
  const handler = (e: KeyboardEvent): void => {
    const st = useShortcutsStore.getState()
    // 단축키 녹화 중이면 여기서 처리하지 않음 (설정 UI가 직접 캡처)
    if (st.recording) return
    const combo = comboFromEvent(e)
    if (!combo) return
    const entry = (Object.entries(st.bindings) as [ShortcutAction, string][]).find(
      ([, c]) => c === combo
    )
    if (!entry) return
    // 텍스트 입력 중엔 Enter 단독 등은 방해하지 않되, Mod 조합 단축키는 허용
    const target = e.target as HTMLElement | null
    const typing =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
    if (typing && !e.metaKey && !e.ctrlKey) return
    e.preventDefault()
    runAction(entry[0])
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
