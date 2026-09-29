import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { GPT_MODELS, GPT_QUALITIES, GPT_SIZES, type GptJob } from '@shared/gpt'
import type { HistoryItem } from '@shared/types'
import { thumbnailUrl } from '../../lib/constants'
import { droppedImagePaths, hasImageDrop, setImagePathDrag } from '../../lib/image-drag'
import { cn } from '../../lib/utils'
import { bindGptEvents, fileToRef, pathToRef, useGptStore } from '../../stores/gpt-store'
import { useLayoutStore } from '../../stores/layout-store'
import { toast } from '../../stores/toast-store'
import { ImageContextMenu } from '../image-context-menu'
import { Lightbox } from '../lightbox'
import { StudioTabs } from '../studio-tabs'
import { ContextMenuItem } from '../ui/context-menu'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select'

/** 스튜디오 → GPT 이미지. ChatGPT 로그인(Codex)으로 이미지를 만든다 */
export function GptView(): React.JSX.Element {
  const visible = useLayoutStore((s) => s.centerMode === 'gpt')
  const status = useGptStore((s) => s.status)
  useEffect(() => bindGptEvents(), [])
  useEffect(() => {
    if (!visible) return
    const st = useGptStore.getState()
    void st.checkStatus()
    void st.loadImages()
    void window.nais
      .invoke('gpt:jobs', undefined)
      .then(({ jobs }) => useGptStore.setState({ jobs }))
  }, [visible])
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-surface">
      <div className="drag flex h-16 shrink-0 items-center gap-3 px-5">
        <StudioTabs />
        <div className="flex-1" />
        <LoginChip />
      </div>
      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <Form disabled={status ? !status.ready : false} />
        <Results />
      </div>
    </div>
  )
}

function LoginChip(): React.JSX.Element | null {
  const status = useGptStore((s) => s.status)
  const check = useGptStore((s) => s.checkStatus)
  if (!status) return null
  return (
    <button
      onClick={() => void check()}
      title={status.ready ? 'ChatGPT 로그인 확인됨 · 눌러서 다시 확인' : status.reason}
      className="no-drag flex h-9 items-center gap-2 rounded-xl bg-paper px-3 text-[12.5px] font-semibold text-muted hover:text-ink"
    >
      <i className={cn('size-2 rounded-full', status.ready ? 'bg-emerald-500' : 'bg-danger')} />
      {status.ready
        ? 'ChatGPT 연결됨' + (status.plan ? ' · ' + status.plan : '')
        : 'ChatGPT 로그인 필요'}
      <RefreshCw size={12} className="opacity-60" />
    </button>
  )
}

// ───────────────────────── 왼쪽: 만들기 ─────────────────────────

