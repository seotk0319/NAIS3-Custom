import { create } from 'zustand'
import type { CharacterCard, CharacterCardPatch, ListFolder } from '@shared/types'
import { maxCharactersForModel, nextFreeCenter, CHARACTER_OVERLAP_DISTANCE } from '@shared/nai-models'
import { canonicalize, moveRow, toOrderEntries } from '../lib/folder-list'

// 캐릭터 상한은 생성 모델에 따라 다르다. generation-store가 이 스토어를 import하므로
// 순환을 피하려고 모델은 그쪽에서 알려준다.
let currentModel = (): string => ''
export function setCharacterModelSource(source: () => string): void {
  currentModel = source
}
export function characterLimit(): number {
  return maxCharactersForModel(currentModel())
}
const activeCenters = (items: CharacterCard[], except?: number): { x: number; y: number }[] =>
  items.filter((c) => c.enabled && c.id !== except).map((c) => c.center)

/**
 * 캐릭터 단일 리스트 모델 (공용 폴더 리스트 로직 사용):
 * - 카드가 직접 enabled(생성 포함)·위치·순서를 가진다
 * - 수백 개 전제: 시작 시 1회 로드, 변경은 낙관적 패치 + 즉시 IPC
 */
interface CharactersState {
  folders: ListFolder[]
  items: CharacterCard[]
  loaded: boolean
  overlayOpen: boolean
  toggleOverlay: () => void
  setOverlayOpen: (open: boolean) => void
  load: () => Promise<void>
  createCard: (folderId: number | null) => Promise<void>
  updateCard: (id: number, patch: CharacterCardPatch) => void
  /** 활성 캐릭터 전체 해제 */
  disableAll: () => void
  removeCard: (id: number) => void
  duplicateCard: (id: number) => Promise<void>
  pickThumbnail: (id: number) => Promise<void>
  clearThumbnail: (id: number) => Promise<void>
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setFolderColor: (id: number, color: string | null) => void
  removeFolder: (id: number) => void
  move: (activeKey: string, overKey: string) => void
  /** 메타데이터의 캐릭터를 라이브러리로 가져오기 (기존 enabled는 모두 해제 후 새로 추가) */
  importFromMetadata: (
    chars: { prompt: string; negativePrompt: string; center?: { x: number; y: number } }[]
  ) => Promise<void>
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  folders: [],
  items: [],
  loaded: false,
  overlayOpen: false,
  toggleOverlay: () => set({ overlayOpen: !get().overlayOpen }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),

  load: async () => {
    const { folders, items } = await window.nais.invoke('chars:list', undefined)
    set({ folders, items: canonicalize(folders, items), loaded: true })
  },

  createCard: async (folderId) => {
    const { id } = await window.nais.invoke('chars:create', { name: '', folderId })
    const card: CharacterCard = {
      id,
      name: '',
      prompt: '',
      negativePrompt: '',
      thumbnail: '',
      enabled: true,
      // NAI 웹처럼 켜진 캐릭터와 겹치지 않는 자리에 놓는다
      center: nextFreeCenter(activeCenters(get().items)),
      folderId
    }
    const { folders, items } = get()
    const next = canonicalize(folders, [...items, card])
    set({ items: next })
    get().updateCard(id, { enabled: true, center: card.center })
    void window.nais.invoke('chars:reorder', { order: toOrderEntries(folders, next) })
  },

