import { create } from 'zustand'
import type {
  ArenaArtist,
  ArenaDuel,
  ArenaEnqueueResult,
  ArenaPair,
  ArenaRender,
  ArenaSessionConfig,
  ArenaSessionSummary,
  ArenaSnapshot,
  ArenaVoteResult
} from '@shared/arena'
import { enqueueBlockedMessage } from './generation-store'
import { useLayoutStore } from './layout-store'
import { toast } from './toast-store'

/**
 * 그림체 월드컵 화면 상태. 세션의 진실 공급원은 메인 프로세스의 ArenaSnapshot이고,
 * 여기서는 마지막 스냅샷과 화면 선택만 들고 있는다.
 */

export type ArenaViewMode = 'session' | 'rank' | 'artists' | 'sessions' | 'start'

/** 확정 조합으로 네거티브 세션을 시작할 때 넘기는 값 */
export interface ArenaNegativeSeed {
  pairs: ArenaPair[]
  /** 어느 세션에서 왔는지 (표시용) */
  label: string
  config: ArenaSessionConfig
}

export interface ArenaLastVote {
  duel: ArenaDuel
  result: ArenaVoteResult
  at: number
}

export interface ArenaUndoBar {
  id: number
  message: string
  run: () => Promise<void>
}

interface ArenaState {
  currentSessionId: number | null
  snapshot: ArenaSnapshot | null
  sessions: ArenaSessionSummary[]
  sessionsLoaded: boolean
  artists: ArenaArtist[]
  artistsLoaded: boolean
  view: ArenaViewMode
  /** 첫 표시 때 한 번만 불러온다 (숨겨진 동안 일하지 않게) */
  started: boolean
  loading: boolean
  voting: boolean
  advancing: boolean
  creating: boolean
  enqueueing: boolean
  /** 숨겨진 동안 바뀐 게 있어 다시 보일 때 새로 읽어야 함 */
  dirty: boolean
  /** 대결 중에도 단계 화면(다음 단계로)을 먼저 보기 */
  peekStage: boolean
  negativeSeed: ArenaNegativeSeed | null
  lastVote: ArenaLastVote | null
  showTags: boolean
  undoBar: ArenaUndoBar | null

  start: () => void
  setView: (view: ArenaViewMode) => void
  setShowTags: (on: boolean) => void
  setPeekStage: (on: boolean) => void
  setNegativeSeed: (seed: ArenaNegativeSeed | null) => void
  showUndo: (message: string, run: () => Promise<void>) => void
  clearUndo: () => void

  openSession: (id: number) => Promise<void>
  newSession: () => void
  refresh: () => Promise<void>
  loadSessions: () => Promise<void>
  loadArtists: () => Promise<void>

  create: (config: ArenaSessionConfig, limit?: number) => Promise<boolean>
  vote: (result: ArenaVoteResult) => Promise<void>
  skip: () => Promise<void>
  undo: () => Promise<void>
  advance: (opts: {
    reviveIds?: number[]
    tuneComboId?: number
    limit?: number
  }) => Promise<boolean>
  retune: () => Promise<void>
  confirm: () => Promise<void>
  enqueue: (opts?: { limit?: number; retryFailed?: boolean }) => Promise<void>
  cancel: () => Promise<void>
  favorite: (comboId: number, favorite: boolean) => Promise<void>
  rename: (id: number, name: string) => Promise<void>
  removeSession: (id: number) => Promise<void>

  artistsAdd: (names: string[], list: 'liked' | 'avoided') => Promise<number>
  artistsUpdate: (
    tag: string,
    patch: { list?: 'liked' | 'avoided'; fixedWeight?: number | null }
  ) => Promise<void>
  artistsMove: (tags: string[], list: 'liked' | 'avoided') => Promise<void>
  artistsRemove: (tags: string[]) => Promise<void>
}

const SESSION_KEY = 'arena_session'
const TAGS_KEY = 'arena_show_tags'

function readSessionId(): number | null {
  const n = Number(localStorage.getItem(SESSION_KEY))
  return Number.isInteger(n) && n > 0 ? n : null
}

