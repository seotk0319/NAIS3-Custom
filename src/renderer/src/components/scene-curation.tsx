// 선별 작업 (NAIS2 Custom 이식) — 씬별 생성 이미지를 빠르게 선별/정리하는 전용 화면.
// 좌: 기준 그림 / 중앙: 현재 이미지 크게 보기 / 우: 씬·이미지 목록.
// 우클릭: 인페인트(내장) / 메타데이터 확인. 기준 그림은 인페인트에 1회성 레퍼런스로 적용.
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileText,
  ImagePlus,
  Layers,
  ListChecks,
  Loader2,
  PaintBucket,
  Paintbrush,
  RotateCcw,
  Star,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CharRefType, ExtraCharRef, GenerationRequest, SceneImage } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { requestFromMetadata } from '../lib/metadata-request'
import { cn } from '../lib/utils'
import { randomSeed } from '../stores/generation-store'
import { useMetadataStore } from '../stores/metadata-store'
import { buildSceneRequest, useScenesStore } from '../stores/scenes-store'
import { toast } from '../stores/toast-store'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

const DRAG_MIME = 'application/x-nais-curation'
const REF_TYPE_LABELS: { value: CharRefType; label: string }[] = [
  { value: 'character&style', label: '캐릭터&스타일' },
  { value: 'character', label: '캐릭터' },
  { value: 'style', label: '스타일' }
]

interface ReferenceSelection {
  filePath: string
  sceneName: string
}

interface InpaintTarget {
  base64: string
  width: number
  height: number
  /** 소스 이미지 파일 경로 — 인페인트 프롬프트를 이 이미지의 메타데이터에서 읽는다 */
  filePath: string
}

function parse01(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return n
}

/** 씬의 생성 이미지 전체 로드 (선별 작업은 한 씬을 통째로 봐야 해서 페이지를 끝까지 모은다) */
async function loadAllImages(sceneId: number): Promise<SceneImage[]> {
  const acc: SceneImage[] = []
  let total = Infinity
  while (acc.length < total) {
    const { items, total: t } = await window.nais.invoke('scenes:images', {
      sceneId,
      limit: 200,
      offset: acc.length
    })
    total = t
    acc.push(...items)
    if (items.length === 0) break
  }
  return acc
}

