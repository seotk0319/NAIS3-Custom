import { useRef, useState } from 'react'
import { Copy, ListChecks, Trash2 } from 'lucide-react'
import {
  usePromptPresetsStore,
  normalizePresetParts,
  partsForApply,
  pickPresetParams
} from '../stores/prompt-presets-store'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore } from '../stores/scenes-store'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

export function PresetManager({
  kind,
  onClose
}: {
  kind: 'prompt' | 'scene'
  onClose: () => void
}): React.JSX.Element {
  const prompts = usePromptPresetsStore((s) => s.presets)
  const scenes = useScenesStore((s) => s.presets)
  const activePrompt = usePromptPresetsStore((s) => s.activeId)
  const activeScene = useScenesStore((s) => s.activePresetId)
  const presets = kind === 'prompt' ? prompts : scenes
  const activeId = kind === 'prompt' ? activePrompt : activeScene
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const visible = presets.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
  const ids = presets.filter((p) => selected.has(p.id)).map((p) => p.id)
  const allVisible = visible.length > 0 && visible.every((p) => selected.has(p.id))

  const run = async (action: 'duplicate' | 'delete'): Promise<void> => {
    if (locked.current || !ids.length) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const ps = usePromptPresetsStore.getState()
      // 복제 직전 마지막 입력(500ms 디바운스 대기 포함)도 원본 프리셋에 반영한다.
      if (kind === 'prompt' && ps.activeId != null && ids.includes(ps.activeId)) {
        if (action === 'duplicate') {
          const gen = useGenerationStore.getState()
          await ps.update(ps.activeId, {
            prompt: gen.request.prompt,
            negativePrompt: gen.request.negativePrompt,
            params: pickPresetParams(gen.request),
            ...(gen.promptSplitEnabled
              ? { promptParts: normalizePresetParts(gen.request.promptParts) }
              : {})
          })
        } else ps.setActive(null)
      }
      const result = await window.nais.invoke('presets:manage', { kind, action, ids })
      if (kind === 'prompt') {
        await ps.load()
        if (action === 'delete' && activePrompt != null && ids.includes(activePrompt)) {
          const next = usePromptPresetsStore.getState().presets[0]
          if (next) {
            ps.setActive(next.id)
            useGenerationStore
              .getState()
              .patchRequest({
                prompt: next.prompt,
                promptParts: partsForApply(next),
                negativePrompt: next.negativePrompt,
                ...(next.params ?? {})
              })
          }
        }
      } else {
        const ss = useScenesStore.getState()
        if (action === 'delete' && ids.includes(ss.activePresetId)) ss.select(null)
        await ss.loadPresets()
      }
      setSelected(new Set(action === 'duplicate' ? result.ids : []))
      setConfirmDelete(false)
    } catch (e) {
      if (
        kind === 'prompt' &&
        activePrompt != null &&
        usePromptPresetsStore.getState().presets.some((p) => p.id === activePrompt)
      )
        usePromptPresetsStore.getState().setActive(activePrompt)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-[620px] flex-col gap-3 p-5">
        <DialogTitle className="flex shrink-0 items-center gap-2">
          <ListChecks size={18} />
          {kind === 'prompt' ? '프롬프트' : '씬'} 프리셋 관리
        </DialogTitle>
        <p className="shrink-0 text-[12px] text-muted">
          {kind === 'scene'
            ? '복제: 씬·프롬프트·해상도·캐릭터 바인드 복사. 이미지·생성 예약은 제외해요. 삭제해도 이미지 파일은 유지돼요.'
            : '프롬프트 3분할·네거티브·생성 설정을 함께 복제해요. 삭제해도 이미지 파일은 유지돼요.'}
        </p>
        <input
          aria-label="프리셋 검색"
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="프리셋 검색"
          className="h-9 shrink-0 rounded-md border border-line bg-paper px-3 text-[13px]"
        />
        <label className="flex shrink-0 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={allVisible}
            disabled={busy || !visible.length}
            onChange={() => {
              setConfirmDelete(false)
              setSelected((old) => {
                const next = new Set(old)
                for (const p of visible) {
                  if (allVisible) next.delete(p.id)
                  else next.add(p.id)
                }
                return next
              })
            }}
          />
          검색 결과 전체 선택{' '}
          <span className="text-faint">
            ({ids.length}개 선택 / 전체 {presets.length}개)
          </span>
        </label>
        <div className="min-h-0 max-h-80 overflow-y-auto rounded-md border border-line">
          {visible.map((p) => (
            <label
              key={p.id}
              className="flex min-h-10 cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-2"
            >
              <input
                aria-label={`${p.name} 선택`}
                type="checkbox"
                checked={selected.has(p.id)}
                disabled={busy}
                onChange={() => {
                  setConfirmDelete(false)
                  setSelected((old) => {
                    const next = new Set(old)
                    if (next.has(p.id)) next.delete(p.id)
                    else next.add(p.id)
                    return next
                  })
                }}
              />
              <span className="min-w-0 flex-1 break-words text-[13px]">{p.name}</span>
              {p.id === activeId && (
                <span className="shrink-0 text-[11px] text-accent">사용 중</span>
              )}
            </label>
          ))}
          {!visible.length && <p className="p-4 text-[13px] text-faint">검색 결과 없음</p>}
        </div>
        {error && (
          <p role="alert" className="shrink-0 text-[12px] text-danger">
            {error}
          </p>
        )}
        {confirmDelete && (
          <p className="shrink-0 text-[12px] text-danger">
            선택한 {ids.length}개 프리셋{kind === 'scene' ? '과 그 안의 씬' : ''}을 삭제할까요?
            되돌릴 수 없어요.
          </p>
        )}
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button disabled={busy} variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={busy || !ids.length} onClick={() => void run('duplicate')}>
            <Copy size={14} />
            선택 복제
          </Button>
          <Button
            disabled={busy || !ids.length || ids.length === presets.length}
            title="프리셋은 최소 1개 남겨주세요"
            className="text-danger"
            onClick={() => (confirmDelete ? void run('delete') : setConfirmDelete(true))}
          >
            <Trash2 size={14} />
            {confirmDelete ? '삭제 확정' : '선택 삭제'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
