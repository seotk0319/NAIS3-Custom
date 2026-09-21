import { create } from 'zustand'

interface CensorState {
  filePath: string | null
  filePaths: string[]
  index: number
  folderPath: string | null
  open: (filePath: string) => void
  openBatch: (folderPath: string, filePaths: string[]) => void
  move: (delta: number) => void
  close: () => void
}

export const useCensorStore = create<CensorState>((set) => ({
  filePath: null,
  filePaths: [],
  index: 0,
  folderPath: null,
  open: (filePath) => set({ filePath, filePaths: [filePath], index: 0, folderPath: null }),
  openBatch: (folderPath, filePaths) =>
    set({ filePath: filePaths[0] ?? null, filePaths, index: 0, folderPath }),
  move: (delta) =>
    set((state) => {
      if (state.filePaths.length === 0) return state
      const index = Math.min(state.filePaths.length - 1, Math.max(0, state.index + delta))
      return { index, filePath: state.filePaths[index] }
    }),
  close: () => set({ filePath: null, filePaths: [], index: 0, folderPath: null })
}))

/** 이미지가 표시되는 어느 화면에서든 같은 검열 편집기를 연다. */
export function openCensor(filePath: string): void {
  useCensorStore.getState().open(filePath)
}

export function openCensorBatch(folderPath: string, filePaths: string[]): void {
  useCensorStore.getState().openBatch(folderPath, filePaths)
}
