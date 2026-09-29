import { create } from 'zustand'
import type {
  GptAuthStatus,
  GptJob,
  GptModel,
  GptPromptMode,
  GptQuality,
  GptRef,
  GptRequest,
  GptSize
} from '@shared/gpt'
import type { HistoryItem } from '@shared/types'
import { toast } from './toast-store'

export interface GptRefItem extends GptRef {
  key: string
}

interface Form {
  prompt: string
  size: GptSize
  quality: GptQuality
  model: GptModel
  mode: GptPromptMode
  count: number
}

interface GptState extends Form {
  status: GptAuthStatus | null
  jobs: GptJob[]
  images: HistoryItem[]
  total: number
  refs: GptRefItem[]
  /** 실패한 장을 다시 보낼 때 쓰는 원래 요청 */
  requests: Record<string, GptRequest>
  setForm: (patch: Partial<Form>) => void
  addRefs: (refs: GptRef[]) => void
  removeRef: (key: string) => void
  clearRefs: () => void
  checkStatus: () => Promise<void>
  loadImages: (more?: boolean) => Promise<void>
  generate: () => Promise<void>
  retry: (jobId: string) => Promise<void>
  cancel: (jobId: string) => void
  clearFinished: () => void
}

const FORM_KEY = 'gpt_form'
const DEFAULT_FORM: Form = {
  prompt: '',
  size: 'auto',
  quality: 'auto',
  model: 'gpt-5.6-luna',
  mode: 'direct',
  count: 1
}

function loadForm(): Form {
  try {
    return {
      ...DEFAULT_FORM,
      ...(JSON.parse(localStorage.getItem(FORM_KEY) ?? '{}') as Partial<Form>)
    }
  } catch {
    return DEFAULT_FORM
  }
}

const PAGE = 60

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const useGptStore = create<GptState>((set, get) => ({
  ...loadForm(),
  status: null,
  jobs: [],
  images: [],
  total: 0,
  refs: [],
  requests: {},
  setForm: (patch) => {
    set(patch)
    const { prompt, size, quality, model, mode, count } = { ...get(), ...patch }
    localStorage.setItem(FORM_KEY, JSON.stringify({ prompt, size, quality, model, mode, count }))
  },
  addRefs: (refs) =>
    set({
      refs: [
        ...get().refs,
        ...refs.map((r) => ({ ...r, key: Math.random().toString(36).slice(2) }))
      ].slice(0, 16)
    }),
  removeRef: (key) => set({ refs: get().refs.filter((r) => r.key !== key) }),
  clearRefs: () => set({ refs: [] }),
  checkStatus: async () => {
    set({ status: await window.nais.invoke('gpt:status', undefined) })
  },
  loadImages: async (more = false) => {
    const offset = more ? get().images.length : 0
    const { items, total } = await window.nais.invoke('gpt:images', { limit: PAGE, offset })
    set({ images: more ? [...get().images, ...items] : items, total })
  },
  generate: async () => {
    const s = get()
    if (!s.prompt.trim()) {
      toast('무엇을 그릴지 적어 주세요', 'info')
      return
    }
    const request: GptRequest = {
      prompt: s.prompt,
      refs: s.refs.map(({ b64, mime, name }) => ({ b64, mime, name })),
      size: s.size,
      quality: s.quality,
      model: s.model,
      mode: s.mode
    }
    try {
      const { ids } = await window.nais.invoke('gpt:generate', { request, count: s.count })
      const requests = { ...get().requests }
      for (const id of ids) requests[id] = request
      set({ requests })
    } catch (e) {
      toast(message(e), 'error')
    }
  },
  retry: async (jobId) => {
    const request = get().requests[jobId]
    if (!request) return
    try {
      const { ids } = await window.nais.invoke('gpt:generate', { request, count: 1 })
      set({ requests: { ...get().requests, [ids[0]]: request } })
    } catch (e) {
      toast(message(e), 'error')
    }
  },
  cancel: (jobId) => void window.nais.invoke('gpt:cancel', { id: jobId }),
  clearFinished: () => void window.nais.invoke('gpt:clearFinished', undefined)
}))

let bound = false
export function bindGptEvents(): () => void {
  if (bound) return () => undefined
  bound = true
  const off = window.nais.on('gpt:changed', ({ jobs }) => {
    const prev = new Map(useGptStore.getState().jobs.map((j) => [j.id, j.state]))
    useGptStore.setState({ jobs })
    const newlyDone = jobs.some((j) => j.state === 'done' && prev.get(j.id) !== 'done')
    const newlyFailed = jobs.filter((j) => j.state === 'failed' && prev.get(j.id) !== 'failed')
    if (newlyDone) void useGptStore.getState().loadImages()
    if (newlyFailed.length === 1) toast(newlyFailed[0].error ?? 'GPT 생성 실패', 'error')
    else if (newlyFailed.length > 1) toast(newlyFailed.length + '장 생성 실패', 'error')
  })
  return () => {
    bound = false
    off()
  }
}

/** 파일·붙여넣기 이미지를 레퍼런스로 */
export async function fileToRef(file: File): Promise<GptRef | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return { b64, mime: file.type, name: file.name }
}

/** 앱 안 이미지 경로를 레퍼런스로 */
export async function pathToRef(filePath: string): Promise<GptRef | null> {
  const res = await window.nais.invoke('images:readForSource', { filePath })
  if (!('base64' in res)) return null
  const ext = filePath.toLowerCase().split('.').pop()
  const mime =
    ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return { b64: res.base64, mime, name: filePath.split(/[\\/]/).pop() }
}
