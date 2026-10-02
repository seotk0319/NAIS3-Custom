import { create } from 'zustand'
import type { TranslateStatus } from '@shared/translate'

// DeepL 키 연결 상태. 설정의 번역 섹션이 바꾸고, 알림 화면이 읽는다.
interface TranslateState {
  status: TranslateStatus | null
  load: () => Promise<void>
  setStatus: (status: TranslateStatus) => void
}
const none: TranslateStatus = { hasKey: false, tail: '', free: false }
export const useTranslateStore = create<TranslateState>((set) => ({
  status: null,
  load: async () => {
    try {
      set({ status: await window.nais.invoke('translate:status', undefined) })
    } catch {
      set({ status: none })
    }
  },
  setStatus: (status) => set({ status })
}))
