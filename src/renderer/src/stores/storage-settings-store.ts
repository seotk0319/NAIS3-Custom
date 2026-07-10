import { create } from 'zustand'

interface StorageSettingsState {
  stripExif: boolean
  loaded: boolean
  load: () => Promise<void>
  setStripExif: (value: boolean) => Promise<void>
}

export const useStorageSettingsStore = create<StorageSettingsState>((set, get) => ({
  stripExif: false,
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const { value } = await window.nais.invoke('settings:get', { key: 'strip_exif' })
    set({ stripExif: value === '1', loaded: true })
  },
  setStripExif: async (value) => {
    set({ stripExif: value, loaded: true })
    await window.nais.invoke('settings:set', { key: 'strip_exif', value: value ? '1' : '0' })
  }
}))
