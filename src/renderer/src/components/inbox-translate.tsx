import { Check, Languages, Send } from 'lucide-react'
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
const REPLY_MAX = 1000

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
 * 댓글 본문. bubble은 대화 말풍선(받은 댓글), plain은 다른 카드 안에 넣는 작은 글씨.
 * 외국어 댓글이면 아래에 '한국어로 보기'를 두고, 번역하면 그 자리에서 번역문으로 바꿔 보여준다.
 * 원문과 번역은 한 번 눌러 오갈 수 있다. 부모가 key로 댓글마다 초기화한다.
 */
export function TranslatableText({
  text,
  variant
}: {
  text: string
  variant: 'bubble' | 'plain'
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
    <div className="shrink-0">
      <p
        className={cn(
          'select-text whitespace-pre-wrap break-words',
          variant === 'bubble'
            ? 'mt-1.5 w-fit max-w-[92%] rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-relaxed'
            : 'mt-1 text-[12px] text-muted'
        )}
      >
        {shown || '내용 없음'}
      </p>
      {foreign && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
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
              <span className="min-w-0 text-danger">{state.message}</span>
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
              <span className="min-w-0 truncate text-faint">
                {state.original ? '원문' : languageLabel(state.detected) + ' → 한국어 · DeepL'}
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
 * 상세 패널 바닥의 답글 입력칸. 쓸수록 늘어나고(5줄에서 시작), 번역 버튼·글자 수·보내기를
 * 입력칸 안 한 줄에 둔다. 번역은 입력한 답글을 고른 언어로 바꿔 넣고, 바로 되돌리거나 복사할 수 있다.
 * 댓글 글자로 짐작한 언어 버튼은 인디고로 살짝 강조한다.
 */
export function ReplyComposer({
  value,
  onChange,
  source,
  placeholder,
  ready,
  sending,
  onSend
}: {
  value: string
  onChange: (value: string) => void
  source: string
  placeholder: string
  /** 원래 댓글을 찾아서 보낼 수 있는 상태인지 */
  ready: boolean
  sending: boolean
  onSend: () => void
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
  const canSend = !!value.trim() && ready && !sending

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
    // 패널이 좁으면(창을 줄였을 때) 글자 수를 숨겨 언어 버튼과 보내기가 한 줄에 남게 한다.
    <div className="@container shrink-0 px-3.5 pb-2">
      <div className="rounded-2xl border border-line bg-surface transition-colors focus-within:border-accent/55">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          maxLength={REPLY_MAX}
          placeholder={placeholder}
          aria-label="답글"
          className="block max-h-[260px] min-h-[116px] w-full resize-none bg-transparent px-4 pb-1.5 pt-3.5 text-[13.5px] leading-relaxed text-ink outline-none [field-sizing:content] placeholder:text-faint"
        />
        {fresh && last && (
          <p className="flex items-center gap-1.5 px-4 pb-1.5 text-[11.5px] text-muted">
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
          <p className="flex px-4 pb-1.5 text-[11.5px]">
            <NoKey />
          </p>
        ) : (
          error && <p className="px-4 pb-1.5 text-[11.5px] text-danger">{error}</p>
        )}
        <div className="flex items-center gap-2 py-2 pl-2.5 pr-2">
          <div
            role="group"
            aria-label="답글을 바꿀 언어"
            className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5"
          >
            {WRITE_TARGETS.map((t) => (
              <button
                key={t.id}
                disabled={!value.trim() || busy !== null}
                onClick={() => void translate(t.id)}
                title={
                  t.name + '로 바꾸기' + (suggested === t.id ? ' · 댓글이 ' + t.name + '예요' : '')
                }
                className={cn(
                  'h-7 whitespace-nowrap rounded-md px-2.5 text-[11.5px] font-semibold transition-colors enabled:hover:bg-surface enabled:hover:text-ink disabled:opacity-45',
                  suggested === t.id ? 'text-accent' : 'text-muted'
                )}
              >
                {busy === t.id ? '바꾸는 중…' : t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto hidden whitespace-nowrap text-[11px] tabular-nums text-faint @min-[380px]:inline">
            {value.length} / {REPLY_MAX}
          </span>
          <button
            disabled={!canSend}
            onClick={onSend}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 text-[12.5px] font-bold text-white transition-colors disabled:bg-surface-2 disabled:text-faint dark:text-paper @min-[380px]:ml-0"
          >
            <Send size={14} /> {sending ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}