export function SceneCuration({ onClose }: { onClose: () => void }): React.JSX.Element {
  const scenes = useScenesStore((s) => s.scenes)
  const showMeta = useMetadataStore((s) => s.show)

  const [sceneId, setSceneId] = useState<number | null>(scenes[0]?.id ?? null)
  const [images, setImages] = useState<SceneImage[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)

  // 기준 그림 + 레퍼런스 설정 (인페인트 요청에만 적용, 전역 레퍼런스 오염 없음)
  const [reference, setReference] = useState<ReferenceSelection | null>(null)
  const [applyRef, setApplyRef] = useState(true)
  const [refType, setRefType] = useState<CharRefType>('character&style')
  const [refStrength, setRefStrength] = useState('0.6')
  const [refFidelity, setRefFidelity] = useState('0.6')
  const [refDragOver, setRefDragOver] = useState(false)

  // 내장 인페인트
  const [inpaint, setInpaint] = useState<InpaintTarget | null>(null)
  const [inpaintLoading, setInpaintLoading] = useState(false)
  // 진행 중 인페인트 작업 (실시간 스트리밍 미리보기)
  const [job, setJob] = useState<{ id: string } | null>(null)
  const [jobPreview, setJobPreview] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<{ stepIx: number; totalSteps: number } | null>(
    null
  )

  const sceneIdRef = useRef(sceneId)
  sceneIdRef.current = sceneId
  const scene = scenes.find((s) => s.id === sceneId) ?? null
  const current = images[index] ?? null
  const currentRef = useRef(current)
  currentRef.current = current

  const reload = useCallback(async (id: number, resetIndex: boolean): Promise<void> => {
    setLoading(true)
    const items = await loadAllImages(id)
    if (sceneIdRef.current !== id) return
    setImages(items)
    setIndex((i) => (resetIndex ? 0 : Math.min(i, Math.max(0, items.length - 1))))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (sceneId != null) void reload(sceneId, true)
    else setImages([])
  }, [sceneId, reload])

  // 인페인트 결과 등 새 이미지가 이 씬에 생기면 목록 갱신 (현재 보던 위치 유지)
  useEffect(() => {
    return window.nais.on('scenes:changed', ({ sceneId: changed }) => {
      if (changed === sceneIdRef.current) void reload(changed, false)
    })
  }, [reload])

  /** 씬 목록에서 위/아래로 이동 (선별 작업 안에서의 씬 전환) */
  const gotoScene = useCallback((delta: number): void => {
    const list = useScenesStore.getState().scenes
    const idx = list.findIndex((s) => s.id === sceneIdRef.current)
    const next = list[idx + delta]
    if (next) setSceneId(next.id)
  }, [])

  // 키보드 — ←/→: 이미지 목록 이동, ↑/↓: 씬 목록 이동. 입력/슬라이더는 방해하지 않음
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (inpaint) return
      if (useMetadataStore.getState().open) return // 메타데이터 팝업 중엔 이동 금지
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable ||
          t.getAttribute('role') === 'slider')
      )
        return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, Math.max(0, images.length - 1)))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        gotoScene(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        gotoScene(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inpaint, images.length, gotoScene])

  // 선별 토글 단축키 (설정 → 단축키에서 변경 가능)
  useEffect(() => {
    const handler = (): void => {
      const img = currentRef.current
      if (img) void toggleFavorite(img)
    }
    window.addEventListener('nais:curation-favorite', handler)
    return () => window.removeEventListener('nais:curation-favorite', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 진행 중 인페인트의 스트리밍 미리보기/완료 감시
  useEffect(() => {
    if (!job) return
    const offProgress = window.nais.on('generation:progress', (e) => {
      if (e.id !== job.id) return
      setJobProgress({ stepIx: e.stepIx, totalSteps: e.totalSteps })
      if (e.previewPng) setJobPreview(e.previewPng)
    })
    const offQueue = window.nais.on('queue:changed', (q) => {
      const item = q.items.find((i) => i.id === job.id)
      if (!item) return
      if (item.state === 'done') {
        setJob(null)
        setJobPreview(null)
        setJobProgress(null)
        setIndex(0) // 새 이미지는 목록 맨 앞(최신순) — 결과를 바로 보여준다
      } else if (item.state === 'failed' || item.state === 'cancelled') {
        toast(item.error ?? '인페인트 생성 실패', 'error')
        setJob(null)
        setJobPreview(null)
        setJobProgress(null)
      }
    })
    return () => {
      offProgress()
      offQueue()
    }
  }, [job])

  async function toggleFavorite(img: SceneImage): Promise<void> {
    const favorite = !img.favorite
    setImages((list) => list.map((i) => (i.id === img.id ? { ...i, favorite } : i)))
    await window.nais.invoke('images:setFavorite', { id: img.id, favorite })
  }

  /** 선별 외 삭제 — 선별(즐겨찾기)이 하나도 없으면 절대 삭제하지 않는다. 확인창 없이 즉시 수행 */
  async function deleteUnselected(): Promise<boolean> {
    if (sceneId == null) return false
    const favorites = images.filter((i) => i.favorite)
    if (favorites.length === 0) {
      toast('선별이 안되었습니다.', 'error')
      return false
    }
    const targets = images.filter((i) => !i.favorite)
    if (targets.length === 0) {
      toast('삭제할 이미지가 없습니다', 'info')
      return true
    }
    for (const t of targets) {
      await window.nais.invoke('images:delete', { id: t.id, deleteFile: true })
    }
    await reload(sceneId, true)
    void useScenesStore.getState().load()
    toast(`${targets.length}장 삭제됨 (선별 ${favorites.length}장 유지)`, 'success')
    return true
  }

  /** 선별 외 삭제 후 다음 씬으로 이동 */
  async function deleteAndNext(): Promise<void> {
    if (!(await deleteUnselected())) return
    const list = useScenesStore.getState().scenes
    const idx = list.findIndex((s) => s.id === sceneIdRef.current)
    if (idx >= 0 && idx < list.length - 1) setSceneId(list[idx + 1].id)
    else toast('마지막 씬입니다', 'info')
  }

  async function startInpaint(): Promise<void> {
    if (!current) return
    const filePath = current.filePath
    setInpaintLoading(true)
    const res = await window.nais.invoke('images:readForSource', { filePath })
    setInpaintLoading(false)
    if ('error' in res) {
      toast(res.error, 'error')
      return
    }
    setInpaint({ base64: res.base64, width: res.width, height: res.height, filePath })
  }

  /**
   * 내장 인페인트 생성 — 프롬프트는 앱/씬 프롬프트가 아니라 "이 이미지의 메타데이터"를 쓴다.
   * (메타 프롬프트는 이미 퀄리티/UC가 병합된 최종본 → 이중 병합 금지, 와일드카드 치환 생략)
   * 바이브/캐릭레퍼는 메인이 DB에서, 기준 그림은 1회성 레퍼런스로 적용.
   * 결과는 덮어쓰지 않고 현재 씬에 새 이미지로 추가 (히스토리에도 저장).
   */
  async function generateInpaint(maskBase64: string, strength: number): Promise<void> {
    if (!scene || !inpaint) return
    let extraCharRefs: ExtraCharRef[] | undefined
    if (applyRef && reference) {
      const st = parse01(refStrength)
      const fi = parse01(refFidelity)
      if (st === null || fi === null) {
        toast('레퍼런스 강도/충실도는 0부터 1 사이 숫자여야 합니다', 'error')
        return
      }
      extraCharRefs = [{ filePath: reference.filePath, refType, strength: st, fidelity: fi }]
    }

    const base = buildSceneRequest(scene)
    const metaRes = await window.nais.invoke('images:readMetadata', { filePath: inpaint.filePath })
    const meta = 'error' in metaRes ? null : metaRes.meta
    let metadataRequest: GenerationRequest | null = null
    if (meta?.prompt.trim()) {
      metadataRequest = requestFromMetadata({
        meta,
        imageBase64: inpaint.base64,
        width: inpaint.width,
        height: inpaint.height,
        maskBase64,
        strength,
        noise: 0,
        fallbacks: {
          steps: base.steps,
          cfgScale: base.cfgScale,
          cfgRescale: base.cfgRescale,
          sampler: base.sampler,
          noiseSchedule: base.noiseSchedule
        }
      })
    } else {
      toast('이미지 메타데이터가 없어 씬 프롬프트로 생성합니다', 'info')
    }
    const request: GenerationRequest = metadataRequest
      ? { ...metadataRequest, promptParts: undefined, extraCharRefs, sceneId: scene.id }
      : {
          ...base,
          seed: randomSeed(),
          width: inpaint.width,
          height: inpaint.height,
          source: { imageBase64: inpaint.base64, maskBase64, strength, noise: 0 },
          extraCharRefs,
          sceneId: scene.id
        }
    const { ids } = await window.nais.invoke('queue:enqueue', { request, count: 1 })
    setInpaint(null)
    if (ids[0]) {
      setJob({ id: ids[0] })
      setJobPreview(null)
      setJobProgress(null)
    }
  }

  // (JSX는 아래) — InpaintPanel은 파일 하단 참조

  return (
    // no-drag: 커스텀 타이틀바의 창 드래그 영역과 겹치는 상단부에서도 클릭이 먹게 한다
    <div className="no-drag fixed inset-0 z-50 flex flex-col bg-black/60 p-3 backdrop-blur-sm">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-2xl">
        {/* 헤더 — 제목 + 레퍼 설정 행(한 줄 유지, 좁으면 줄바꿈) + 선별 외 삭제 + 닫기 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <ListChecks size={16} className="text-accent" />
            <h2 className="text-[14px] font-semibold">선별 작업</h2>
          </div>
          <div className="h-5 w-px shrink-0 bg-line" />
          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5"
            data-testid="scene-curation-reference-settings"
          >
            <label className="flex shrink-0 items-center gap-1.5 text-[12px]">
              <Switch checked={applyRef} onCheckedChange={setApplyRef} />
              레퍼런스 적용
            </label>
            <span
              className="max-w-44 truncate rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] text-muted"
              title={reference?.sceneName}
            >
              {reference ? reference.sceneName : '기준 없음'}
            </span>
            <Select value={refType} onValueChange={(v) => setRefType(v as CharRefType)}>
              <SelectTrigger className="h-7 w-36 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REF_TYPE_LABELS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted">
              강도
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className="h-7 w-16 text-[12px]"
                value={refStrength}
                onChange={(e) => setRefStrength(e.target.value)}
                onBlur={() => {
                  const p = parse01(refStrength)
                  if (p !== null) setRefStrength(String(p))
                }}
              />
            </label>
            <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted">
              충실도
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className="h-7 w-16 text-[12px]"
                value={refFidelity}
                onChange={(e) => setRefFidelity(e.target.value)}
                onBlur={() => {
                  const p = parse01(refFidelity)
                  if (p !== null) setRefFidelity(String(p))
                }}
              />
            </label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 gap-1 text-danger hover:text-danger"
            disabled={images.length === 0}
            onClick={() => void deleteUnselected()}
          >
            <Trash2 size={14} /> 선별 외 삭제
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 gap-1"
            disabled={images.length === 0}
            onClick={() => void deleteAndNext()}
          >
            <Trash2 size={14} /> 삭제 후 다음 씬
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={16} />
          </Button>
        </div>

        {/* 본문 — 기준 그림과 후보 이미지 패널은 같은 폭, 우측 목록은 좁게 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(360px,1fr)_minmax(360px,1fr)_minmax(260px,0.55fr)] lg:overflow-hidden">
          {/* 좌: 기준 그림 */}
          <div
            className={cn(
              'flex min-h-64 flex-col overflow-hidden rounded-lg border bg-surface lg:min-h-0',
              refDragOver ? 'border-accent' : 'border-line'
            )}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault()
                setRefDragOver(true)
              }
            }}
            onDragLeave={() => setRefDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setRefDragOver(false)
              try {
                const data = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as ReferenceSelection
                if (data?.filePath) setReference(data)
              } catch {
                // 형식이 다른 드롭은 무시
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="text-[12.5px] font-medium">기준 그림</span>
              {reference && (
                <button
                  className="ml-auto grid size-5 place-items-center rounded text-faint hover:text-danger"
                  onClick={() => setReference(null)}
                  title="기준 해제"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {reference ? (
              <div className="relative min-h-0 flex-1">
                <img
                  src={imageUrl(reference.filePath)}
                  className="absolute inset-0 h-full w-full object-contain p-2"
                  draggable={false}
                  alt=""
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-faint">
                <ImagePlus size={30} strokeWidth={1.3} className="opacity-50" />
                <p className="text-center text-[12px]">
                  우측 이미지 목록에서 끌어다 놓거나
                  <br />
                  더블클릭으로 기준 지정
                </p>
              </div>
            )}
          </div>

          {/* 중앙: 현재 이미지 / 내장 인페인트 */}
          <div className="flex min-h-80 flex-col overflow-hidden rounded-lg border border-line bg-surface lg:min-h-0">
            {job ? (
              <div className="relative min-h-0 flex-1">
                {jobPreview ? (
                  <img
                    src={`data:image/png;base64,${jobPreview}`}
                    className="absolute inset-0 h-full w-full object-contain p-2"
                    draggable={false}
                    alt=""
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted">
                    <Loader2 size={30} className="animate-spin" />
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white shadow">
                  인페인트 생성 중
                  {jobProgress ? ` ${jobProgress.stepIx}/${jobProgress.totalSteps}` : '…'}
                </span>
              </div>
            ) : inpaint && scene ? (
              <InpaintPanel
                target={inpaint}
                onCancel={() => setInpaint(null)}
                onGenerate={generateInpaint}
              />
            ) : current ? (
              <>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="relative min-h-0 flex-1">
                      <img
                        src={imageUrl(current.filePath)}
                        className="absolute inset-0 h-full w-full object-contain p-2"
                        draggable={false}
                        alt=""
                      />
                      <Button
                        size="sm"
                        variant={current.favorite ? 'accent' : 'default'}
                        className="absolute left-2 top-2 gap-1 shadow"
                        onClick={() => void toggleFavorite(current)}
                      >
                        <Star size={14} fill={current.favorite ? 'currentColor' : 'none'} />
                        {current.favorite ? '선별됨' : '선별'}
                      </Button>
                      {inpaintLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                          <Loader2 size={26} className="animate-spin" />
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => void startInpaint()}>
                      <Layers size={13} className="text-pink-400" /> 인페인트
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void showMeta({ filePath: current.filePath })}>
                      <FileText size={13} className="text-sky-400" /> 메타데이터 확인
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line py-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                    aria-label="이전 이미지"
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <span className="min-w-16 text-center font-mono text-[12px] text-muted">
                    {index + 1} / {images.length}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={index >= images.length - 1}
                    onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
                    aria-label="다음 이미지"
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[13px] text-faint">
                {loading ? '불러오는 중…' : '이 씬에는 생성된 이미지가 없습니다'}
              </div>
            )}
          </div>

          {/* 우: 씬 목록 + 이미지 목록 */}
          <div className="flex min-h-96 flex-col gap-3 lg:min-h-0">
            <div className="flex max-h-[38%] min-h-28 flex-col overflow-hidden rounded-lg border border-line bg-surface">
              <div className="border-b border-line px-3 py-2 text-[12.5px] font-medium">
                씬 목록
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {scenes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSceneId(s.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2',
                      s.id === sceneId && 'bg-surface-2 font-semibold text-accent'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">
                      {s.imageCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="text-[12.5px] font-medium">이미지 목록</span>
                <span className="ml-auto text-[11px] text-faint">
                  선별 {images.filter((i) => i.favorite).length} / {images.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {images.map((img, i) => (
                    <button
                      key={img.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'copy'
                        e.dataTransfer.setData(
                          DRAG_MIME,
                          JSON.stringify({ filePath: img.filePath, sceneName: scene?.name ?? '' })
                        )
                      }}
                      onClick={() => setIndex(i)}
                      onDoubleClick={() =>
                        setReference({ filePath: img.filePath, sceneName: scene?.name ?? '' })
                      }
                      title="클릭: 보기 · 더블클릭: 기준 그림으로 · 드래그: 좌측 기준 영역"
                      className={cn(
                        'relative aspect-square overflow-hidden rounded-md border transition-colors',
                        i === index ? 'border-accent' : 'border-transparent hover:border-line',
                        img.favorite && 'ring-1 ring-amber-400/70'
                      )}
                    >
                      <img
                        src={
                          img.thumbnail
                            ? `data:image/webp;base64,${img.thumbnail}`
                            : imageUrl(img.filePath)
                        }
                        className="h-full w-full object-cover"
                        draggable={false}
                        loading="lazy"
                        alt=""
                      />
                      {img.favorite && (
                        <Star
                          size={11}
                          className="absolute left-1 top-1 fill-amber-400 text-amber-400 drop-shadow"
                        />
                      )}
                    </button>
                  ))}
                </div>
                {loading && <p className="py-2 text-center text-[11px] text-faint">불러오는 중…</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 내장 인페인트 — 현재 후보 이미지를 소스로 마스크를 칠해 부분 재생성.
 * 캔버스는 원본 해상도로 두고 CSS로만 축소 표시 (mask-editor와 동일 원리) + 되돌리기 지원.
 */
function InpaintPanel({
  target,
  onCancel,
  onGenerate
}: {
  target: InpaintTarget
  onCancel: () => void
  onGenerate: (maskBase64: string, strength: number) => void | Promise<void>
}): React.JSX.Element {
  const { base64, width, height } = target
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [brush, setBrush] = useState(40)
  const [erasing, setErasing] = useState(false)
  const [strength, setStrength] = useState(1)
  const [disp, setDisp] = useState({ w: 1, h: 1 })
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const undoStack = useRef<ImageData[]>([])
  const [canUndo, setCanUndo] = useState(false)

  // 가용 영역에 맞춰 표시 크기 계산 (원본 비율 유지, 업스케일 없음)
  useLayoutEffect(() => {
    function measure(): void {
      const el = boxRef.current
      if (!el) return
      const scale = Math.min(1, el.clientWidth / width, el.clientHeight / height)
      setDisp({
        w: Math.max(1, Math.round(width * scale)),
        h: Math.max(1, Math.round(height * scale))
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (boxRef.current) ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [width, height])

  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height
    }
  }

  function pushUndo(): void {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    undoStack.current.push(ctx.getImageData(0, 0, width, height))
    if (undoStack.current.length > 20) undoStack.current.shift()
    setCanUndo(true)
  }

  function undo(): void {
    const snap = undoStack.current.pop()
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && snap) ctx.putImageData(snap, 0, 0)
    setCanUndo(undoStack.current.length > 0)
  }

  function paint(e: React.PointerEvent): void {
    const canvas = canvasRef.current
    if (!canvas || !drawing.current) return
    const ctx = canvas.getContext('2d')!
    const { x, y } = pos(e)
    const r = (brush / disp.w) * width
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    // 불투명하게 칠하고 캔버스 자체를 반투명(opacity-40)으로 — 겹칠수록 진해지는 문제 없이 뒤가 보인다
    ctx.strokeStyle = 'rgb(233, 94, 80)'
    ctx.fillStyle = 'rgb(233, 94, 80)'
    ctx.lineWidth = r * 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (last.current) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    last.current = { x, y }
  }

  function clear(): void {
    const canvas = canvasRef.current
    if (!canvas) return
    pushUndo()
    canvas.getContext('2d')!.clearRect(0, 0, width, height)
  }

  /** 전체 영역 설정 — 전체를 채운 뒤 지우개로 필요한 부분만 지우는 흐름 */
  function fillAll(): void {
    const canvas = canvasRef.current
    if (!canvas) return
    pushUndo()
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgb(233, 94, 80)'
    ctx.fillRect(0, 0, width, height)
  }

  /** 캔버스 → 흑백 RGB PNG (칠한 곳=흰색). hasAny=false면 아무것도 안 칠한 상태 */
  function exportMask(): { mask: string; hasAny: boolean } {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, width, height)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const octx = out.getContext('2d')!
    const img = octx.createImageData(width, height)
    let hasAny = false
    for (let i = 0; i < data.length; i += 4) {
      const on = data[i + 3] > 20 ? 255 : 0
      if (on) hasAny = true
      img.data[i] = on
      img.data[i + 1] = on
      img.data[i + 2] = on
      img.data[i + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    return { mask: out.toDataURL('image/png').split(',')[1], hasAny }
  }

  function handleGenerate(): void {
    const { mask, hasAny } = exportMask()
    if (!hasAny) {
      toast('재생성할 영역을 먼저 칠하세요', 'error')
      return
    }
    void onGenerate(mask, strength)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 p-2">
        <div ref={boxRef} className="relative flex h-full w-full items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md border border-line bg-paper"
            style={{ width: disp.w, height: disp.h }}
          >
            <img
              src={`data:image/png;base64,${base64}`}
              className="pointer-events-none absolute inset-0 h-full w-full select-none"
              draggable={false}
              alt=""
            />
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="absolute inset-0 h-full w-full cursor-crosshair opacity-40"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                pushUndo()
                drawing.current = true
                last.current = null
                paint(e)
              }}
              onPointerMove={paint}
              onPointerUp={() => {
                drawing.current = false
                last.current = null
              }}
              onPointerLeave={() => {
                drawing.current = false
                last.current = null
              }}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5">
        <Button
          size="sm"
          variant={erasing ? 'ghost' : 'default'}
          className="gap-1"
          onClick={() => setErasing(false)}
        >
          <Paintbrush size={14} /> 칠하기
        </Button>
        <Button
          size="sm"
          variant={erasing ? 'default' : 'ghost'}
          className="gap-1"
          onClick={() => setErasing(true)}
        >
          <Eraser size={14} /> 지우기
        </Button>
        <span className="ml-1 text-[12px] text-muted">붓 {brush}</span>
        <Slider
          className="w-28"
          min={8}
          max={120}
          step={2}
          value={[brush]}
          onValueChange={([v]) => setBrush(v)}
        />
        <Button size="sm" variant="ghost" className="gap-1" disabled={!canUndo} onClick={undo}>
          <Undo2 size={13} /> 되돌리기
        </Button>
        <Button size="sm" variant="ghost" className="gap-1" onClick={clear}>
          <RotateCcw size={13} /> 초기화
        </Button>
        <Button size="sm" variant="ghost" className="gap-1" onClick={fillAll}>
          <PaintBucket size={13} /> 전체 영역 설정
        </Button>
        <span className="ml-1 shrink-0 text-[12px] text-muted">강도 {strength.toFixed(2)}</span>
        <Slider
          className="w-24"
          min={0}
          max={1}
          step={0.01}
          value={[strength]}
          onValueChange={([v]) => setStrength(v)}
        />
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
        <Button
          size="sm"
          variant="accent"
          onClick={handleGenerate}
          title="이 이미지의 메타데이터 프롬프트 + 바이브/캐릭레퍼 + 기준 그림으로 생성"
        >
          생성
        </Button>
      </div>
    </div>
  )
}
