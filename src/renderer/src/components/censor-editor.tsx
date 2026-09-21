import { ArrowLeft, ChevronLeft, ChevronRight, History, Loader2, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCensorStore } from '../stores/censor-store'
import { toast } from '../stores/toast-store'
import { Button } from './ui/button'

interface Point {
  x: number
  y: number
}

interface Stroke {
  size: number
  points: Point[]
}

const MIN_BRUSH = 5
const MAX_BRUSH = 400
const BRUSH_STEP = 5
const SAVE_DEBOUNCE_MS = 180

function bytesFromBase64(base64: string): ArrayBuffer {
  const raw = atob(base64.replace(/^data:[^,]+,/, ''))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer as ArrayBuffer
}

function canvasPng(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('편집 이미지를 만들 수 없습니다'))
        return
      }
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('편집 이미지를 읽을 수 없습니다'))
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

export function CensorEditor(): React.JSX.Element | null {
  const filePath = useCensorStore((s) => s.filePath)
  const filePaths = useCensorStore((s) => s.filePaths)
  const index = useCensorStore((s) => s.index)
  const folderPath = useCensorStore((s) => s.folderPath)
  const move = useCensorStore((s) => s.move)
  const close = useCensorStore((s) => s.close)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<ImageBitmap | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const redoRef = useRef<Stroke[]>([])
  const activeStrokeRef = useRef<Stroke | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const saveAgainRef = useRef(false)
  const afterSaveRef = useRef<(() => void) | null>(null)
  const dirtyRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [brushSize, setBrushSize] = useState(80)
  const brushSizeRef = useRef(80)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const [hasBackup, setHasBackup] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke): void => {
    const first = stroke.points[0]
    if (!first) return
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.lineWidth = stroke.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (stroke.points.length === 1) {
      ctx.beginPath()
      ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i]
        ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }, [])

  const redraw = useCallback((): void => {
    const canvas = canvasRef.current
    const source = sourceRef.current
    if (!canvas || !source) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke)
  }, [drawStroke])

  const runSave = useCallback(async (): Promise<void> => {
    if (!filePath || !canvasRef.current) return
    if (savePromiseRef.current) {
      saveAgainRef.current = true
      return savePromiseRef.current
    }
    let completed = false
    const work = (async (): Promise<void> => {
      do {
        saveAgainRef.current = false
        setSaveState('saving')
        const base64 = await canvasPng(canvasRef.current!)
        const result = await window.nais.invoke('images:overwriteCensor', { filePath, base64 })
        if ('error' in result) throw new Error(result.error)
        setHasBackup(result.backupAvailable)
      } while (saveAgainRef.current)
      completed = true
      dirtyRef.current = false
      setSaveState('saved')
    })()
      .catch((error) => {
        afterSaveRef.current = null
        setSaveState('error')
        toast(error instanceof Error ? error.message : '검열 이미지 저장 실패', 'error')
      })
      .finally(() => {
        savePromiseRef.current = null
        if (completed && afterSaveRef.current) {
          const action = afterSaveRef.current
          afterSaveRef.current = null
          action()
        }
      })
    savePromiseRef.current = work
    return work
  }, [filePath])

  const scheduleSave = useCallback(
    (immediate = false): void => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(
        () => {
          saveTimerRef.current = null
          void runSave()
        },
        immediate ? 0 : SAVE_DEBOUNCE_MS
      )
    },
    [runSave]
  )

  const flushThen = useCallback((action: () => void): void => {
    if (afterSaveRef.current) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      afterSaveRef.current = action
      void runSave()
      return
    }
    if (savePromiseRef.current) {
      afterSaveRef.current = action
      return
    }
    if (dirtyRef.current) {
      afterSaveRef.current = action
      void runSave()
      return
    }
    action()
  }, [runSave])

  const requestClose = useCallback((): void => flushThen(close), [close, flushThen])

  const requestMove = useCallback(
    (delta: number): void => {
      const next = index + delta
      if (loading || next < 0 || next >= filePaths.length) return
      flushThen(() => move(delta))
    },
    [filePaths.length, flushThen, index, loading, move]
  )

  const performRestore = useCallback(async (): Promise<void> => {
    if (!filePath) return
    setLoading(true)
    const result = await window.nais.invoke('images:restoreCensor', { filePath })
    if ('error' in result) {
      setLoading(false)
      toast(result.error, 'error')
      return
    }
    dirtyRef.current = false
    setSaveState('saved')
    setReloadKey((value) => value + 1)
    toast('최초 흰칠 전 원본으로 복원됨', 'success')
  }, [filePath])

  const requestRestore = useCallback((): void => {
    if (!hasBackup || loading) return
    flushThen(() => void performRestore())
  }, [flushThen, hasBackup, loading, performRestore])

  useEffect(() => {
    if (!filePath) return
    let disposed = false
    strokesRef.current = []
    redoRef.current = []
    dirtyRef.current = false
    queueMicrotask(() => {
      if (disposed) return
      setLoading(true)
      setSaveState('idle')
      setUndoCount(0)
      setRedoCount(0)
      setHasBackup(false)
    })
    void window.nais.invoke('images:readForSource', { filePath }).then(async (result) => {
      if (disposed) return
      if ('error' in result) {
        toast(result.error, 'error')
        setLoading(false)
        return
      }
      const blob = new Blob([bytesFromBase64(result.base64)], { type: 'image/*' })
      const bitmap = await createImageBitmap(blob)
      if (disposed) {
        bitmap.close()
        return
      }
      sourceRef.current?.close()
      sourceRef.current = bitmap
      setHasBackup(result.censorBackupAvailable)
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = result.width || bitmap.width
        canvas.height = result.height || bitmap.height
        redraw()
      }
      setLoading(false)
    })
    return () => {
      disposed = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [filePath, redraw, reloadKey])

  useEffect(() => {
    if (!filePath) return
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
      } else if (event.key === 'ArrowLeft' && filePaths.length > 1) {
        event.preventDefault()
        requestMove(-1)
      } else if (event.key === 'ArrowRight' && filePaths.length > 1) {
        event.preventDefault()
        requestMove(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filePath, filePaths.length, requestClose, requestMove])

  if (!filePath) return null

  const updateCursor = (clientX: number, clientY: number): void => {
    const canvas = canvasRef.current
    const cursor = cursorRef.current
    if (!canvas || !cursor) return
    const rect = canvas.getBoundingClientRect()
    const diameter = Math.max(4, (brushSizeRef.current * rect.width) / canvas.width)
    cursor.style.width = `${diameter}px`
    cursor.style.height = `${diameter}px`
    cursor.style.transform = `translate3d(${clientX - diameter / 2}px, ${clientY - diameter / 2}px, 0)`
    cursor.style.opacity = '1'
  }

  const appendPoint = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const stroke = activeStrokeRef.current
    const canvas = canvasRef.current
    if (!stroke || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    for (const nativeEvent of events) {
      const rect = canvas.getBoundingClientRect()
      const point = {
        x: ((nativeEvent.clientX - rect.left) * canvas.width) / rect.width,
        y: ((nativeEvent.clientY - rect.top) * canvas.height) / rect.height
      }
      const previous = stroke.points.at(-1)
      if (!previous) {
        stroke.points.push(point)
        drawStroke(ctx, { size: stroke.size, points: [point] })
      } else if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5) {
        stroke.points.push(point)
        drawStroke(ctx, { size: stroke.size, points: [previous, point] })
      }
    }
  }

  const commitStroke = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const stroke = activeStrokeRef.current
    if (!stroke) return
    activeStrokeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    strokesRef.current.push(stroke)
    dirtyRef.current = true
    redoRef.current = []
    setUndoCount(strokesRef.current.length)
    setRedoCount(0)
    scheduleSave()
  }

  const undo = (): void => {
    const stroke = strokesRef.current.pop()
    if (!stroke) return
    redoRef.current.push(stroke)
    dirtyRef.current = true
    setUndoCount(strokesRef.current.length)
    setRedoCount(redoRef.current.length)
    redraw()
    scheduleSave()
  }

  const redo = (): void => {
    const stroke = redoRef.current.pop()
    if (!stroke) return
    strokesRef.current.push(stroke)
    dirtyRef.current = true
    setUndoCount(strokesRef.current.length)
    setRedoCount(redoRef.current.length)
    redraw()
    scheduleSave()
  }

  const reset = (): void => {
    if (strokesRef.current.length === 0) return
    redoRef.current.push(...strokesRef.current.reverse())
    strokesRef.current = []
    dirtyRef.current = true
    setUndoCount(0)
    setRedoCount(redoRef.current.length)
    redraw()
    scheduleSave()
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-950/95 text-white">
      <header className="no-drag flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={requestClose}>
          <ArrowLeft size={16} /> 돌아가기
        </Button>
        <div className="h-5 w-px bg-white/15" />
        <span className="font-medium">검열 흰칠</span>
        {folderPath && (
          <span className="max-w-[22vw] truncate text-[11px] text-white/40" title={folderPath}>
            {folderPath}
          </span>
        )}
        {filePaths.length > 1 && (
          <div className="ml-2 flex items-center gap-1 rounded-full bg-white/5 p-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-full"
              disabled={index === 0 || loading}
              onClick={() => requestMove(-1)}
              title="이전 이미지 (←)"
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-16 text-center font-mono text-[11px] text-white/70">
              {index + 1} / {filePaths.length}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-full"
              disabled={index >= filePaths.length - 1 || loading}
              onClick={() => requestMove(1)}
              title="다음 이미지 (→)"
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
        <span className="max-w-[24vw] truncate text-[11px] text-white/55" title={filePath}>
          {filePath.split(/[\\/]/).at(-1)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-2 text-[11px] text-white/55">
            {saveState === 'saving'
              ? '저장 중…'
              : saveState === 'saved'
                ? '저장됨'
                : saveState === 'error'
                  ? '저장 실패'
                  : '휠로 브러시 크기 조절'}
          </span>
          <Button size="icon" variant="ghost" disabled={undoCount === 0} onClick={undo} title="되돌리기">
            <Undo2 size={16} />
          </Button>
          <Button size="icon" variant="ghost" disabled={redoCount === 0} onClick={redo} title="다시 실행">
            <Redo2 size={16} />
          </Button>
          <Button size="icon" variant="ghost" disabled={undoCount === 0} onClick={reset} title="이번 편집 초기화">
            <RotateCcw size={16} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-amber-200"
            disabled={!hasBackup || loading}
            onClick={requestRestore}
            title="최초 흰칠 전 파일로 복원"
          >
            <History size={15} /> 원본 복원
          </Button>
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div className="flex size-full items-center justify-center overflow-hidden rounded-lg bg-black shadow-inner">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full cursor-none touch-none object-contain"
            onContextMenu={(event) => event.preventDefault()}
            onPointerEnter={(event) => updateCursor(event.clientX, event.clientY)}
            onPointerLeave={() => {
              if (cursorRef.current) cursorRef.current.style.opacity = '0'
            }}
            onPointerMove={(event) => {
              updateCursor(event.clientX, event.clientY)
              if (activeStrokeRef.current) appendPoint(event)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || loading) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              activeStrokeRef.current = { size: brushSizeRef.current, points: [] }
              appendPoint(event)
            }}
            onPointerUp={commitStroke}
            onPointerCancel={commitStroke}
            onWheel={(event) => {
              event.preventDefault()
              const next = Math.min(
                MAX_BRUSH,
                Math.max(MIN_BRUSH, brushSizeRef.current + (event.deltaY < 0 ? BRUSH_STEP : -BRUSH_STEP))
              )
              brushSizeRef.current = next
              setBrushSize(next)
              updateCursor(event.clientX, event.clientY)
            }}
          />
        </div>
        <div
          ref={cursorRef}
          className="pointer-events-none fixed left-0 top-0 z-[102] rounded-full border border-black bg-white/35 opacity-0 shadow-[0_0_0_1px_white]"
        />
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/55">
            <Loader2 size={28} className="animate-spin" />
          </div>
        )}
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[12px] shadow">
          흰색 원형 브러시 {brushSize}px · 마우스 휠로 크기 조절
        </div>
      </main>
    </div>,
    document.body
  )
}
