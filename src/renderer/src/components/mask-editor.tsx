import { Eraser, PaintBucket, Paintbrush, RotateCcw, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from '../stores/toast-store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Slider } from './ui/slider'

const MASK_COLOR = 'rgb(233,94,80)'
const MAX_UNDO = 20

/**
 * 인페인트 마스크 에디터 (NAIS2 방식):
 * 캔버스를 "원본 이미지 해상도"로 두고 CSS로만 축소 표시한다 (업스케일 아티팩트 없음).
 * 출력: 원본 해상도 흑백 RGB PNG (칠한 곳=흰색). 마스크 좌표가 이미지와 1:1.
 */
export function MaskEditor({
  imageBase64,
  width,
  height,
  onConfirm,
  onCancel,
  showStrength = false
}: {
  imageBase64: string
  width: number
  height: number
  onConfirm: (maskBase64: string, strength?: number) => void
  onCancel: () => void
  showStrength?: boolean
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [brush, setBrush] = useState(40)
  const [erasing, setErasing] = useState(false)
  const [strength, setStrength] = useState(1)
  const [undoDepth, setUndoDepth] = useState(0)
  const undoStack = useRef<ImageData[]>([])
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  // 표시 크기 — 뷰포트 안에 들어오게 (캔버스는 원본 해상도, CSS로만 축소)
  const { dispW, dispH } = useMemo(() => {
    const maxW = 620
    const maxH = Math.round(window.innerHeight * 0.58)
    const scale = Math.min(1, maxW / width, maxH / height)
    return { dispW: Math.round(width * scale), dispH: Math.round(height * scale) }
  }, [width, height])

  /** 화면 좌표 → 캔버스(원본) 좌표 */
  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height
    }
  }

  function pushSnapshot(): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    undoStack.current = [
      ...undoStack.current.slice(-(MAX_UNDO - 1)),
      ctx.getImageData(0, 0, width, height)
    ]
    setUndoDepth(undoStack.current.length)
  }

  function undo(): void {
    const canvas = canvasRef.current
    const snapshot = undoStack.current.pop()
    if (!canvas || !snapshot) return
    canvas.getContext('2d')!.putImageData(snapshot, 0, 0)
    setUndoDepth(undoStack.current.length)
  }

  function paint(e: React.PointerEvent): void {
    const canvas = canvasRef.current
    if (!canvas || !drawing.current) return
    const ctx = canvas.getContext('2d')!
    const { x, y } = pos(e)
    // 붓 크기는 원본 해상도 기준으로 스케일 (화면에서 보이는 크기 유지)
    const r = (brush / dispW) * width
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    // 불투명 페인트 + 캔버스 CSS opacity로 균일 반투명 (알파 페인트는 겹칠 때마다 진해져서 불균일)
    ctx.strokeStyle = MASK_COLOR
    ctx.fillStyle = MASK_COLOR
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
    pushSnapshot()
    canvas.getContext('2d')!.clearRect(0, 0, width, height)
  }

  /** 전체 영역 설정 — 캔버스 전체를 마스크로 채운 뒤 지우개로 필요한 부분만 지우는 흐름 */
  function fillAll(): void {
    const canvas = canvasRef.current
    if (!canvas) return
    pushSnapshot()
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = MASK_COLOR
    ctx.fillRect(0, 0, width, height)
  }

  function hasMask(): boolean {
    const canvas = canvasRef.current
    if (!canvas) return false
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 20) return true
    }
    return false
  }

  /** 캔버스(원본 해상도) → 흑백 RGB PNG (칠한 곳=흰색). 업스케일 없음 */
  function exportMask(): string {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, width, height)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const octx = out.getContext('2d')!
    const img = octx.createImageData(width, height)
    for (let i = 0; i < data.length; i += 4) {
      const on = data[i + 3] > 20 ? 255 : 0
      img.data[i] = on
      img.data[i + 1] = on
      img.data[i + 2] = on
      img.data[i + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    return out.toDataURL('image/png').split(',')[1]
  }

  function confirm(): void {
    if (!hasMask()) {
      toast('마스크 영역을 먼저 칠해 주세요', 'error')
      return
    }
    onConfirm(exportMask(), showStrength ? strength : undefined)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[680px] p-4">
        <DialogTitle className="mb-3">인페인트 마스크 — 재생성할 영역을 칠하세요</DialogTitle>
        <div className="flex flex-col items-center gap-3">
          <div
            className="relative overflow-hidden rounded-md border border-line bg-paper"
            style={{ width: dispW, height: dispH }}
          >
            <img
              src={`data:image/png;base64,${imageBase64}`}
              className="pointer-events-none absolute inset-0 h-full w-full select-none"
              draggable={false}
              alt=""
            />
            {/* 캔버스는 원본 해상도, CSS로만 축소 표시 */}
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="absolute inset-0 h-full w-full cursor-crosshair opacity-40"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                pushSnapshot()
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

          <div className="flex w-full flex-wrap items-center gap-2">
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
              className="w-36"
              min={8}
              max={120}
              step={2}
              value={[brush]}
              onValueChange={([v]) => setBrush(v)}
            />
            {showStrength && (
              <>
                <span className="ml-1 text-[12px] text-muted">강도 {strength.toFixed(2)}</span>
                <Slider
                  className="w-28"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[strength]}
                  onValueChange={([v]) => setStrength(Math.round(v * 100) / 100)}
                />
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              disabled={undoDepth === 0}
              onClick={undo}
            >
              <Undo2 size={13} /> 되돌리기
            </Button>
            <Button size="sm" variant="ghost" className="gap-1" onClick={fillAll}>
              <PaintBucket size={13} /> 전체 영역 설정
            </Button>
            <Button size="sm" variant="ghost" className="gap-1" onClick={clear}>
              <RotateCcw size={13} /> 초기화
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onCancel}>
              취소
            </Button>
            <Button variant="accent" onClick={confirm}>
              적용
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
