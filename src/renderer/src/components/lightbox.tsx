import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl } from '../lib/constants'
import { useGenerationStore } from '../stores/generation-store'
import { ImageContextMenu } from './image-context-menu'

/** 이미지 전체 화면 뷰어 (씬 상세/히스토리 공용). filePaths 배열 + 현재 인덱스로 좌우 이동 */
export function Lightbox({
  filePaths,
  index,
  onIndex,
  onClose
}: {
  filePaths: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}): React.JSX.Element | null {
  const revision = useGenerationStore((s) =>
    filePaths[index] ? s.imageRevisions[filePaths[index]] : undefined
  )
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1))
      else if (e.key === 'ArrowRight') onIndex(Math.min(filePaths.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, filePaths.length, onIndex, onClose])

  // 마우스 휠로 이전/다음 이미지. 터치패드처럼 잘게 오는 휠은 모아서 한 칸만 넘긴다.
  const wheel = useRef({ sum: 0, last: 0 })
  const onWheel = (e: React.WheelEvent): void => {
    const w = wheel.current
    const now = performance.now()
    if (now - w.last > 250) w.sum = 0
    w.sum += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(w.sum) < 40 || now - w.last < 120) return
    const step = w.sum > 0 ? 1 : -1
    w.sum = 0
    w.last = now
    const next = Math.min(filePaths.length - 1, Math.max(0, index + step))
    if (next !== index) onIndex(next)
  }

  if (index < 0 || index >= filePaths.length) return null
  const hasPrev = index > 0
  const hasNext = index < filePaths.length - 1

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      onWheel={onWheel}
    >
      <button
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {hasPrev && (
        <button
          className="absolute left-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {/* 우클릭 메뉴 (저장/복사/메타데이터 등) — 확대 상태에서도 사용 가능 */}
      <ImageContextMenu filePath={filePaths[index]}>
        <img
          src={imageUrl(filePaths[index], revision)}
          className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          alt=""
        />
      </ImageContextMenu>
      {hasNext && (
        <button
          className="absolute right-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index + 1)
          }}
        >
          <ChevronRight size={24} />
        </button>
      )}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 font-mono text-[12px] text-white">
        {index + 1} / {filePaths.length}
      </span>
    </div>,
    document.body
  )
}
