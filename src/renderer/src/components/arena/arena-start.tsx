import {
  Check,
  ChevronDown,
  CircleSlash,
  Heart,
  Plus,
  RotateCcw,
  TriangleAlert,
  X
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  ARENA_SLOT_COUNT,
  BUDGETS,
  DEFAULT_SCENES,
  EXTRA_SCENES,
  comboString,
  estimateTotal,
  hasArtistToken,
  prependArtistToken,
  type ArenaBudget,
  type ArenaGenParams,
  type ArenaSessionConfig,
  type ArenaTarget
} from '@shared/arena'
import { isV5Model } from '@shared/nai-models'
import { estimateV5Images } from '@shared/v5-usage'
import { cn } from '../../lib/utils'
import { useArenaStore } from '../../stores/arena-store'
import { useGenerationStore } from '../../stores/generation-store'
import { Button } from '../ui/button'
import { Input, Textarea } from '../ui/input'
import { Card } from './arena-common'
import { useLimitGate } from './arena-utils'

function todayName(): string {
  const d = new Date()
  return d.getMonth() + 1 + '월 ' + d.getDate() + '일 세션'
}

function paramsFromMain(): ArenaGenParams {
  const r = useGenerationStore.getState().request
  return {
    model: r.model,
    width: r.width,
    height: r.height,
    steps: r.steps,
    cfgScale: r.cfgScale,
    cfgRescale: r.cfgRescale,
    sampler: r.sampler,
    noiseSchedule: r.noiseSchedule,
    variety: r.variety,
    qualityToggle: r.qualityToggle,
    ucPreset: r.ucPreset as ArenaGenParams['ucPreset'],
    transparentBackground: r.transparentBackground
  }
}

function num(v: string): number {
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : NaN
}

