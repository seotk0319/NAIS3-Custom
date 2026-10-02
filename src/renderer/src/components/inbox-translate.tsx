import { Check, Languages } from 'lucide-react'
import { useState } from 'react'
import { guessReplyTarget, languageLabel, looksForeign, WRITE_TARGETS } from '@shared/translate'
import type { TranslateResult, TranslateTarget } from '@shared/translate'
import { cn } from '../lib/utils'
import { useLayoutStore } from '../stores/layout-store'
import { useTranslateStore } from '../stores/translate-store'

const failed = (): TranslateResult => ({
  ok: false,
  text: '',
  detected: null,
  message: '번역하지 못했어요. 잠시 뒤 다시 시도해주세요.'
})
const run = (text: string, target: TranslateTarget): Promise<TranslateResult> =>
  window.nais.invoke('translate:run', { text, target }).catch(failed)

function NoKey(): React.JSX.Element {
  const openSettingsAt = useLayoutStore((s) => s.openSettingsAt)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 text-faint">DeepL 키를 넣으면 쓸 수 있어요</span>
      <button
        className="shrink-0 font-semibold text-accent hover:underline"
        onClick={() => openSettingsAt('translate')}
      >
        설정
      </button>
    </span>
  )
}

type ReadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'nokey' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; text: string; detected: string | null; original: boolean }

/**
 * 댓글 본문 카드. 외국어 댓글이면 아래에 '한국어로 보기'를 두고, 번역하면 그 자리에서
 * 번역문으로 바꿔 보여준다. 원문과 번역은 한 번 눌러 오갈 수 있다. 부모가 key로 댓글마다 초기화한다.
 */
export function TranslatableText({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const hasKey = useTranslateStore((s) => s.status?.hasKey)
  const [state, setState] = useState<ReadState>({ kind: 'idle' })
  const foreign = looksForeign(text)
  const shown = state.kind === 'done' && !state.original ? state.text : text
  async function translate(): Promise<void> {
    if (!hasKey) return setState({ kind: 'nokey' })
    setState({ kind: 'loading' })
    const result = await run(text, 'KO')
    setState(
      result.ok
        ? { kind: 'done', text: result.text, detected: result.detected, original: false }
        : { kind: 'error', message: result.message }
    )
  }
  return (
    // 상세 패널은 세로 flex라, 넘칠 때 이 카드가 눌리지 않게 shrink-0을 둔다.
    <div
      className={cn('shrink-0 overflow-hidden rounded-xl border border-line bg-paper', className)}
    >
      <p className="select-text whitespace-pre-wrap break-words p-3 text-[13px] leading-relaxed">
        {shown || '내용 없음'}
      </p>
      {foreign && (
        <div className="flex min-h-9 items-center gap-2 border-t border-line px-3 py-1.5 text-[11.5px]">
          {state.kind === 'idle' && (
            <button
              onClick={() => void translate()}
              className="inline-flex items-center gap-1.5 font-semibold text-accent hover:opacity-80"
            >
              <Languages size={13} /> 한국어로 보기
            </button>
          )}
          {state.kind === 'loading' && <span className="text-faint">번역하는 중…</span>}
          {state.kind === 'nokey' && <NoKey />}
          {state.kind === 'error' && (
            <>
              <span className="min-w-0 flex-1 text-danger">{state.message}</span>
              <button
                className="shrink-0 font-semibold text-accent"
                onClick={() => void translate()}
              >
                다시
              </button>
            </>
          )}
          {state.kind === 'done' && (
            <>
              <span className="min-w-0 flex-1 truncate text-faint">
                {state.original ? '원문' : `${languageLabel(state.detected)} → 한국어 · DeepL`}
              </span>
              <button
                className="shrink-0 font-semibold text-accent hover:opacity-80"
                onClick={() =>
                  setState((s) => (s.kind === 'done' ? { ...s, original: !s.original } : s))
                }
              >
                {state.original ? '번역 보기' : '원문 보기'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 답글 입력칸 아래의 번역 줄. 고른 언어로 입력한 답글을 바꿔 넣고, 바로 되돌리거나 복사할 수 있다.
 * 댓글 글자로 짐작한 언어를 살짝 강조한다.
 */
export function ReplyTranslate({
  value,
  onChange,
  source
}: {
  value: string
  onChange: (value: string) => void
  source: string
}): React.JSX.Element {
  const hasKey = useTranslateStore((s) => s.status?.hasKey)
  const suggested = guessReplyTarget(source)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [last, setLast] = useState<{
    previous: string
    translated: string
    from: string | null
    to: string
  } | null>(null)
  // 번역한 그대로일 때만 되돌리기를 보여준다. 손으로 고친 뒤엔 고친 글을 지키려고 숨긴다.
  const fresh = !!last && last.translated === value
  const targetName = (id: string): string => WRITE_TARGETS.find((t) => t.id === id)?.name || id

  async function translate(target: Exclude<TranslateTarget, 'KO'>): Promise<void> {
    if (!value.trim() || busy) return
    if (!hasKey) return setError('NO_KEY')
    setBusy(target)
    setError(null)
    setCopied(false)
    const result = await run(value, target)
    setBusy(null)
    if (!result.ok) return setError(result.message)
    setLast({ previous: value, translated: result.text, from: result.detected, to: target })
    onChange(result.text)
  }
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setError('복사하지 못했어요.')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="font-medium text-muted">답글 번역</span>
        {suggested && (
          <span className="truncate text-faint">댓글이 {targetName(suggested)}예요</span>
        )}
      </div>
      <div
        role="group"
        aria-label="답글을 바꿀 언어"
        className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1"
      >
        {WRITE_TARGETS.map((t) => (
          <button
            key={t.id}
            disabled={!value.trim() || busy !== null}
            onClick={() => void translate(t.id)}
            title={`${t.name}로 바꾸기`}
            className={cn(
              'h-8 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40',
              suggested === t.id
                ? 'bg-paper text-accent shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:bg-paper/70 hover:text-ink'
            )}
          >
            {busy === t.id ? '바꾸는 중…' : t.label}
          </button>
        ))}
      </div>
      {fresh && last && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <Check size={12} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {languageLabel(last.from)} → {targetName(last.to)}로 바꿨어요
          </span>
          <button
            className="shrink-0 font-semibold text-accent hover:opacity-80"
            onClick={() => {
              onChange(last.previous)
              setLast(null)
            }}
          >
            되돌리기
          </button>
          <button className="shrink-0 hover:text-ink" onClick={() => void copy()}>
            {copied ? '복사됨' : '복사'}
          </button>
        </p>
      )}
      {error === 'NO_KEY' ? (
        <p className="flex text-[11.5px]">
          <NoKey />
        </p>
      ) : (
        error && <p className="text-[11.5px] text-danger">{error}</p>
      )}
    </div>
  )
}
