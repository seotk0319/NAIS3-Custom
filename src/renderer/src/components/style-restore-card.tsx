import { RefreshCw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { GenerationRequest } from '@shared/types'
import { useGenerationStore } from '../stores/generation-store'
import { fileToBase64, imageDimensions, requestFromMetadata } from '../lib/metadata-request'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { Input } from './ui/input'

/**
 * 그림체 복구 기능 (NAIS2 Custom 이식):
 * 이미지 여러 장을 드롭하면 각 이미지의 메타데이터 프롬프트만으로 i2i 재생성한다.
 * - 앱에 입력된 프롬프트/설정은 건드리지 않는다 (요청만 따로 구성)
 * - 변화 강도만 핀포인트로 조정, 노이즈 0
 * - 메타데이터 프롬프트는 이미 퀄리티 태그/UC 프리셋이 병합된 최종본이므로
 *   qualityToggle=false, ucPreset=None으로 이중 병합을 막는다
 */

const STYLE_RESTORE_NOISE = 0
const DEFAULT_STRENGTH = '0.5'

interface RestoreItem {
  key: string
  fileName: string
  /** 큐에 못 들어간 실패(메타데이터 없음 등)는 queueId 없이 message만 */
  queueId: string | null
  error?: string
}

function parseStrength(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return n
}

export function StyleRestoreCard(): React.JSX.Element {
  const queue = useGenerationStore((s) => s.queue)
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<RestoreItem[]>([])
  const [strength, setStrength] = useState(DEFAULT_STRENGTH)
  const [dragOver, setDragOver] = useState(false)
  const [reading, setReading] = useState(false)

  async function handleFiles(fileList: FileList | File[]): Promise<void> {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) {
      toast('이미지 파일이 없습니다', 'error')
      return
    }
    if (reading) {
      toast('처리 중입니다', 'error')
      return
    }
    const parsed = parseStrength(strength)
    if (parsed === null) {
      toast('변화 강도는 0부터 1 사이 숫자여야 합니다', 'error')
      return
    }
    const { hasToken } = await window.nais.invoke('nai:tokenStatus', undefined)
    if (!hasToken) {
      toast('설정에서 NAI 토큰을 먼저 입력하세요', 'error')
      return
    }

    setReading(true)
    const next: RestoreItem[] = []
    const requests: GenerationRequest[] = []
    const requestItemIndexes: number[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const key = `${Date.now()}-${i}-${file.name}`
        try {
          const base64 = await fileToBase64(file)
          const res = await window.nais.invoke('images:readMetadata', { base64 })
          if ('error' in res) throw new Error(res.error)
          const meta = res.meta
          if (!meta.prompt.trim()) throw new Error('프롬프트를 찾을 수 없습니다')

          const dims = await imageDimensions(base64)
          const request = requestFromMetadata({
            meta,
            imageBase64: base64,
            dimensions: dims,
            strength: parsed,
            noise: STYLE_RESTORE_NOISE,
            useCoords: (meta.characterPrompts ?? []).length > 0
          })
          next.push({ key, fileName: file.name, queueId: null })
          requestItemIndexes.push(next.length - 1)
          requests.push(request)
        } catch (e) {
          next.push({
            key,
            fileName: file.name,
            queueId: null,
            error: e instanceof Error ? e.message : String(e)
          })
        }
        setItems([...next])
      }
      if (requests.length > 0) {
        try {
          const { ids } = await window.nais.invoke('queue:enqueueMany', { requests })
          requestItemIndexes.forEach((itemIndex, index) => {
            next[itemIndex].queueId = ids[index] ?? null
            if (!ids[index]) next[itemIndex].error = '큐 등록 실패'
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          for (const itemIndex of requestItemIndexes) next[itemIndex].error = message
        }
        setItems([...next])
      }
    } finally {
      setReading(false)
    }
    const queued = next.filter((n) => n.queueId).length
    if (queued > 0) toast(`그림체 복구 ${queued}장 예약됨`, 'success')
    else toast('처리할 이미지가 없습니다', 'error')
  }

  function statusOf(item: RestoreItem): { label: string; cls: string } {
    if (!item.queueId) return { label: item.error ?? '실패', cls: 'text-danger' }
    const q = queue?.items.find((i) => i.id === item.queueId)
    if (!q) return { label: '큐 등록됨', cls: 'text-muted' }
    switch (q.state) {
      case 'pending':
        return { label: '대기', cls: 'text-muted' }
      case 'generating':
        return { label: '처리 중', cls: 'text-accent' }
      case 'done':
        return { label: '완료', cls: 'text-emerald-400' }
      case 'cancelled':
        return { label: '취소됨', cls: 'text-faint' }
      default:
        return { label: q.error ?? '실패', cls: 'text-danger' }
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center gap-2.5">
        <RefreshCw size={18} className="text-teal-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">그림체 복구</p>
          <p className="truncate text-[11px] text-faint">메타데이터 프롬프트로 i2i 일괄 재생성</p>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        className={cn(
          'cursor-pointer rounded-lg border border-dashed border-line bg-paper/40 px-3 py-4 text-center transition-colors hover:border-accent/60',
          dragOver && 'border-accent bg-accent/5'
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer.types.includes('Files')) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
      >
        <Upload size={22} className="mx-auto mb-1.5 opacity-40" />
        <p className="text-[12px] font-medium text-ink">
          {reading ? '메타데이터 읽는 중…' : '이미지 드롭 또는 선택 (여러 장)'}
        </p>
        <p className="mt-0.5 text-[11px] text-faint">
          메타 프롬프트 사용 · 노이즈 0 · 새 랜덤 시드
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted">변화 강도</span>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className="h-8"
          value={strength}
          onChange={(e) => setStrength(e.target.value)}
          onBlur={() => {
            const parsed = parseStrength(strength)
            if (parsed !== null) setStrength(String(parsed))
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
          {items.map((item) => {
            const s = statusOf(item)
            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-2 rounded-md bg-paper/50 px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{item.fileName}</span>
                <span className={cn('shrink-0 text-[11px]', s.cls)}>{s.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