function writeSessionId(id: number | null): void {
  if (id == null) localStorage.removeItem(SESSION_KEY)
  else localStorage.setItem(SESSION_KEY, String(id))
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // "Error invoking remote method 'arena:vote': Error: ..." 앞부분은 사람에게 의미가 없다
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** layout-store의 CenterMode에 'arena'가 들어오기 전에도 컴파일되게 문자열로 비교한다 */
export function isArenaVisible(): boolean {
  return (useLayoutStore.getState().centerMode as string) === 'arena'
}

export function handleEnqueueResult(r: ArenaEnqueueResult | undefined): void {
  if (!r?.blockedReason) return
  if (r.blockedReason === 'pending')
    toast(
      '다른 생성이 대기열에 남아 있어서 아직 못 넣었어요. 끝나면 남은 이미지를 뽑아 주세요',
      'info'
    )
  else toast(enqueueBlockedMessage(r.blockedReason), 'error')
}

// 같은 내용이면 이전 객체를 그대로 둬서 화면이 다시 그려지지 않게 한다
function share<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

let refreshSeq = 0

export const useArenaStore = create<ArenaState>((set, get) => {
  const apply = (next: ArenaSnapshot | null, sessionId: number | null): void => {
    if (sessionId !== get().currentSessionId) return
    if (!next) {
      set({ snapshot: null })
      return
    }
    const cur = get().snapshot
    const prev = cur && cur.session.id === next.session.id ? cur : null
    set({
      snapshot: {
        ...next,
        session: share(prev?.session, next.session),
        combos: share(prev?.combos, next.combos),
        renders: share(prev?.renders, next.renders),
        progress: share(prev?.progress, next.progress),
        duel: share(prev?.duel, next.duel),
        wait: share(prev?.wait, next.wait),
        artistStats: share(prev?.artistStats, next.artistStats),
        reviveIds: share(prev?.reviveIds, next.reviveIds)
      },
      dirty: false
    })
  }

  const withSession = async (
    fn: (sessionId: number) => Promise<ArenaSnapshot | null>
  ): Promise<void> => {
    const id = get().currentSessionId
    if (id == null) return
    try {
      apply(await fn(id), id)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return {
    currentSessionId: readSessionId(),
    snapshot: null,
    sessions: [],
    sessionsLoaded: false,
    artists: [],
    artistsLoaded: false,
    view: readSessionId() == null ? 'start' : 'session',
    started: false,
    loading: false,
    voting: false,
    advancing: false,
    creating: false,
    enqueueing: false,
    dirty: false,
    peekStage: false,
    negativeSeed: null,
    lastVote: null,
    showTags: localStorage.getItem(TAGS_KEY) === '1',
    undoBar: null,

    start: () => {
      if (get().started) return
      set({ started: true })
      void get().loadSessions()
      void get().loadArtists()
      if (get().currentSessionId != null) void get().refresh()
    },
    setView: (view) => {
      set({ view })
      if (view === 'sessions') void get().loadSessions()
      if (view === 'artists' || view === 'start') void get().loadArtists()
    },
    setShowTags: (showTags) => {
      localStorage.setItem(TAGS_KEY, showTags ? '1' : '0')
      set({ showTags })
    },
    setPeekStage: (peekStage) => set({ peekStage }),
    setNegativeSeed: (negativeSeed) => set({ negativeSeed }),
    showUndo: (message, run) => {
      const id = Date.now()
      set({ undoBar: { id, message, run } })
      setTimeout(() => {
        if (get().undoBar?.id === id) set({ undoBar: null })
      }, 6000)
    },
    clearUndo: () => set({ undoBar: null }),

    openSession: async (id) => {
      writeSessionId(id)
      const same = get().currentSessionId === id
      set({
        currentSessionId: id,
        view: 'session',
        peekStage: false,
        ...(same ? {} : { snapshot: null, lastVote: null })
      })
      await get().refresh()
    },
    newSession: () => set({ view: 'start', peekStage: false }),
    refresh: async () => {
      const id = get().currentSessionId
      if (id == null) return
      const seq = ++refreshSeq
      set({ loading: true })
      try {
        const snap = await window.nais.invoke('arena:get', { id })
        if (seq !== refreshSeq) return
        if (!snap) {
          // 지워졌거나 없는 세션
          writeSessionId(null)
          set({ currentSessionId: null, snapshot: null, view: 'start' })
          return
        }
        apply(snap, id)
      } catch (e) {
        toast(errorText(e), 'error')
      } finally {
        if (seq === refreshSeq) set({ loading: false })
      }
    },
    loadSessions: async () => {
      try {
        const { items } = await window.nais.invoke('arena:sessions', undefined)
        set({ sessions: items, sessionsLoaded: true })
      } catch (e) {
        toast(errorText(e), 'error')
      }
    },
    loadArtists: async () => {
      try {
        const { items } = await window.nais.invoke('arena:artists', undefined)
        set({ artists: items, artistsLoaded: true })
      } catch (e) {
        toast(errorText(e), 'error')
      }
    },

    create: async (config, limit) => {
      if (get().creating) return false
      set({ creating: true })
      try {
        const res = await window.nais.invoke('arena:create', { config, limit })
        if (res.error || res.id == null) {
          toast(res.error || '세션을 만들지 못했어요', 'error')
          return false
        }
        handleEnqueueResult(res.enqueue)
        writeSessionId(res.id)
        set({
          currentSessionId: res.id,
          snapshot: null,
          lastVote: null,
          peekStage: false,
          view: 'session',
          negativeSeed: config.target === 'negative' ? null : get().negativeSeed
        })
        await get().refresh()
        void get().loadSessions()
        return true
      } catch (e) {
        toast(errorText(e), 'error')
        return false
      } finally {
        set({ creating: false })
      }
    },
    vote: async (result) => {
      const { snapshot, voting, currentSessionId } = get()
      if (!snapshot?.duel || voting || currentSessionId == null) return
      set({ voting: true, lastVote: { duel: snapshot.duel, result, at: Date.now() } })
      try {
        apply(
          await window.nais.invoke('arena:vote', { sessionId: currentSessionId, result }),
          currentSessionId
        )
      } catch (e) {
        set({ lastVote: null })
        toast(errorText(e), 'error')
      } finally {
        set({ voting: false })
      }
    },
    skip: async () => {
      if (get().voting) return
      set({ voting: true })
      try {
        await withSession((sessionId) => window.nais.invoke('arena:skip', { sessionId }))
      } finally {
        set({ voting: false })
      }
    },
    undo: async () => {
      if (get().voting || !get().snapshot?.canUndo) return
      set({ voting: true })
      try {
        await withSession((sessionId) => window.nais.invoke('arena:undo', { sessionId }))
        set({ lastVote: null })
      } finally {
        set({ voting: false })
      }
    },
    advance: async (opts) => {
      const id = get().currentSessionId
      if (id == null || get().advancing) return false
      set({ advancing: true })
      try {
        const res = await window.nais.invoke('arena:advance', { sessionId: id, ...opts })
        if (res.error) {
          toast(res.error, 'error')
          return false
        }
        handleEnqueueResult(res.enqueue)
        set({ peekStage: false, lastVote: null })
        apply(res.snapshot, id)
        void get().loadSessions()
        return true
      } catch (e) {
        toast(errorText(e), 'error')
        return false
      } finally {
        set({ advancing: false })
      }
    },
    retune: async () => {
      await withSession((sessionId) => window.nais.invoke('arena:retune', { sessionId }))
    },
    confirm: async () => {
      await withSession((sessionId) => window.nais.invoke('arena:confirm', { sessionId }))
      void get().loadSessions()
    },
    enqueue: async (opts) => {
      const id = get().currentSessionId
      if (id == null || get().enqueueing) return
      set({ enqueueing: true })
      try {
        const r = await window.nais.invoke('arena:enqueue', { sessionId: id, ...opts })
        handleEnqueueResult(r)
        if (!r.blockedReason) {
          toast(
            r.queued > 0 ? r.queued + '장을 대기열에 넣었어요' : '넣을 이미지가 없어요',
            'success'
          )
        }
        await get().refresh()
      } catch (e) {
        toast(errorText(e), 'error')
      } finally {
        set({ enqueueing: false })
      }
    },
    cancel: async () => {
      const id = get().currentSessionId
      if (id == null) return
      try {
        await window.nais.invoke('arena:cancel', { sessionId: id })
        toast('이 세션의 생성을 멈췄어요', 'info')
        await get().refresh()
      } catch (e) {
        toast(errorText(e), 'error')
      }
    },
    favorite: async (comboId, favorite) => {
      const snap = get().snapshot
      if (snap) {
        set({
          snapshot: {
            ...snap,
            combos: snap.combos.map((c) => (c.id === comboId ? { ...c, favorite } : c))
          }
        })
      }
      try {
        await window.nais.invoke('arena:favorite', { comboId, favorite })
      } catch (e) {
        toast(errorText(e), 'error')
        void get().refresh()
      }
    },
    rename: async (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      try {
        await window.nais.invoke('arena:rename', { id, name: trimmed })
        set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) })
        if (get().currentSessionId === id) void get().refresh()
      } catch (e) {
        toast(errorText(e), 'error')
      }
    },
    removeSession: async (id) => {
      const target = get().sessions.find((s) => s.id === id)
      try {
        await window.nais.invoke('arena:delete', { id })
      } catch (e) {
        toast(errorText(e), 'error')
        return
      }
      const wasCurrent = get().currentSessionId === id
      set({ sessions: get().sessions.filter((s) => s.id !== id) })
      if (wasCurrent) {
        writeSessionId(null)
        set({ currentSessionId: null, snapshot: null, lastVote: null })
      }
      get().showUndo('‘' + (target?.name ?? '세션') + '’ 세션을 지웠어요', async () => {
        await window.nais.invoke('arena:restore', { id })
        await get().loadSessions()
        if (wasCurrent && get().currentSessionId == null) {
          writeSessionId(id)
          set({ currentSessionId: id })
          void get().refresh()
        }
      })
    },

    artistsAdd: async (names, list) => {
      if (names.length === 0) return 0
      try {
        const { added } = await window.nais.invoke('arena:artistsAdd', { names, list })
        await get().loadArtists()
        return added
      } catch (e) {
        toast(errorText(e), 'error')
        return 0
      }
    },
    artistsUpdate: async (tag, patch) => {
      set({
        artists: get().artists.map((a) =>
          a.tag === tag
            ? {
                ...a,
                ...(patch.list ? { list: patch.list } : {}),
                ...(patch.fixedWeight !== undefined ? { fixedWeight: patch.fixedWeight } : {})
              }
            : a
        )
      })
      try {
        await window.nais.invoke('arena:artistsUpdate', { tag, ...patch })
      } catch (e) {
        toast(errorText(e), 'error')
        void get().loadArtists()
      }
    },
    artistsMove: async (tags, list) => {
      const moved = get().artists.filter((a) => tags.includes(a.tag) && a.list !== list)
      if (moved.length === 0) return
      const set0 = new Set(moved.map((a) => a.tag))
      set({ artists: get().artists.map((a) => (set0.has(a.tag) ? { ...a, list } : a)) })
      try {
        for (const a of moved) await window.nais.invoke('arena:artistsUpdate', { tag: a.tag, list })
      } catch (e) {
        toast(errorText(e), 'error')
      }
      void get().loadArtists()
      const where = list === 'avoided' ? '피하고 싶은' : '좋아하는'
      get().showUndo(moved.length + '명을 ' + where + ' 작가로 옮겼어요', async () => {
        for (const a of moved)
          await window.nais.invoke('arena:artistsUpdate', { tag: a.tag, list: a.list })
        await get().loadArtists()
      })
    },
    artistsRemove: async (tags) => {
      const removed = get().artists.filter((a) => tags.includes(a.tag))
      if (removed.length === 0) return
      set({ artists: get().artists.filter((a) => !tags.includes(a.tag)) })
      try {
        await window.nais.invoke('arena:artistsRemove', { tags })
      } catch (e) {
        toast(errorText(e), 'error')
        void get().loadArtists()
        return
      }
      get().showUndo(removed.length + '명을 지웠어요', async () => {
        for (const list of ['liked', 'avoided'] as const) {
          const names = removed.filter((a) => a.list === list).map((a) => a.tag)
          if (names.length) await window.nais.invoke('arena:artistsAdd', { names, list })
        }
        for (const a of removed) {
          if (a.fixedWeight != null)
            await window.nais.invoke('arena:artistsUpdate', {
              tag: a.tag,
              fixedWeight: a.fixedWeight
            })
        }
        await get().loadArtists()
      })
    }
  }
})