export function ArenaStart(): React.JSX.Element {
  const seed = useArenaStore((s) => s.negativeSeed)
  const setNegativeSeed = useArenaStore((s) => s.setNegativeSeed)
  const artists = useArenaStore((s) => s.artists)
  const artistsLoaded = useArenaStore((s) => s.artistsLoaded)
  const creating = useArenaStore((s) => s.creating)
  const create = useArenaStore((s) => s.create)
  const setView = useArenaStore((s) => s.setView)
  const v5Usage = useGenerationStore((s) => s.v5Usage)
  const { gate, dialog } = useLimitGate()

  const [init] = useState(() => {
    const req = useGenerationStore.getState().request
    const c = seed?.config
    return {
      prompt: c?.basePrompt ?? req.prompt,
      negative: c?.negativePrompt ?? req.negativePrompt,
      params: c?.params ?? paramsFromMain(),
      scenes: c?.scenes?.length ? c.scenes.slice(0, ARENA_SLOT_COUNT) : [...DEFAULT_SCENES]
    }
  })
  const [target, setTarget] = useState<ArenaTarget>(seed ? 'negative' : 'positive')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState(init.prompt)
  const [negative, setNegative] = useState(init.negative)
  const [scenes, setScenes] = useState<string[]>(init.scenes)
  const [scenesOpen, setScenesOpen] = useState(true)
  const [minA, setMinA] = useState('3')
  const [maxA, setMaxA] = useState('6')
  const [minW, setMinW] = useState('0.8')
  const [maxW, setMaxW] = useState('1.6')
  const [negW, setNegW] = useState('1.0')
  const [budget, setBudget] = useState<ArenaBudget>('normal')
  const params = init.params

  const liked = useMemo(() => artists.filter((a) => a.list === 'liked'), [artists])
  const avoided = useMemo(() => artists.filter((a) => a.list === 'avoided'), [artists])
  const positive = target === 'positive'
  const field = positive ? prompt : negative
  const tokenMissing = !hasArtistToken(field)
  const shape = {
    minA: num(minA),
    maxA: num(maxA),
    minW: num(minW),
    maxW: num(maxW),
    negW: num(negW)
  }
  const needed = positive ? BUDGETS[budget].prelim : 2 + 2 * avoided.length
  const remaining = v5Usage && isV5Model(params.model) ? estimateV5Images(v5Usage) : null
  const defaultName = seed && !positive ? seed.label + ' 네거티브' : todayName()
  const scenesEdited =
    scenes.length !== DEFAULT_SCENES.length || scenes.some((s, i) => s !== DEFAULT_SCENES[i])
  const total = estimateTotal(budget, scenes.length)
  const addScene = (): void => {
    if (scenes.length >= ARENA_SLOT_COUNT) return
    const next = EXTRA_SCENES.find((s) => !scenes.includes(s)) ?? ''
    setScenes([...scenes, next])
  }

  let reason: { text: string; action?: ReactNode } | null = null
  if (tokenMissing)
    reason = {
      text: (positive ? '긍정' : '네거티브') + ' 프롬프트에 작가 조합 자리({artist})가 없어요'
    }
  else if (scenes.some((s) => !s.trim())) reason = { text: '빈 장면을 채우거나 지워 주세요' }
  else if (
    positive &&
    (!Number.isInteger(shape.minA) ||
      !Number.isInteger(shape.maxA) ||
      shape.minA < 1 ||
      shape.maxA < shape.minA)
  )
    reason = { text: '작가 수 범위를 확인해 주세요' }
  else if (positive && !(shape.minW > 0 && shape.maxW >= shape.minW))
    reason = { text: '가중치 범위를 확인해 주세요' }
  else if (!positive && !(shape.negW > 0)) reason = { text: '네거티브 가중치를 확인해 주세요' }
  else if (!artistsLoaded) reason = { text: '작가 명단을 불러오는 중이에요' }
  else if (positive && liked.length < shape.maxA)
    reason = {
      text: '좋아하는 작가가 ' + shape.maxA + '명은 있어야 해요 · 지금 ' + liked.length + '명',
      action: (
        <Button size="sm" onClick={() => setView('artists')}>
          작가 탭으로
        </Button>
      )
    }
  else if (!positive && avoided.length === 0)
    reason = {
      text: '피하고 싶은 작가를 먼저 추가해 주세요',
      action: (
        <Button size="sm" onClick={() => setView('artists')}>
          작가 탭으로
        </Button>
      )
    }

  const start = (): void => {
    if (reason) return
    const config: ArenaSessionConfig = {
      name: name.trim() || defaultName,
      target,
      basePrompt: prompt,
      negativePrompt: negative,
      params,
      scenes: scenes.map((s) => s.trim()),
      minArtists: positive ? shape.minA : 1,
      maxArtists: positive ? shape.maxA : 1,
      minWeight: positive ? shape.minW : shape.negW,
      maxWeight: positive ? shape.maxW : shape.negW,
      budget,
      ...(positive
        ? {}
        : {
            fixedPositive: seed?.pairs,
            negCandidates: avoided.map((a) => a.tag),
            negWeight: Math.round(shape.negW * 10) / 10
          })
    }
    gate(needed, params.model, (limit) => void create(config, limit))
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pb-2 pr-1">
        <h2 className="text-[16px] font-bold tracking-tight">무엇을 찾을까요?</h2>
        <div className="grid grid-cols-2 gap-3">
          <TargetCard
            on={positive}
            onClick={() => setTarget('positive')}
            icon={<Heart size={18} />}
            title="좋아하는 그림체 찾기"
            desc="긍정 프롬프트의 작가 조합 자리를 채워 가며 비교해요"
            chips={['좋아하는 작가 ' + liked.length + '명']}
          />
          <TargetCard
            on={!positive}
            onClick={() => setTarget('negative')}
            icon={<CircleSlash size={18} />}
            title="피하고 싶은 그림체 찾기 (네거티브)"
            desc="네거티브의 작가 조합 자리에 넣고 그림이 나아지는지 봐요"
            chips={[
              '피하고 싶은 작가 ' + avoided.length + '명',
              seed ? '긍정 고정 · ' + seed.label : '긍정 조합 고정 없음'
            ]}
          />
        </div>

        <Row label="세션 이름">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            className="h-10 max-w-[360px] rounded-xl border-transparent bg-paper px-3"
          />
        </Row>

        <Row label="긍정 프롬프트" sub="메인 탭에서 가져왔어요">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="rounded-xl border-transparent bg-paper p-3"
          />
          {positive && (
            <TokenLine missing={tokenMissing} onFix={() => setPrompt(prependArtistToken(prompt))} />
          )}
          {!positive && seed && (
            <p className="mt-1.5 text-[12px] text-muted">
              {'{artist}'} 자리에 고정 조합이 들어가요 ·{' '}
              <span className="font-mono">{comboString(seed.pairs)}</span>
            </p>
          )}
        </Row>

        <Row label="네거티브">
          <Textarea
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            rows={positive ? 2 : 3}
            className="rounded-xl border-transparent bg-paper p-3"
          />
          {!positive && (
            <TokenLine
              missing={tokenMissing}
              onFix={() => setNegative(prependArtistToken(negative))}
            />
          )}
        </Row>

        <Row label="검증 장면" sub="장면마다 시드를 고정해요">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setScenesOpen((o) => !o)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-paper px-3 text-[13px] font-semibold"
            >
              {scenesEdited
                ? '장면 ' + scenes.length + '개 · 고쳤어요'
                : '기본 장면 ' + DEFAULT_SCENES.length + '개'}
              <ChevronDown
                size={14}
                className={cn('text-muted transition-transform', scenesOpen && 'rotate-180')}
              />
            </button>
            <span className="text-[12px] text-muted">
              {'{scene}'}이 없으면 프롬프트 끝에 붙어요
            </span>
            {scenesEdited && (
              <Button variant="ghost" size="sm" onClick={() => setScenes([...DEFAULT_SCENES])}>
                <RotateCcw size={13} />
                기본값으로
              </Button>
            )}
          </div>
          {scenesOpen && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 xl:grid-cols-2">
              {scenes.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-[11.5px] font-semibold text-faint">
                    {i + 1}
                  </span>
                  <Input
                    value={s}
                    onChange={(e) =>
                      setScenes(scenes.map((x, k) => (k === i ? e.target.value : x)))
                    }
                    className={cn(
                      'h-8 rounded-lg border-transparent bg-paper',
                      !s.trim() && 'border-danger/60'
                    )}
                  />
                  <button
                    title="이 장면 빼기"
                    disabled={scenes.length <= 1}
                    onClick={() => setScenes(scenes.filter((_, k) => k !== i))}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-ink disabled:invisible"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {scenes.length < ARENA_SLOT_COUNT && (
                <button
                  onClick={addScene}
                  className="flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-[12.5px] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <Plus size={14} />
                  장면 더하기
                  <span className="font-normal text-faint">
                    장면이 많을수록 결선·확정에서 더 뽑아요
                  </span>
                </button>
              )}
            </div>
          )}
        </Row>

        {positive ? (
          <>
            <Row label="조합 모양">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                <Range label="작가" a={minA} b={maxA} setA={setMinA} setB={setMaxA} unit="명" />
                <Range label="가중치" a={minW} b={maxW} setA={setMinW} setB={setMaxW} />
              </div>
            </Row>
            <Row label="예산" sub="세션 전체에서 쓸 장수">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(BUDGETS) as ArenaBudget[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setBudget(k)}
                    className={cn(
                      'flex h-10 items-center gap-1.5 rounded-xl border-2 px-4 text-[13px] font-semibold transition-colors',
                      budget === k
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-transparent bg-paper text-ink'
                    )}
                  >
                    {BUDGETS[k].label}
                    <span className="font-normal text-muted">
                      약 {estimateTotal(k, scenes.length)}장
                    </span>
                  </button>
                ))}
              </div>
            </Row>
          </>
        ) : (
          <Row label="후보 작가" sub="피하고 싶은 작가 전체">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              <span>
                <b>{avoided.length}명</b>을 한 명씩 기준과 비교해요
              </span>
              <label className="flex items-center gap-2">
                <span className="text-muted">가중치</span>
                <Input
                  value={negW}
                  onChange={(e) => setNegW(e.target.value)}
                  className="h-8 w-16 rounded-lg border-transparent bg-paper text-center"
                />
              </label>
            </div>
          </Row>
        )}
      </div>

      <Card className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <div className="text-[12px] text-muted">
            {positive ? '먼저 뽑을 이미지' : '이번 세션에서 쓸 이미지'}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <b className="text-[32px] font-bold tabular-nums tracking-tight">
              {needed.toLocaleString()}
            </b>
            <span className="text-[14px] font-semibold">장</span>
          </div>
          {positive && (
            <p className="text-[12.5px] text-muted">
              세션 전체 약 {total.toLocaleString()}장 · 대결은 나오는 대로 바로 해요
            </p>
          )}
        </div>
        <div className="flex flex-col text-[13px]">
          {remaining != null && (
            <SumRow
              label="오늘 남은 V5"
              value={'약 ' + remaining.toLocaleString() + '장'}
              warn={remaining < needed}
            />
          )}
          {positive ? (
            <SumRow
              label="좋아하는 작가"
              value={liked.length + '명'}
              note={liked.length < 12 ? '12명 이상이면 더 골고루 섞여요' : undefined}
            />
          ) : (
            <>
              <SumRow label="후보 작가" value={avoided.length + '명'} />
              <SumRow
                label="긍정 고정"
                value={
                  seed
                    ? seed.pairs[0]?.tag +
                      (seed.pairs.length > 1 ? ' 외 ' + (seed.pairs.length - 1) + '명' : '')
                    : '없음'
                }
              />
            </>
          )}
          <SumRow
            label="생성 설정"
            value={params.width + '×' + params.height + ' · ' + params.steps + '스텝'}
            note={seed && !positive ? '긍정 세션 설정 그대로' : '메인 탭 설정 그대로'}
          />
        </div>
        {seed && !positive && (
          <button
            className="self-start text-[12px] text-muted underline-offset-2 hover:underline"
            onClick={() => setNegativeSeed(null)}
          >
            긍정 고정 풀기
          </button>
        )}
        <div className="flex-1" />
        {reason && (
          <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{reason.text}</span>
            {reason.action}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Button
            variant="accent"
            size="lg"
            disabled={!!reason || creating}
            className="h-[52px] rounded-xl text-[15px]"
            onClick={start}
          >
            {positive
              ? '예선 시작 · 먼저 ' + needed.toLocaleString() + '장'
              : '네거티브 찾기 시작 · ' + needed.toLocaleString() + '장'}
          </Button>
          <p className="text-center text-[11.5px] text-faint">
            {positive
              ? '세션 전체 약 ' + total.toLocaleString() + '장'
              : '후보마다 장면 2개씩 기준과 비교해요'}
          </p>
        </div>
      </Card>
      {dialog}
    </div>
  )
}