  updateCard: (id, patch) => {
    // NAI는 동시 캐릭터 상한(V4.5 6명, V5 32명)을 넘으면 실패 — 넘겨 켜는 것을 막는다
    if (patch.enabled === true) {
      const others = get().items.filter((c) => c.enabled && c.id !== id)
      if (others.length >= characterLimit()) return // 무시 (토글 안 됨)
      // 다시 켜는 캐릭터가 켜진 캐릭터와 같은 자리면 빈 자리로 옮긴다
      const card = get().items.find((c) => c.id === id)
      const center = patch.center ?? card?.center
      if (
        center &&
        !patch.center &&
        others.some(
          (c) => Math.hypot(c.center.x - center.x, c.center.y - center.y) < CHARACTER_OVERLAP_DISTANCE
        )
      )
        patch = { ...patch, center: nextFreeCenter(others.map((c) => c.center)) }
    }
    set({ items: get().items.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
    void window.nais.invoke('chars:update', { id, patch })
  },

  disableAll: () => {
    const enabled = get().items.filter((c) => c.enabled)
    if (!enabled.length) return
    set({ items: get().items.map((c) => (c.enabled ? { ...c, enabled: false } : c)) })
    for (const c of enabled)
      void window.nais.invoke('chars:update', { id: c.id, patch: { enabled: false } })
  },

  removeCard: (id) => {
    set({ items: get().items.filter((c) => c.id !== id) })
    void window.nais.invoke('chars:delete', { id })
  },

  duplicateCard: async (id) => {
    await window.nais.invoke('chars:duplicate', { id })
    await get().load()
  },

  pickThumbnail: async (id) => {
    const { thumbnail } = await window.nais.invoke('chars:pickThumbnail', { id })
    if (thumbnail === null) return
    set({ items: get().items.map((c) => (c.id === id ? { ...c, thumbnail } : c)) })
  },
  clearThumbnail: async (id) => {
    set({ items: get().items.map((c) => (c.id === id ? { ...c, thumbnail: '' } : c)) })
    await window.nais.invoke('chars:clearThumbnail', { id })
  },

  createFolder: async (name) => {
    const { id } = await window.nais.invoke('chars:folderCreate', { name })
    set({ folders: [...get().folders, { id, name, collapsed: false, color: null }] })
  },

  renameFolder: (id, name) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) })
    void window.nais.invoke('chars:folderRename', { id, name })
  },

  toggleCollapse: (id) => {
    const folder = get().folders.find((f) => f.id === id)
    if (!folder) return
    set({
      folders: get().folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    })
    void window.nais.invoke('chars:folderCollapse', { id, collapsed: !folder.collapsed })
  },

  setFolderColor: (id, color) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, color } : f)) })
    void window.nais.invoke('chars:folderColor', { id, color })
  },

  removeFolder: (id) => {
    const { folders, items } = get()
    const nextItems = items.map((c) => (c.folderId === id ? { ...c, folderId: null } : c))
    const nextFolders = folders.filter((f) => f.id !== id)
    set({ folders: nextFolders, items: canonicalize(nextFolders, nextItems) })
    void window.nais.invoke('chars:folderDelete', { id })
  },

  importFromMetadata: async (chars) => {
    // 1) 기존 enabled 캐릭터 모두 해제 (메타 재현 = 정확히 그 캐릭터만)
    for (const c of get().items) if (c.enabled) get().updateCard(c.id, { enabled: false })
    // 2) 메타 캐릭터를 새 카드로 생성 (가져온 캐릭터 N)
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]
      const { id } = await window.nais.invoke('chars:create', {
        name: `가져온 캐릭터 ${i + 1}`,
        folderId: null
      })
      const card: CharacterCard = {
        id,
        name: `가져온 캐릭터 ${i + 1}`,
        prompt: ch.prompt,
        negativePrompt: ch.negativePrompt,
        thumbnail: '',
        enabled: true,
        center: ch.center ?? { x: 0.5, y: 0.5 },
        folderId: null
      }
      set({ items: canonicalize(get().folders, [...get().items, card]) })
      get().updateCard(id, {
        name: card.name,
        prompt: card.prompt,
        negativePrompt: card.negativePrompt,
        enabled: true,
        center: card.center
      })
    }
  },

  move: (activeKey, overKey) => {
    const { folders, items } = get()
    const next = moveRow(folders, items, activeKey, overKey)
    set(next)
    void window.nais.invoke('chars:reorder', { order: toOrderEntries(next.folders, next.items) })
  }
}))

/** 생성에 포함될 캐릭터 (정규 순서 = v4 use_order 순서) */
export function enabledCharacters(): CharacterCard[] {
  return useCharactersStore.getState().items.filter((c) => c.enabled && c.prompt.trim())
}
