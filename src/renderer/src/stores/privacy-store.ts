import { create } from 'zustand'

/**
 * 프라이버시 모드: 설정한 시간 동안 이 창에서 마우스·키보드 움직임이 없으면 화면을 가리고 잠근다.
 * 밀어서 푼다. 생성은 잠겨 있어도 계속 돈다.
 */
export const PRIVACY_MINUTES = [5, 10, 15, 30] as const

interface PrivacyState {
  enabled: boolean
  minutes: number
  /** 최소화하면 바로 잠그기 */
  lockOnHide: boolean
  locked: boolean
  /** 잠긴 까닭 (안내 문구용) */
  reason: 'idle' | 'manual' | 'hidden'
  hydrate: () => Promise<void>
  setEnabled: (v: boolean) => void
  setMinutes: (v: number) => void
  setLockOnHide: (v: boolean) => void
  lock: (reason?: PrivacyState['reason']) => void
  unlock: () => void
}

function save(key: string, value: string): void {
  void window.nais.invoke('settings:set', { key, value })
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  enabled: false,
  minutes: 10,
  lockOnHide: false,
  locked: false,
  reason: 'idle',
  hydrate: async () => {
    const [en, min, hide] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'privacy_enabled' }),
      window.nais.invoke('settings:get', { key: 'privacy_minutes' }),
      window.nais.invoke('settings:get', { key: 'privacy_lock_on_hide' })
    ])
    const m = Number(min.value)
    set({
      enabled: en.value === '1',
      minutes: PRIVACY_MINUTES.includes(m as (typeof PRIVACY_MINUTES)[number]) ? m : 10,
      lockOnHide: hide.value === '1'
    })
  },
  setEnabled: (enabled) => {
    set({ enabled })
    save('privacy_enabled', enabled ? '1' : '0')
  },
  setMinutes: (minutes) => {
    set({ minutes })
    save('privacy_minutes', String(minutes))
  },
  setLockOnHide: (lockOnHide) => {
    set({ lockOnHide })
    save('privacy_lock_on_hide', lockOnHide ? '1' : '0')
  },
  lock: (reason = 'manual') => {
    if (get().locked) return
    // 가려진 뒤 키보드 입력이 아래 입력칸으로 새지 않게 포커스를 뺀다
    const active = document.activeElement as HTMLElement | null
    active?.blur?.()
    set({ locked: true, reason })
  },
  unlock: () => set({ locked: false })
}))
