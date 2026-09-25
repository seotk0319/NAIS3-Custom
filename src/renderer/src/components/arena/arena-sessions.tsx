import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useArenaStore } from '../../stores/arena-store'
import { Button } from '../ui/button'
import { NegChip, Thumb } from './arena-common'
import { relativeDay } from './arena-utils'

export function ArenaSessions(): React.JSX.Element {
  const sessions = useArenaStore((s) => s.sessions)
  const loaded = useArenaStore((s) => s.sessionsLoaded)
  const currentId = useArenaStore((s) => s.currentSessionId)
  const openSession = useArenaStore((s) => s.openSession)
  const newSession = useArenaStore((s) => s.newSession)
  const removeSession = useArenaStore((s) => s.removeSession)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <h2 className="text-[18px] font-bold tracking-tight">지난 세션</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">행을 누르면 멈춘 곳부터 이어 해요</p>
        </div>
        <Button variant="accent" size="lg" className="rounded-xl" onClick={newSession}>
          <Plus size={15} />새 세션
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[20px] bg-paper px-2 py-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => void openSession(s.id)}
            onKeyDown={(e) => e.key === 'Enter' && void openSession(s.id)}
            className="group flex cursor-pointer items-center gap-4 border-b border-line px-3 py-3 last:border-b-0 hover:bg-surface/60 [contain-intrinsic-size:auto_72px] [content-visibility:auto]"
          >
            <Thumb path={s.thumbPath} className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <b className="truncate text-[14px]">{s.name}</b>
                {s.target === 'negative' && <NegChip />}
                {s.id === currentId && (
                  <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent">
                    지금 세션
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                {s.target === 'negative' ? '피하고 싶은 작가' : '좋아하는 작가 조합'} · 조합{' '}
                {s.comboCount}개 · {s.voteCount}판
              </p>
            </div>
            <span className="w-[120px] shrink-0 text-[12.5px] font-medium">{s.stageLabel}</span>
            <span className="w-[72px] shrink-0 text-[12.5px] text-muted">
              {relativeDay(s.updatedAt)}
            </span>
            <button
              title="지우기"
              onClick={(e) => {
                e.stopPropagation()
                void removeSession(s.id)
              }}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
            <ChevronRight size={16} className="shrink-0 text-faint" />
          </div>
        ))}
        {loaded && sessions.length === 0 && (
          <div className="py-16 text-center text-[13px] text-faint">
            아직 세션이 없어요. 새 세션으로 시작해요
          </div>
        )}
      </div>
    </div>
  )
}