// ───────────────────────── 렌더 찾기 ─────────────────────────

const renderIndexCache = new WeakMap<ArenaRender[], Map<string, ArenaRender>>()

export function renderIndex(renders: ArenaRender[]): Map<string, ArenaRender> {
  let m = renderIndexCache.get(renders)
  if (!m) {
    m = new Map()
    for (const r of renders) m.set(r.comboId + ':' + r.slot, r)
    renderIndexCache.set(renders, m)
  }
  return m
}

/** 조합·장면 하나의 렌더. 그 렌더가 바뀔 때만 다시 그린다 */
export function useArenaRender(
  comboId: number | undefined,
  slot: number | undefined
): ArenaRender | undefined {
  return useArenaStore((s) =>
    comboId == null || slot == null || !s.snapshot
      ? undefined
      : renderIndex(s.snapshot.renders).get(comboId + ':' + slot)
  )
}

// ───────────────────────── 이벤트 ─────────────────────────

let unbindAll: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let sessionsTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void useArenaStore.getState().refresh()
  }, 300)
}

function scheduleSessions(): void {
  if (!useArenaStore.getState().sessionsLoaded) return
  if (sessionsTimer) clearTimeout(sessionsTimer)
  sessionsTimer = setTimeout(() => {
    sessionsTimer = null
    void useArenaStore.getState().loadSessions()
  }, 1000)
}

