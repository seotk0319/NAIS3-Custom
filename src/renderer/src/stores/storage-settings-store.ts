import { create } from 'zustand'

interface StorageSettingsState {
  stripExif: boolean
  historyDeleteFile: boolean
  loaded: boolean
  load: () => Promise<void>
  setStripExif: (value: boolean) => Promise<void>
  setHistoryDeleteFile: (value: boolean) => Promise<void>
}

export const useStorageSettingsStore = create<StorageSettingsState>((set, get) => ({
  stripExif: false,
  historyDeleteFile: false,
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const [stripExif, historyDeleteFile] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'strip_exif' }),
      window.nais.invoke('settings:get', { key: 'history_delete_file' })
    ])
    set({
      stripExif: stripExif.value === '1',
      historyDeleteFile: historyDeleteFile.value === '1',
      loaded: true
    })
  },
  setStripExif: async (value) => {
    set({ stripExif: value, loaded: true })
    await window.nais.invoke('settings:set', { key: 'strip_exif', value: value ? '1' : '0' })
  },
  setHistoryDeleteFile: async (value) => {
    set({ historyDeleteFile: value, loaded: true })
    await window.nais.invoke('settings:set', {
      key: 'history_delete_file',
      value: value ? '1' : '0'
    })
  }
}))
