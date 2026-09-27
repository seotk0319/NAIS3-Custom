import { Loader2, Minus, Plus, Sparkles, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MangaBrief, MangaCastInput, MangaDialogueMode } from '@shared/manga'
import type { PromptPreset } from '@shared/types'
import { cn } from '../../lib/utils'
import { useCharactersStore } from '../../stores/characters-store'
import { useGenerationStore } from '../../stores/generation-store'
import { useMangaStore } from '../../stores/manga-store'
import { toast } from '../../stores/toast-store'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select'

const DIALOGUE: { v: MangaDialogueMode; label: string }[] = [
  { v: 'auto', label: '알아서' },
  { v: 'with', label: '컷마다 한 줄' },
  { v: 'none', label: '대사 없이' }
]

interface NewCast extends MangaCastInput {
  key: string
}

/** 새 이야기 시작 화면 */
export function MangaStart(): React.JSX.Element {
  const create = useMangaStore((s) => s.create)
  const creating = useMangaStore((s) => s.creating)
  const cards = useCharactersStore((s) => s.items)
  const [seed, setSeed] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [extra, setExtra] = useState<NewCast[]>([])
  const [dialogue, setDialogue] = useState<MangaDialogueMode>('auto')
  const [targetPages, setTargetPages] = useState(4)
  const [minCuts, setMinCuts] = useState(3)
  const [maxCuts, setMaxCuts] = useState(4)
  const [startCuts, setStartCuts] = useState(2)
  const [direction, setDirection] = useState('')
  const [place, setPlace] = useState('')
  const [action, setAction] = useState('')
  const [stateChange, setStateChange] = useState('')
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [presetId, setPresetId] = useState<string>('main')
  const [style, setStyle] = useState(() => useGenerationStore.getState().request.prompt)
  const [negative, setNegative] = useState(
    () => useGenerationStore.getState().request.negativePrompt
  )

  useEffect(() => {
    void window.nais.invoke('promptPresets:list', undefined).then((r) => setPresets(r.items))
  }, [])

  const pickPreset = (v: string): void => {
    setPresetId(v)
    if (v === 'main') {
      const req = useGenerationStore.getState().request
      setStyle(req.prompt)
      setNegative(req.negativePrompt)
      return
    }
    const p = presets.find((x) => String(x.id) === v)
    if (p) {
      setStyle(p.prompt)
      setNegative(p.negativePrompt)
    }
  }

  const cast = useMemo((): MangaCastInput[] => {
    const fromCards = picked
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({
        name: c.name || '인물',
        gender: 'auto' as const,
        appearance: c.prompt,
        personality: ''
      }))
    return [...fromCards, ...extra.filter((e) => e.appearance.trim() || e.name.trim())].slice(0, 4)
  }, [picked, cards, extra])

  const submit = (): void => {
    if (!seed.trim()) {
      toast('어떤 이야기인지 한 줄이라도 적어 주세요', 'info')
      return
    }
    const brief: MangaBrief = {
      seed,
      direction,
      place,
      action,
      stateChange,
      dialogue,
      targetPages,
      minCuts: Math.min(minCuts, maxCuts),
      maxCuts,
      startCuts
    }
    void create({ brief, cast, style: { prompt: style, negative } })
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <div className="mx-auto max-w-[760px] px-2 pb-36 pt-4">
          <div className="text-[26px] font-extrabold tracking-tight text-ink">
            어떤 이야기를 만들까요?
          </div>
          <div className="mt-1.5 text-[14px] text-faint">
            단어 하나나 짧은 문장이면 충분해요. 나머지는 글 모델이 이어서 써요.
          </div>
          <textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            maxLength={6000}
            rows={3}
            placeholder="예) 비 오는 날, 우산 없이 편의점 앞에 선 주희에게 선배가 우산을 씌워 준다"
            className="mt-4 w-full resize-none rounded-2xl bg-paper px-5 py-4 text-[16px] font-medium leading-relaxed text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/30"
          />

          <Section
            title="인물"
            hint="캐릭터 탭의 인물을 고르거나 새로 적어요. 비워 두면 알아서 정해요"
          >
            <div className="mt-3 flex flex-wrap gap-2">
              {cards.slice(0, 40).map((c) => {
                const on = picked.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setPicked(
                        on ? picked.filter((x) => x !== c.id) : [...picked, c.id].slice(0, 4)
                      )
                    }
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-3.5 text-left text-[13px] font-semibold transition',
                      on
                        ? 'bg-accent-soft text-ink ring-[1.5px] ring-accent'
                        : 'bg-paper text-muted hover:text-ink'
                    )}
                  >
                    {c.thumbnail ? (
                      <img
                        src={'data:image/webp;base64,' + c.thumbnail}
                        className="size-8 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-accent">
                        {(c.name || '?').slice(0, 1)}
                      </span>
                    )}
                    {c.name || '이름 없음'}
                  </button>
                )
              })}
              <button
                onClick={() =>
                  setExtra([
                    ...extra,
                    {
                      key: String(Date.now()),
                      name: '',
                      gender: 'girl',
                      appearance: '',
                      personality: ''
                    }
                  ])
                }
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-accent ring-[1.5px] ring-line hover:bg-accent-soft"
              >
                <UserPlus size={15} /> 새 인물
              </button>
            </div>
            {extra.map((e, i) => (
              <div key={e.key} className="mt-2 flex items-center gap-2 rounded-xl bg-paper p-2">
                <input
                  value={e.name}
                  onChange={(ev) =>
                    setExtra(extra.map((x, k) => (k === i ? { ...x, name: ev.target.value } : x)))
                  }
                  placeholder="이름"
                  className="h-9 w-28 rounded-lg bg-surface px-3 text-[13px] outline-none"
                />
                <div className="flex rounded-lg bg-surface p-0.5">
                  {(['girl', 'boy'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() =>
                        setExtra(extra.map((x, k) => (k === i ? { ...x, gender: g } : x)))
                      }
                      className={cn(
                        'h-8 rounded-md px-2.5 text-[12px] font-semibold',
                        e.gender === g ? 'bg-accent text-white dark:text-paper' : 'text-muted'
                      )}
                    >
                      {g === 'girl' ? '여성' : '남성'}
                    </button>
                  ))}
                </div>
                <input
                  value={e.appearance}
                  onChange={(ev) =>
                    setExtra(
                      extra.map((x, k) => (k === i ? { ...x, appearance: ev.target.value } : x))
                    )
                  }
                  placeholder="외형 태그 (영어) 예) short brown hair, navy coat"
                  className="h-9 min-w-0 flex-1 rounded-lg bg-surface px-3 font-mono text-[12px] outline-none"
                />
                <button
                  onClick={() => setExtra(extra.filter((_, k) => k !== i))}
                  className="grid size-8 place-items-center text-faint hover:text-danger"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </Section>

          <Section title="대사">
            <div className="mt-3 inline-flex rounded-xl bg-paper p-1">
              {DIALOGUE.map((d) => (
                <button
                  key={d.v}
                  onClick={() => setDialogue(d.v)}
                  className={cn(
                    'h-9 rounded-lg px-4 text-[13px] font-semibold transition',
                    dialogue === d.v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="분량" hint="편집자가 이 안에서 늘이거나 줄여요">
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <Stepper
                label="목표 페이지"
                value={targetPages}
                unit="쪽"
                min={1}
                max={30}
                onChange={setTargetPages}
              />
              <div className="rounded-2xl bg-paper px-4 py-3">
                <div className="text-[12px] font-semibold text-faint">페이지당 컷</div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <Mini value={minCuts} min={1} max={maxCuts} onChange={setMinCuts} />
                  <span className="text-[13px] text-faint">~</span>
                  <Mini value={maxCuts} min={Math.max(1, minCuts)} max={6} onChange={setMaxCuts} />
                  <span className="text-[13px] font-semibold text-muted">컷</span>
                </div>
              </div>
              <Stepper
                label="처음 쓸 컷"
                value={startCuts}
                unit="컷"
                min={1}
                max={4}
                onChange={setStartCuts}
              />
            </div>
          </Section>

          <Section title="그림체" hint="인물·장면 태그는 빼고 그림체와 품질 태그만 남겨 주세요">
            <Select value={presetId} onValueChange={pickPreset}>
              <SelectTrigger className="mt-3 h-10 w-[320px] rounded-xl border-transparent bg-paper px-3 text-[13px] font-semibold">
                {presetId === 'main'
                  ? '지금 메인 프롬프트'
                  : (presets.find((p) => String(p.id) === presetId)?.name ?? '프리셋')}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">지금 메인 프롬프트</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
              <textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                rows={4}
                className="resize-none rounded-xl bg-paper px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted outline-none focus:ring-2 focus:ring-accent/30"
              />
              <textarea
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                rows={4}
                placeholder="네거티브"
                className="resize-none rounded-xl bg-paper px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </Section>

          <Section title="더 정하기" hint="비워 두면 알아서 정해요">
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field
                label="장르 · 분위기"
                value={direction}
                onChange={setDirection}
                placeholder="잔잔한 로맨스, 설렘"
              />
              <Field
                label="장소"
                value={place}
                onChange={setPlace}
                placeholder="대학가 편의점 앞, 저녁"
              />
              <Field
                label="원하는 행동"
                value={action}
                onChange={setAction}
                placeholder="우산을 나눠 쓰고 함께 걷기"
              />
              <Field
                label="상태 변화"
                value={stateChange}
                onChange={setStateChange}
                placeholder="한쪽 어깨가 젖음"
              />
            </div>
          </Section>
        </div>
      </div>
      <div className="absolute inset-x-6 bottom-5 flex items-center gap-4 rounded-2xl bg-surface/95 py-3.5 pl-6 pr-3.5 shadow-[0_10px_34px_rgba(30,30,70,0.14)] ring-1 ring-line backdrop-blur">
        <div className="text-[13px] leading-relaxed text-muted">
          이야기는 <b className="text-ink">글 모델</b>이 써요 · Anlas 없음
          <br />
          그림은 <b className="text-ink">페이지당 V5 1장</b> · {targetPages}쪽이면 약 {targetPages}
          장
        </div>
        <button
          disabled={creating}
          onClick={submit}
          className="ml-auto flex h-12 items-center gap-2 rounded-2xl bg-accent px-7 text-[15px] font-bold text-white transition hover:opacity-90 disabled:opacity-60 dark:text-paper"
        >
          {creating ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
          {creating ? '첫 컷을 쓰는 중…' : '첫 이야기 만들기'}
        </button>
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-7">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold text-ink">{title}</span>
        {hint && <span className="text-[12.5px] text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <label className="rounded-xl bg-paper px-3.5 py-2.5">
      <span className="block text-[11px] font-semibold text-faint">{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="mt-0.5 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint/70"
      />
    </label>
  )
}

function Stepper(props: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="rounded-2xl bg-paper px-4 py-3">
      <div className="text-[12px] font-semibold text-faint">{props.label}</div>
      <div className="mt-2 flex items-center justify-between">
        <StepBtn onClick={() => props.onChange(Math.max(props.min, props.value - 1))}>
          <Minus size={14} />
        </StepBtn>
        <b className="text-[20px] tabular-nums text-ink">
          {props.value}
          {props.unit}
        </b>
        <StepBtn onClick={() => props.onChange(Math.min(props.max, props.value + 1))}>
          <Plus size={14} />
        </StepBtn>
      </div>
    </div>
  )
}

function Mini(props: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <StepBtn onClick={() => props.onChange(Math.max(props.min, props.value - 1))}>
        <Minus size={12} />
      </StepBtn>
      <b className="w-5 text-center text-[18px] tabular-nums text-ink">{props.value}</b>
      <StepBtn onClick={() => props.onChange(Math.min(props.max, props.value + 1))}>
        <Plus size={12} />
      </StepBtn>
    </div>
  )
}

function StepBtn({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg bg-surface text-muted hover:text-ink"
    >
      {children}
    </button>
  )
}
