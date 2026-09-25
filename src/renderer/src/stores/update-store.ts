import { create } from 'zustand'
import type { IpcEventMap } from '@shared/types'

type UpdateStatus = IpcEventMap['update:status']

interface UpdateState {
  status: UpdateStatus['state'] | 'idle'
  version?: string
  percent: number
  message?: string
  portable: boolean
  /** 설치를 눌렀는데 생성이 도는 중이었음 */
  busy: boolean
  check: () => void
  start: () => void
  install: () => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  percent: 0,
  portable: false,
  busy: false,
  check: () => {
    set({ status: 'checking', message: undefined, busy: false })
    void window.nais.invoke('update:check', undefined)
  },
  start: () => {
    if (!get().portable) set({ status: 'downloading', percent: 0 })
    void window.nais.invoke('update:start', undefined)
  },
  install: () => {
    void window.nais.invoke('update:install', undefined).then((r) => set({ busy: !!r.busy }))
  }
}))

/** update:status 이벤트 구독 — App 마운트 시 1회 */
export function bindUpdateEvents(): () => void {
  return window.nais.on('update:status', (s) => {
    const prev = useUpdateStore.getState()
    useUpdateStore.setState({
      status: s.state,
      version: s.version ?? prev.version,
      percent: s.percent ?? prev.percent,
      message: s.message,
      portable: s.portable ?? prev.portable
    })
  })
}
