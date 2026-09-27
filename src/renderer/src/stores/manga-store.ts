import { create } from 'zustand'
import type {
  MangaBrief,
  MangaCastInput,
  MangaDialogueMode,
  MangaIntent,
  MangaPanel,
  MangaProject,
  MangaSnapshot,
  MangaSummary,
  Poly
} from '@shared/manga'
import { enqueueBlockedMessage, useGenerationStore } from './generation-store'
import { toast } from './toast-store'

export type MangaView = 'start' | 'work' | 'reader' | 'editor'

interface MangaState {
  list: MangaSummary[]
  currentId: number | null
  snap: MangaSnapshot | null
  view: MangaView
  /** 작업실 오른쪽 미리보기·컷 나누기 대상 페이지 */
  pageId: string | null
  readerIndex: number
  creating: boolean
  loadList: () => Promise<void>
  open: (id: number) => Promise<void>
  reload: () => Promise<void>
  newStory: () => void
  setView: (v: MangaView) => void
  selectPage: (id: string | null) => void
  openReader: (index: number) => void
  create: (input: {
    brief: MangaBrief
    cast: MangaCastInput[]
    style: { prompt: string; negative: string }
  }) => Promise<void>
  expand: (req: {
    count: number
    intent: MangaIntent
    dialogue: MangaDialogueMode
    instruction?: string
    finish?: boolean
  }) => Promise<void>
  propose: () => Promise<void>
  accept: () => Promise<void>
  updatePanel: (
    panelId: string,
    patch: Partial<Pick<MangaPanel, 'description' | 'descriptionKo' | 'dialogueKo' | 'importance'>>
  ) => Promise<void>
  deletePanel: (panelId: string) => Promise<void>
  movePanel: (panelId: string, dir: -1 | 1) => Promise<void>
  setLayout: (pageId: string, layout: Poly[] | null) => Promise<void>
  reseed: (pageId: string) => Promise<void>
  update: (
    patch: Partial<Pick<MangaProject, 'title' | 'style' | 'ended'>> & {
      brief?: Partial<MangaBrief>
    }
  ) => Promise<void>
  remove: (id: number) => Promise<void>
  render: (pageId: string) => Promise<void>
  setAuto: (auto: boolean, autoRender: boolean) => Promise<void>
  exportPages: () => Promise<void>
}

function base(): ReturnType<typeof useGenerationStore.getState>['request'] {
  return useGenerationStore.getState().request
}

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  // IPC 오류는 "Error invoking remote method '…': Error: 문구" 형태로 온다
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const useMangaStore = create<MangaState>((set, get) => {
  const apply = (snap: MangaSnapshot | null): void => {
    if (!snap || snap.project.id !== get().currentId) return
    set({ snap })
  }
  const run = async (fn: () => Promise<MangaSnapshot | null | void>): Promise<void> => {
    try {
      const snap = await fn()
      if (snap) apply(snap)
    } catch (e) {
      toast(message(e), 'error')
    }
  }
  const id = (): number => {
    const v = get().currentId
    if (v == null) throw new Error('작품을 먼저 골라 주세요')
    return v
  }
  return {
    list: [],
    currentId: null,
    snap: null,
    view: 'start',
    pageId: null,
    readerIndex: 0,
    creating: false,
    loadList: async () => {
      const { items } = await window.nais.invoke('manga:list', undefined)
      set({ list: items })
    },
    open: async (pid) => {
      const snap = await window.nais.invoke('manga:get', { id: pid })
      if (!snap) return
      set({ currentId: pid, snap, view: 'work', pageId: null })
      localStorage.setItem('manga_current', String(pid))
    },
    reload: async () => {
      const cur = get().currentId
      if (cur == null) return
      apply(await window.nais.invoke('manga:get', { id: cur }))
    },
    newStory: () => set({ view: 'start', currentId: null, snap: null, pageId: null }),
    setView: (view) => set({ view }),
    selectPage: (pageId) => set({ pageId }),
    openReader: (readerIndex) => set({ view: 'reader', readerIndex }),
    create: async (input) => {
      set({ creating: true })
      try {
        const snap = await window.nais.invoke('manga:create', input)
        set({ currentId: snap.project.id, snap, view: 'work', pageId: null })
        localStorage.setItem('manga_current', String(snap.project.id))
        void get().loadList()
      } catch (e) {
        toast(message(e), 'error')
      } finally {
        set({ creating: false })
      }
    },
    expand: (req) => run(() => window.nais.invoke('manga:expand', { id: id(), ...req })),
    propose: () => run(() => window.nais.invoke('manga:propose', { id: id() })),
    accept: () => run(() => window.nais.invoke('manga:accept', { id: id() })),
    updatePanel: (panelId, patch) =>
      run(() => window.nais.invoke('manga:updatePanel', { id: id(), panelId, patch })),
    deletePanel: (panelId) =>
      run(() => window.nais.invoke('manga:deletePanel', { id: id(), panelId })),
    movePanel: (panelId, dir) =>
      run(() => window.nais.invoke('manga:movePanel', { id: id(), panelId, dir })),
    setLayout: (pageId, layout) =>
      run(() => window.nais.invoke('manga:setLayout', { id: id(), pageId, layout })),
    reseed: (pageId) => run(() => window.nais.invoke('manga:reseed', { id: id(), pageId })),
    update: (patch) => run(() => window.nais.invoke('manga:update', { id: id(), patch })),
    remove: async (pid) => {
      await window.nais.invoke('manga:delete', { id: pid })
      if (get().currentId === pid) get().newStory()
      void get().loadList()
    },
    render: async (pageId) => {
      try {
        const r = await window.nais.invoke('manga:render', { id: id(), pageId, base: base() })
        if (!r.ok) {
          const reason = r.reason ?? ''
          toast(
            reason === 'no-account' || reason === 'pending' || reason === 'busy'
              ? enqueueBlockedMessage(reason)
              : reason || '그리지 못했어요',
            'info'
          )
        }
      } catch (e) {
        toast(message(e), 'error')
      }
    },
    setAuto: (auto, autoRender) =>
      run(() => window.nais.invoke('manga:auto', { id: id(), auto, autoRender, base: base() })),
    exportPages: async () => {
      try {
        const r = await window.nais.invoke('manga:export', { id: id() })
        if (!r.count) toast('아직 다 그린 페이지가 없어요', 'info')
        else toast('완성 페이지 ' + r.count + '장을 폴더에 모았어요', 'success')
      } catch (e) {
        toast(message(e), 'error')
      }
    }
  }
})

let bound = false
/** 메인에서 작품이 바뀌면 지금 보는 작품과 목록을 새로 읽는다 */
export function bindMangaEvents(): () => void {
  if (bound) return () => undefined
  bound = true
  let listTimer: ReturnType<typeof setTimeout> | undefined
  const off = window.nais.on('manga:changed', ({ projectId }) => {
    const st = useMangaStore.getState()
    if (projectId === st.currentId) void st.reload()
    clearTimeout(listTimer)
    listTimer = setTimeout(() => void useMangaStore.getState().loadList(), 400)
  })
  return () => {
    bound = false
    off()
  }
}
