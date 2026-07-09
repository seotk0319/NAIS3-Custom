import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

/**
 * 숫자 표시 + 클릭하면 직접 입력. +/- 버튼을 여러 번 안 눌러도 큰 수량을 바로 타이핑.
 * 씬 예약 수 / 배치 수량 등 스텝퍼 가운데 숫자에 재사용.
 * - 클릭: 편집 모드 진입(전체 선택). Enter/blur 확정, Escape 취소.
 * - 카드 드래그/선택과 충돌하지 않게 pointer/click 전파를 막는다.
 */
export function EditableCount({
  value,
  onCommit,
  min = 0,
  max = 9999,
  className,
  inputClassName
}: {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  className?: string
  inputClassName?: string
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    const raw = Math.round(Number(draft))
    if (Number.isFinite(raw)) onCommit(Math.max(min, Math.min(max, raw)))
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
          }
        }}
        className={cn(
          'no-drag [appearance:textfield] bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className,
          inputClassName
        )}
      />
    )
  }

  return (
    <button
      type="button"
      title="클릭해서 직접 입력"
      onClick={(e) => {
        e.stopPropagation()
        setDraft(String(value))
        setEditing(true)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn('no-drag cursor-text tabular-nums', className)}
    >
      {value}
    </button>
  )
}
