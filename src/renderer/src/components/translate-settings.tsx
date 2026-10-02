import { Languages } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TranslateUsage } from '@shared/translate'
import { cn } from '../lib/utils'
import { askConfirm } from '../stores/dialog-store'
import { useTranslateStore } from '../stores/translate-store'
import { Button } from './ui/button'
import { Input } from './ui/input'

/** 설정 > 번역. DeepL 키를 확인해 저장하고, 이번 달 사용량을 보여준다. */
export function TranslateSection(): React.JSX.Element {
  const status = useTranslateStore((s) => s.status)
  const load = useTranslateStore((s) => s.load)
  const setStatus = useTranslateStore((s) => s.setStatus)
  const [usage, setUsage] = useState<TranslateUsage | null>(null)
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  const connected = !!status?.hasKey

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!connected) return
    let live = true
    void window.nais
      .invoke('translate:usage', undefined)
      .catch(() => null)
      .then((result) => {
        if (live) setUsage(result)
      })
    return () => {
      live = false
    }
  }, [connected, status?.tail])

  async function save(): Promise<void> {
    if (!key.trim() || busy) return
    setBusy(true)
    setNote(null)
    try {
      const result = await window.nais.invoke('translate:setKey', { key })
      setNote(result)
      if (result.ok) {
        setKey('')
        setEditing(false)
        if (result.usage) setUsage(result.usage)
        setStatus(await window.nais.invoke('translate:status', undefined))
      }
    } catch {
      setNote({ ok: false, message: '키를 저장하지 못했어요. 다시 시도해주세요.' })
    } finally {
      setBusy(false)
    }
  }
  async function remove(): Promise<void> {
    const ok = await askConfirm('DeepL 연결을 해제할까요?', {
      message: '저장한 키를 지워요. 다시 쓰려면 키를 새로 넣어야 해요.',
      confirmLabel: '해제',
      danger: true
    })
    if (!ok) return
    await window.nais.invoke('translate:deleteKey', undefined)
    setUsage(null)
    setNote(null)
    await load()
  }

  const percent =
    usage?.ok && usage.used !== null && usage.limit
      ? Math.min(100, (usage.used / usage.limit) * 100)
      : null

  return (
    <div>
      <p className="mb-4 text-[12px] leading-relaxed text-faint">
        알림 모아보기에서 댓글을 한국어로 읽거나, 답글을 영어·중국어 번체·일본어로 바꿀 때 DeepL을
        써요. 번역할 글만 보내고 기록은 남기지 않아요.
      </p>
      {connected && !editing ? (
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Languages size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink">DeepL 연결됨</p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {status?.free ? '무료 API' : 'Pro API'} · 키 끝 {status?.tail}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-muted">이번 달 사용량</span>
              <span className="tabular-nums text-ink">
                {usage === null
                  ? '불러오는 중…'
                  : usage.ok && usage.used !== null
                    ? `${usage.used.toLocaleString()} / ${usage.limit?.toLocaleString() ?? '?'}자`
                    : ''}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            {usage && !usage.ok && (
              <p className="mt-2 text-[11.5px] text-danger">{usage.message}</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" onClick={() => setEditing(true)}>
              키 바꾸기
            </Button>
            <Button
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={() => void remove()}
            >
              연결 해제
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            placeholder="DeepL API 키 붙여넣기"
            aria-label="DeepL API 키"
            className="h-10 rounded-lg"
          />
          <div className="flex gap-2">
            <Button
              variant="accent"
              size="lg"
              className="flex-1"
              disabled={!key.trim() || busy}
              onClick={() => void save()}
            >
              {busy ? '키를 확인하는 중…' : '확인하고 저장'}
            </Button>
            {connected && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setEditing(false)
                  setKey('')
                  setNote(null)
                }}
              >
                취소
              </Button>
            )}
          </div>
          <p className="text-[11.5px] leading-relaxed text-faint">
            무료 키는 끝이 :fx예요. 무료로 한 달에 50만 자까지 쓸 수 있어요. 키가 없다면{' '}
            <button
              className="font-medium text-accent hover:underline"
              onClick={() => window.open('https://www.deepl.com/ko/pro-api', '_blank')}
            >
              DeepL API 무료 가입
            </button>
            에서 받을 수 있어요.
          </p>
        </div>
      )}
      {note && (
        <p className={cn('mt-3 text-[12px]', note.ok ? 'text-accent' : 'text-danger')}>
          {note.message}
        </p>
      )}
    </div>
  )
}