function Form({ disabled }: { disabled: boolean }): React.JSX.Element {
  const s = useGptStore()
  const status = s.status
  const fileRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const running = s.jobs.filter((j) => j.state === 'running' || j.state === 'retrying').length

  const addFiles = async (files: File[]): Promise<void> => {
    const refs = (await Promise.all(files.map(fileToRef))).filter((r) => !!r)
    if (refs.length) s.addRefs(refs)
  }
  const addPaths = async (paths: string[]): Promise<void> => {
    const refs = (await Promise.all(paths.map(pathToRef))).filter((r) => !!r)
    if (refs.length) s.addRefs(refs)
    else toast('이미지를 읽지 못했어요', 'error')
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  return (
    <aside className="flex w-[400px] shrink-0 flex-col rounded-2xl bg-paper" onPaste={onPaste}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 no-scrollbar">
        {status && !status.ready && (
          <div className="mb-4 rounded-2xl bg-danger/10 px-4 py-3 text-[12.5px] leading-relaxed text-danger">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle size={14} /> ChatGPT 로그인이 필요해요
            </div>
            <div className="mt-1">{status.reason}</div>
            <div className="mt-1.5 text-muted">
              Codex에서 ChatGPT로 로그인하면 여기서 바로 쓸 수 있어요. 로그인 뒤 오른쪽 위 연결
              표시를 눌러 주세요.
            </div>
          </div>
        )}
        <div className="text-[15px] font-bold text-ink">무엇을 그릴까요?</div>
        <textarea
          value={s.prompt}
          onChange={(e) => s.setForm({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void s.generate()
            }
          }}
          rows={8}
          placeholder="예) 창가 카페에서 코코아를 든 소녀, 부드러운 아침 햇살, 애니메이션 일러스트 — 말풍선 글자도 그대로 써져요"
          className="mt-2 w-full resize-none rounded-2xl bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/30"
        />

        <Label
          title="레퍼런스"
          hint={s.refs.length ? s.refs.length + '장' : '끌어 놓기 · 붙여넣기 · 파일'}
        />
        <div
          onDragOver={(e) => {
            if (!hasImageDrop(e)) return
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false)
            if (!hasImageDrop(e)) return
            e.preventDefault()
            const paths = droppedImagePaths(e)
            if (paths.length) void addPaths(paths)
            else void addFiles(Array.from(e.dataTransfer.files))
          }}
          className={cn(
            'rounded-2xl border-[1.5px] border-dashed p-2.5 transition',
            over ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
          )}
        >
          {s.refs.length > 0 && (
            <div className="mb-2 grid grid-cols-5 gap-1.5">
              {s.refs.map((r) => (
                <div
                  key={r.key}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-paper"
                >
                  <img
                    src={'data:' + r.mime + ';base64,' + r.b64}
                    className="size-full object-cover"
                    draggable={false}
                  />
                  <button
                    onClick={() => s.removeRef(r.key)}
                    className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold text-muted hover:bg-paper hover:text-ink"
          >
            <ImagePlus size={15} /> {s.refs.length ? '더 넣기' : '이미지 넣기'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>

        <Label title="크기" />
        <Seg value={s.size} options={GPT_SIZES} onChange={(v) => s.setForm({ size: v })} />
        <Label title="품질" />
        <Seg
          value={s.quality}
          options={GPT_QUALITIES}
          onChange={(v) => s.setForm({ quality: v })}
        />
        <Label
          title="프롬프트"
          hint={s.mode === 'direct' ? '적은 그대로 그려요' : '모델이 알아서 다듬어요'}
        />
        <Seg
          value={s.mode}
          options={[
            { value: 'direct', label: '그대로' },
            { value: 'auto', label: '알아서 다듬기' }
          ]}
          onChange={(v) => s.setForm({ mode: v })}
        />
        <Label title="모델" />
        <Select value={s.model} onValueChange={(v) => s.setForm({ model: v as typeof s.model })}>
          <SelectTrigger className="h-10 w-full rounded-xl border-transparent bg-surface px-3 text-[13px] font-semibold">
            {s.model}
          </SelectTrigger>
          <SelectContent>
            {GPT_MODELS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-t border-line p-4">
        <div className="mb-3 flex items-center justify-between text-[12.5px] text-muted">
          <span>ChatGPT 요금제 한도를 써요 · Anlas 없음</span>
          {running > 0 && <span className="font-semibold text-accent">생성 중 {running}장</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-12 items-center rounded-xl bg-surface">
            <button
              className="grid h-full w-9 place-items-center text-muted"
              onClick={() => s.setForm({ count: Math.max(1, s.count - 1) })}
            >
              <Minus size={14} />
            </button>
            <b className="w-7 text-center text-[15px] tabular-nums text-ink">{s.count}</b>
            <button
              className="grid h-full w-9 place-items-center text-muted"
              onClick={() => s.setForm({ count: s.count + 1 })}
            >
              <Plus size={14} />
            </button>
          </div>
          <button
            disabled={disabled}
            onClick={() => void s.generate()}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-bold text-white transition hover:opacity-90 disabled:opacity-50 dark:text-paper"
          >
            <Sparkles size={16} /> 생성 · {s.count}장
          </button>
        </div>
      </div>
    </aside>
  )
}

function Label({ title, hint }: { title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="mb-2 mt-5 flex items-baseline justify-between">
      <span className="text-[13px] font-bold text-ink">{title}</span>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </div>
  )
}

function Seg<T extends string>(props: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="flex rounded-xl bg-surface p-1">
      {props.options.map((o) => (
        <button
          key={o.value}
          onClick={() => props.onChange(o.value)}
          className={cn(
            'h-8 flex-1 rounded-lg text-[12.5px] font-semibold transition',
            props.value === o.value
              ? 'bg-accent text-white shadow-sm dark:text-paper'
              : 'text-muted hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ───────────────────────── 오른쪽: 결과 ─────────────────────────

function Results(): React.JSX.Element {
  const images = useGptStore((s) => s.images)
  const total = useGptStore((s) => s.total)
  const jobs = useGptStore((s) => s.jobs)
  const loadImages = useGptStore((s) => s.loadImages)
  const clearFinished = useGptStore((s) => s.clearFinished)
  const [lightbox, setLightbox] = useState(-1)
  const live = jobs.filter((j) => j.state !== 'done' && j.state !== 'cancelled')
  const hasFinished = jobs.some((j) => j.state === 'failed')
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl bg-paper/60">
      <div className="flex items-center gap-3 px-5 pb-2 pt-4">
        <h2 className="text-[18px] font-bold tracking-tight text-ink">결과</h2>
        <span className="text-[13px] text-faint">{total.toLocaleString()}장</span>
        <div className="flex-1" />
        {hasFinished && (
          <button
            onClick={clearFinished}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-muted hover:bg-surface hover:text-ink"
          >
            <Trash2 size={13} /> 실패한 작업 지우기
          </button>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 no-scrollbar"
        onScroll={(e) => {
          const el = e.currentTarget
          if (images.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 400)
            void loadImages(true)
        }}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {live.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
          {images.map((img, i) => (
            <ResultCard key={img.id} item={img} onOpen={() => setLightbox(i)} />
          ))}
        </div>
        {images.length === 0 && live.length === 0 && (
          <div className="grid h-[60%] place-items-center text-center text-[13px] text-faint">
            <div>
              <Sparkles size={28} className="mx-auto mb-2 text-accent/60" />
              왼쪽에 그릴 것을 적고 생성을 눌러 주세요.
              <br />
              여러 장은 동시에 그려져요.
            </div>
          </div>
        )}
      </div>
      {lightbox >= 0 && (
        <Lightbox
          filePaths={images.map((x) => x.filePath)}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(-1)}
        />
      )}
    </section>
  )
}

function JobCard({ job }: { job: GptJob }): React.JSX.Element {
  const cancel = useGptStore((s) => s.cancel)
  const retry = useGptStore((s) => s.retry)
  const [, tick] = useState(0)
  useEffect(() => {
    if (job.state === 'failed') return
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [job.state])
  const secs = Math.floor((Date.now() - job.startedAt) / 1000)
  const wait = job.retryAt ? Math.max(0, Math.ceil((job.retryAt - Date.now()) / 1000)) : 0
  const failed = job.state === 'failed'
  return (
    <div
      className={cn(
        'relative flex aspect-square flex-col overflow-hidden rounded-2xl p-3',
        failed ? 'bg-danger/10' : 'bg-surface'
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-bold">
        {failed ? (
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle size={13} /> 실패
          </span>
        ) : job.state === 'retrying' ? (
          <span className="flex items-center gap-1 text-amber-500">
            <Loader2 size={13} className="animate-spin" /> {wait}초 뒤 다시
          </span>
        ) : (
          <span className="flex items-center gap-1 text-accent">
            <Loader2 size={13} className="animate-spin" /> 그리는 중 · {secs}초
          </span>
        )}
        <div className="flex-1" />
        {failed ? (
          <button
            title="다시 그리기"
            onClick={() => void retry(job.id)}
            className="grid size-6 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"
          >
            <RotateCcw size={13} />
          </button>
        ) : (
          <button
            title="취소"
            onClick={() => cancel(job.id)}
            className="grid size-6 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="mt-2 line-clamp-4 text-[12.5px] leading-relaxed text-muted">{job.prompt}</div>
      {(failed || job.state === 'retrying') && job.error && (
        <div className="mt-auto line-clamp-3 text-[11.5px] leading-relaxed text-danger">
          {job.error}
        </div>
      )}
      {!failed && (
        <div className="mt-auto flex gap-1 text-[11px] text-faint">
          {job.size} · {job.model}
          {job.refCount ? ' · 레퍼런스 ' + job.refCount : ''}
        </div>
      )}
    </div>
  )
}

function ResultCard({
  item,
  onOpen
}: {
  item: HistoryItem
  onOpen: () => void
}): React.JSX.Element {
  const setForm = useGptStore((s) => s.setForm)
  const addRefs = useGptStore((s) => s.addRefs)
  const src = item.thumbnail
    ? 'data:image/webp;base64,' + item.thumbnail
    : thumbnailUrl(item.filePath)
  const usePrompt = async (): Promise<void> => {
    const { payloadJson } = await window.nais.invoke('images:payload', { id: item.id })
    try {
      const p = JSON.parse(payloadJson ?? '{}') as { prompt?: string }
      if (p.prompt) {
        setForm({ prompt: p.prompt })
        toast('프롬프트를 불러왔어요', 'success')
      }
    } catch {
      toast('프롬프트를 찾지 못했어요', 'info')
    }
  }
  return (
    <ImageContextMenu
      filePath={item.filePath}
      extra={
        <>
          <ContextMenuItem onSelect={() => void usePrompt()}>
            <Sparkles size={13} className="text-accent" /> 이 프롬프트 불러오기
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              const ref = await pathToRef(item.filePath)
              if (ref) addRefs([ref])
            }}
          >
            <ImagePlus size={13} className="text-accent" /> 레퍼런스로 넣기
          </ContextMenuItem>
        </>
      }
    >
      <button
        onClick={onOpen}
        draggable
        onDragStart={(e) => setImagePathDrag(e, item.filePath)}
        className="group relative aspect-square overflow-hidden rounded-2xl bg-surface"
      >
        <img
          src={src}
          className="size-full object-cover transition group-hover:scale-[1.02]"
          draggable={false}
        />
      </button>
    </ImageContextMenu>
  )
}