function Row({
  label,
  sub,
  children
}: {
  label: string
  sub?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-4">
      <div className="w-[112px] shrink-0 pt-2">
        <div className="text-[13px] font-semibold">{label}</div>
        {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function TargetCard({
  on,
  onClick,
  icon,
  title,
  desc,
  chips
}: {
  on: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  desc: string
  chips: string[]
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-start gap-3.5 rounded-[20px] border-2 p-4 text-left transition-colors',
        on ? 'border-accent bg-accent-soft' : 'border-transparent bg-paper hover:border-line'
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl',
          on ? 'bg-accent text-white dark:text-paper' : 'bg-surface text-muted'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-bold text-ink">{title}</b>
        <span className="mt-0.5 block text-[12px] text-muted">{desc}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] font-semibold text-muted"
            >
              {c}
            </span>
          ))}
        </span>
      </span>
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full border-2',
          on ? 'border-accent bg-accent text-white dark:text-paper' : 'border-line'
        )}
      >
        {on && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  )
}

function TokenLine({ missing, onFix }: { missing: boolean; onFix: () => void }): React.JSX.Element {
  if (!missing)
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-accent">
        <Check size={13} />
        작가 조합 자리를 찾았어요
      </p>
    )
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-danger">
      <TriangleAlert size={13} />
      작가 조합이 들어갈 자리가 없어요
      <Button size="sm" className="h-6 rounded-md px-2 text-[12px]" onClick={onFix}>
        맨 앞에 넣기
      </Button>
    </div>
  )
}

function Range({
  label,
  a,
  b,
  setA,
  setB,
  unit
}: {
  label: string
  a: string
  b: string
  setA: (v: string) => void
  setB: (v: string) => void
  unit?: string
}): React.JSX.Element {
  const cls = 'h-8 w-14 rounded-lg border-transparent bg-paper text-center tabular-nums'
  return (
    <span className="flex items-center gap-1.5">
      <span className="mr-1 text-muted">{label}</span>
      <Input value={a} onChange={(e) => setA(e.target.value)} className={cls} />
      <span className="text-faint">–</span>
      <Input value={b} onChange={(e) => setB(e.target.value)} className={cls} />
      {unit && <span className="text-muted">{unit}</span>}
    </span>
  )
}

function SumRow({
  label,
  value,
  note,
  warn
}: {
  label: string
  value: string
  note?: string
  warn?: boolean
}): React.JSX.Element {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">{label}</span>
        <b className={cn('text-right', warn && 'text-danger')}>{value}</b>
      </div>
      {note && <p className="mt-0.5 text-[11.5px] text-faint">{note}</p>}
    </div>
  )
}