/** 'arena:changed' 구독. 여러 번 불러도 한 번만 묶인다 */
export function bindArenaEvents(): () => void {
  if (unbindAll) return () => {}
  const off = window.nais.on('arena:changed', (e) => {
    const st = useArenaStore.getState()
    if (e.kind === 'state') scheduleSessions()
    if (e.sessionId !== st.currentSessionId) return
    if (!isArenaVisible() || !st.started) {
      if (!st.dirty) useArenaStore.setState({ dirty: true })
      return
    }
    // 이미지 한 장이 끝나면 새로 읽기 전에 그 칸부터 채운다
    const snap = st.snapshot
    if (e.kind === 'render' && snap && e.renderId != null && e.state) {
      const idx = snap.renders.findIndex((r) => r.id === e.renderId)
      if (idx >= 0) {
        const old = snap.renders[idx]
        const nextFile = e.filePath ?? old.filePath
        if (old.state !== e.state || old.filePath !== nextFile) {
          const renders = snap.renders.slice()
          renders[idx] = { ...old, state: e.state, filePath: nextFile }
          useArenaStore.setState({ snapshot: { ...snap, renders } })
        }
      }
    }
    scheduleRefresh()
  })
  const offLayout = useLayoutStore.subscribe((s, prev) => {
    if (s.centerMode === prev.centerMode) return
    if ((s.centerMode as string) !== 'arena') return
    const st = useArenaStore.getState()
    if (!st.started) return
    if (st.dirty) void st.refresh()
    if (st.view === 'sessions') void st.loadSessions()
  })
  unbindAll = () => {
    off()
    offLayout()
    if (refreshTimer) clearTimeout(refreshTimer)
    if (sessionsTimer) clearTimeout(sessionsTimer)
    refreshTimer = null
    sessionsTimer = null
    unbindAll = null
  }
  return () => unbindAll?.()
}
