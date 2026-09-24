import {
  ChevronDown,
  ChevronUp,
  ImageUp,
  Info,
  Layers,
  Minus,
  Plus,
  Puzzle,
  SlidersHorizontal,
  Square,
  UsersRound,
  Zap
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { estimateAnlas } from '@shared/anlas'
import { fullModelForVersion, isV5Model, tokenLimitForModel } from '@shared/nai-models'
import { removeComments } from '@shared/nai-presets'
import { cn } from '../lib/utils'
import { useCharactersStore } from '../stores/characters-store'
import { useFragmentsStore } from '../stores/fragments-store'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useCharRefsStore, useVibesStore } from '../stores/refs-store'
import { useScenesStore } from '../stores/scenes-store'
import { useStorageSettingsStore } from '../stores/storage-settings-store'
import { PromptEditor } from './prompt-editor'
import { PromptPresetBar } from './prompt-preset-bar'
import { CharacterOverlay } from './character-overlay'
import { FragmentOverlay } from './fragment-overlay'
import { ParamsDialog } from './params-dialog'
import { RefOverlay } from './ref-overlay'
import { SOURCE_BANNER_HEIGHT, SourceBanner } from './source-banner'
import { Button } from './ui/button'
import { EditableCount } from './ui/editable-count'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'

function anlasTooltip(anlas: ReturnType<typeof estimateAnlas>, batchCount: number): string {
  if (anlas.total === 0) return '무료 생성 (Opus · 1024² 이하 · 28스텝 이하)'

  const lines = [`총 ${anlas.total} Anlas`]
  if (anlas.generation > 0) {
    lines.push(`생성 ${anlas.generation} Anlas (장당 ${anlas.perImage} × ${batchCount})`)
  } else if (anlas.charRef > 0) {
    lines.push('생성 0 Anlas')
  }
  if (anlas.charRef > 0) lines.push(`캐릭터 레퍼런스 ${anlas.charRef} Anlas`)
  if (anlas.vibeEncoding > 0) lines.push(`바이브 인코딩 ${anlas.vibeEncoding} Anlas`)
  return lines.join('\n')
}

export function PromptPanel(): React.JSX.Element {
  const request = useGenerationStore((s) => s.request)
  const patch = useGenerationStore((s) => s.patchRequest)
  const v5Enabled = isV5Model(request.model)
  const tokenLimit = tokenLimitForModel(request.model)
  const patchPromptParts = useGenerationStore((s) => s.patchPromptParts)
  const promptSplitEnabled = useGenerationStore((s) => s.promptSplitEnabled)
  const queue = useGenerationStore((s) => s.queue)
  const batchCount = useGenerationStore((s) => s.batchCount)
  const setBatchCount = useGenerationStore((s) => s.setBatchCount)
  const generate = useGenerationStore((s) => s.generate)
  const cancelAll = useGenerationStore((s) => s.cancelAll)
  const charOverlayOpen = useCharactersStore((s) => s.overlayOpen)
  const toggleCharOverlay = useCharactersStore((s) => s.toggleOverlay)
  const charItems = useCharactersStore((s) => s.items)
  const fragOverlayOpen = useFragmentsStore((s) => s.overlayOpen)
  const setFragOverlayOpen = useFragmentsStore((s) => s.setOverlayOpen)
  const vibeOverlayOpen = useVibesStore((s) => s.overlayOpen)
  const setVibeOverlayOpen = useVibesStore((s) => s.setOverlayOpen)
  const enabledVibes = useVibesStore((s) => s.items.filter((v) => v.enabled).length)
  const crefOverlayOpen = useCharRefsStore((s) => s.overlayOpen)
  const setCrefOpen = useCharRefsStore((s) => s.setOverlayOpen)
  const enabledCrefs = useCharRefsStore((s) => s.items.filter((c) => c.enabled).length)
  const source = useGenerationStore((s) => s.source)
  const [paramsOpen, setParamsOpen] = useState(false)
  const stripExif = useStorageSettingsStore((s) => s.stripExif)
  const loadStorageSettings = useStorageSettingsStore((s) => s.load)
  const setStripExif = useStorageSettingsStore((s) => s.setStripExif)
  const setAccelerationEnabled = useGenerationStore((s) => s.setAccelerationEnabled)
  const seedLocked = useGenerationStore((s) => s.seedLocked)

  useEffect(() => {
    const openParams = (): void => setParamsOpen((v) => !v)
    window.addEventListener('shortcut:openParams', openParams)
    return () => window.removeEventListener('shortcut:openParams', openParams)
  }, [])

  useEffect(() => {
    void loadStorageSettings()
  }, [loadStorageSettings])

  // 씬 모드: 생성은 예약된 씬들을 예약 수만큼 큐에 넣는다. 예약 0이면 생성 버튼 비활성.
  const centerMode = useLayoutStore((s) => s.centerMode)
  // 모든 프리셋의 예약 총합 — 씬 생성 버튼 한 번으로 전부 실행
  const sceneReserved = useScenesStore((s) => s.reservedTotal)
  const presetScenes = useScenesStore((s) => s.scenes)
  const generateReserved = useScenesStore((s) => s.generateReserved)
  const isScene = centerMode === 'scene'
  // 프롬프트/네거티브 개별 접기 — 하나를 접으면 다른 하나가 넓어짐.
  // 네거티브는 기본으로 펼쳐 두고(이전 작업의 네거티브가 남은 걸 바로 보게), 접은 상태는 기억한다.
  const [posCollapsed, setPosCollapsed] = useState(false)
  const [negCollapsed, setNegCollapsedState] = useState(
    () => localStorage.getItem('prompt_neg_collapsed') === '1'
  )
  const setNegCollapsed = (update: (v: boolean) => boolean): void =>
    setNegCollapsedState((v) => {
      const next = update(v)
      localStorage.setItem('prompt_neg_collapsed', next ? '1' : '0')
      return next
    })
  // 네거티브 높이(px) — 사이 스플리터 드래그로 조절. 프롬프트가 남는 높이를 모두 쓴다.
  const promptAreaRef = useRef<HTMLDivElement>(null)
  const [negHeight, setNegHeight] = useState(() => {
    const v = Number(localStorage.getItem('prompt_neg_height'))
    return v >= 72 && v <= 600 ? v : 120
  })
  const bothOpen = !posCollapsed && !negCollapsed
  const negHeightRef = useRef(negHeight)
  useEffect(() => {
    negHeightRef.current = negHeight
  }, [negHeight])
  const startPromptResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const area = promptAreaRef.current
    if (!area) return
    const onMove = (ev: MouseEvent): void => {
      const rect = area.getBoundingClientRect()
      const next = Math.round(rect.bottom - ev.clientY)
      setNegHeight(Math.min(Math.max(72, next), Math.max(72, rect.height - 160)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem('prompt_neg_height', String(negHeightRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const subscriptionTier = useGenerationStore((s) => s.subscriptionTier)
  const queueCount =
    queue?.items.filter((i) => i.state === 'pending' || i.state === 'generating').length ?? 0
  const generating = queueCount > 0
  const activeChars = charItems.filter((c) => c.enabled && c.prompt.trim()).length

  // 토큰 표시: 포지티브는 기본+캐릭터 합산(공홈과 동일), 네거티브는 메인 것만 —
  // 공홈이 메인 네거와 캐릭터 네거를 별개로 세므로 합산하지 않는다 (캐릭 네거는 카드에서 자체 표시)
  const [tokenTotals, setTokenTotals] = useState<{ pos: number | null; neg: number | null }>({
    pos: null,
    neg: null
  })
  const enabledChars = useMemo(
    () => charItems.filter((c) => c.enabled && c.prompt.trim()),
    [charItems]
  )
  useEffect(() => {
    // #주석은 토큰 합산에서 제외 (에디터 자체 카운터와 동일 규칙)
    const posTexts = [request.prompt, ...enabledChars.map((c) => c.prompt)]
      .map((t) => removeComments(t))
      .filter((t) => t.trim())
    const negTexts = [removeComments(request.negativePrompt)].filter((t) => t.trim())
    if (posTexts.length === 0 && negTexts.length === 0) {
      const timer = setTimeout(() => setTokenTotals({ pos: null, neg: null }))
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      void window.nais
        .invoke('tokens:count', { texts: [...posTexts, ...negTexts], model: request.model })
        .then(({ counts }) => {
          // 캡션별 공식 토크나이저 결과를 그대로 합산한다.
          const sum = (arr: number[]): number | null =>
            arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0)
          setTokenTotals({
            pos: sum(counts.slice(0, posTexts.length)),
            neg: sum(counts.slice(posTexts.length))
          })
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [request.prompt, request.negativePrompt, request.model, enabledChars])

  const anlas = useMemo(
    () =>
      estimateAnlas({
        width: request.width,
        height: request.height,
        steps: request.steps,
        charRefCount: enabledCrefs,
        isOpus: subscriptionTier === 'opus',
        batchCount,
        unencodedVibes: 0 // 캐시 상태는 오버레이에서 확인 — 배지로만 안내
      }),
    [request.width, request.height, request.steps, subscriptionTier, batchCount, enabledCrefs]
  )

  // 파라미터 요약 줄: 씬 모드는 씬마다 해상도가 달라서, 예약된 씬(없으면 전체 씬) 중 가장 큰 해상도로 판단한다.
  const summary = useMemo(() => {
    const seedText = seedLocked && request.seed >= 0 ? `시드 ${request.seed}` : '시드 무작위'
    if (!isScene) {
      return {
        text: `${request.width} × ${request.height} · ${request.steps}스텝 · ${seedText}`,
        free: anlas.total === 0,
        cost: anlas.total,
        tip: anlasTooltip(anlas, batchCount)
      }
    }
    const reserved = presetScenes.filter((sc) => sc.reserveCount > 0)
    const pool = reserved.length > 0 ? reserved : presetScenes
    const largest = pool.reduce(
      (best, sc) => (sc.width * sc.height > best.width * best.height ? sc : best),
      { width: request.width, height: request.height }
    )
    const sizes = new Set(pool.map((sc) => `${sc.width}×${sc.height}`))
    const perImage = estimateAnlas({
      width: largest.width,
      height: largest.height,
      steps: request.steps,
      charRefCount: enabledCrefs,
      isOpus: subscriptionTier === 'opus',
      batchCount: 1,
      unencodedVibes: 0
    })
    const sizeText =
      sizes.size > 1 ? `씬별 해상도 (최대 ${largest.width} × ${largest.height})` : `${largest.width} × ${largest.height}`
    return {
      text: `${sizeText} · ${request.steps}스텝 · ${seedText}`,
      free: perImage.total === 0,
      cost: perImage.total,
      tip:
        perImage.total === 0
          ? '예약한 씬이 모두 무료 범위예요 (Opus · 1024² 이하 · 28스텝 이하)'
          : `가장 큰 씬 기준 장당 약 ${perImage.total} Anlas`
    }
  }, [isScene, presetScenes, request.width, request.height, request.steps, request.seed, seedLocked, anlas, batchCount, enabledCrefs, subscriptionTier])

  // 오버레이는 하나만 열림 — 서로 배타
  const only = (target: 'char' | 'frag' | 'vibe' | 'cref'): void => {
    const map = {
      char: charOverlayOpen,
      frag: fragOverlayOpen,
      vibe: vibeOverlayOpen,
      cref: crefOverlayOpen
    }
    const willOpen = !map[target]
    if (charOverlayOpen) toggleCharOverlay()
    setFragOverlayOpen(false)
    setVibeOverlayOpen(false)
    setCrefOpen(false)
    if (!willOpen) return
    if (target === 'char') toggleCharOverlay()
    else if (target === 'frag') setFragOverlayOpen(true)
    else if (target === 'vibe') setVibeOverlayOpen(true)
    else setCrefOpen(true)
  }

  return (
    <aside className="relative flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4">
      {/* 상단 여백을 창 드래그 영역으로 (프롬프트 영역 위) */}
      <div className="drag absolute inset-x-0 top-0 h-3" />
      {/* 오버레이는 프롬프트 영역만 덮는다 — 하단 버튼들은 항상 접근 가능 (NAIS2 2.0.7 교훈)
          셸 하나가 열림/닫힘만 애니메이션하고 내용은 즉시 전환 — 오버레이 간 전환 깜빡임 방지 */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-2">
        <AnimatePresence>
          {(charOverlayOpen || fragOverlayOpen || vibeOverlayOpen || crefOverlayOpen) && (
            <motion.div
              key="overlay-shell"
              className="absolute -inset-1 z-10 rounded-lg bg-surface p-1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {charOverlayOpen ? (
                <CharacterOverlay />
              ) : fragOverlayOpen ? (
                <FragmentOverlay />
              ) : vibeOverlayOpen ? (
                // key로 vibe↔charref 전환 시 리마운트 → 카드 등장 애니메이션 방지 (캐릭터/조각과 동일하게 빠릿)
                <RefOverlay key="vibe" kind="vibe" />
              ) : (
                <RefOverlay key="charref" kind="charref" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {source && (
            <motion.div
              key="source-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: SOURCE_BANNER_HEIGHT, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <SourceBanner />
            </motion.div>
          )}
        </AnimatePresence>
        {/* 생성 모델 — 왼쪽 패널 상단에서 V4.5 Full / V5 Full 전환 */}
        <label
          className="flex h-9 shrink-0 cursor-pointer items-center justify-between rounded-xl bg-paper px-3"
          title={`현재 NAI Diffusion ${v5Enabled ? 'V5 Full' : 'V4.5 Full'} 모델을 사용합니다`}
        >
          <span className="text-[11px] font-medium text-muted">생성 모델</span>
          <span className="flex items-center gap-2">
            <span
              className={
                v5Enabled ? 'text-[11px] text-faint' : 'text-[11px] font-semibold text-ink'
              }
            >
              V4.5
            </span>
            <Switch
              aria-label={`생성 모델 ${v5Enabled ? 'V5 Full' : 'V4.5 Full'}`}
              checked={v5Enabled}
              onCheckedChange={(enabled) =>
                patch({
                  model: fullModelForVersion(
                    enabled ? '5' : '4.5',
                    request.model.includes('inpainting')
                  )
                })
              }
            />
            <span
              className={
                v5Enabled ? 'text-[11px] font-semibold text-accent' : 'text-[11px] text-faint'
              }
            >
              V5
            </span>
          </span>
        </label>
        {/* 프롬프트 프리셋 — 포지티브 프롬프트 위 */}
        <PromptPresetBar />
        {/* 헤더를 제외한 실제 편집 영역을 기준으로 리사이즈한다. 최소 높이보다
            창이 작으면 이 영역만 스크롤하고 하단 도구/생성 버튼은 밀지 않는다. */}
        <div ref={promptAreaRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div
            className={
              'flex flex-col gap-1 overflow-hidden ' + (posCollapsed ? 'flex-none' : 'min-h-32')
            }
            style={!posCollapsed ? { flexGrow: 1, flexBasis: 0 } : undefined}
          >
            <CollapseHeader
              label="프롬프트"
              collapsed={posCollapsed}
              onToggle={() => setPosCollapsed((v) => !v)}
              action={
                <div className="flex items-center gap-1">
                  {promptSplitEnabled && <TokenBadge tokens={tokenTotals.pos} limit={tokenLimit} />}
                  <SyntaxHelp />
                </div>
              }
            />
            {!posCollapsed &&
              (promptSplitEnabled ? (
                <SplitPromptFields
                  parts={
                    request.promptParts ?? { base: request.prompt, additional: '', detail: '' }
                  }
                  onChange={patchPromptParts}
                />
              ) : (
                <PromptEditor
                  className="min-h-0 flex-1"
                  value={request.prompt}
                  tokensOverride={tokenTotals.pos}
                  placeholder="1girl, ...  (태그 자동완성 · <조각>)"
                  onValueChange={(v) => patch({ prompt: v })}
                />
              ))}
          </div>
          {/* 세로 비율 조절 스플리터 (둘 다 펼쳐졌을 때만) */}
          {bothOpen && (
            <div
              className="group -my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
              onMouseDown={startPromptResize}
            >
              <div className="h-0.5 w-8 rounded-full bg-line transition-colors group-hover:bg-accent/50" />
            </div>
          )}
          <div
            className={
              'flex flex-col gap-1 overflow-hidden ' + (negCollapsed ? 'flex-none' : 'min-h-[72px]')
            }
            style={
              bothOpen
                ? { height: negHeight, flexShrink: 0 }
                : !negCollapsed
                  ? { flexGrow: 1 }
                  : undefined
            }
          >
            <CollapseHeader
              label="네거티브"
              collapsed={negCollapsed}
              onToggle={() => setNegCollapsed((v) => !v)}
            />
            {!negCollapsed && (
              <PromptEditor
                negative
                className="min-h-0 flex-1"
                value={request.negativePrompt}
                tokensOverride={tokenTotals.neg}
                placeholder="UC 프리셋 뒤에 이어 붙습니다"
                onValueChange={(v) => patch({ negativePrompt: v })}
              />
            )}
          </div>
        </div>
      </div>

      {/* 도구 행: 캐릭터 / 조각 / 바이브 / 레퍼런스 — 자주 쓰지 않아 얇게, 사용 중인 것만 강조 */}
      <div className="grid shrink-0 grid-cols-4 gap-1">
        <ToolButton
          active={charOverlayOpen}
          icon={<UsersRound size={14} />}
          label="캐릭터"
          badge={activeChars}
          onClick={() => only('char')}
        />
        <ToolButton
          active={fragOverlayOpen}
          icon={<Puzzle size={14} />}
          label="조각"
          badge={0}
          onClick={() => only('frag')}
        />
        <ToolButton
          active={vibeOverlayOpen}
          icon={<Layers size={14} />}
          label="바이브"
          badge={enabledVibes}
          onClick={() => only('vibe')}
        />
        <ToolButton
          active={crefOverlayOpen}
          icon={<ImageUp size={14} />}
          label="레퍼런스"
          badge={enabledCrefs}
          onClick={() => only('cref')}
        />
      </div>

      {/* 파라미터 요약: 해상도 · 스텝 · 시드 + 무료 여부. 누르면 생성 파라미터 창 */}
      <button
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-paper px-3 text-left text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        title={`생성 파라미터 열기\n${summary.tip}`}
        onClick={() => setParamsOpen(true)}
      >
        <SlidersHorizontal size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate tabular-nums">{summary.text}</span>
        <span
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
            summary.free ? 'bg-[#1fa56a]/12 text-[#1fa56a]' : 'bg-danger/12 text-danger'
          )}
        >
          {summary.free ? '무료' : `${summary.cost.toLocaleString()} Anlas`}
        </span>
      </button>

      {/* 옵션 행: 가속 모드 · Anlas 소모 · EXIF 제거 */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-[12px] font-medium text-muted">
        {queue?.accelerationAvailable && (
          <>
            {!!queue.pausedAccounts?.length && (
              <span
                className="mr-auto text-[11px] text-accent"
                title={queue.pausedAccounts.map((a) => a.reason).join('\n')}
              >
                잔량 대기 {queue.pausedAccounts.length}계정
              </span>
            )}
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title={`등록 계정 ${queue.accountCount}개 · 현재 ${queue.busyAccountCount}개 생성 중`}
            >
              <Zap
                size={12}
                className={queue.accelerationEnabled ? 'text-accent' : 'text-faint'}
              />
              가속 모드
              <Switch
                aria-label={`가속 모드 ${queue.accelerationEnabled ? '켜짐' : '꺼짐'}`}
                checked={queue.accelerationEnabled}
                disabled={queue.running}
                onCheckedChange={(enabled) => void setAccelerationEnabled(enabled)}
              />
            </label>
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title="ON: 기존처럼 유료 생성 허용. OFF: 메인·씬 생성 전 무료 여부 확인, 1% 미만/확인 실패 계정 대기. 이미 전송한 요청은 소급 적용하지 않으며 다른 앱과 같은 계정을 동시에 쓰면 과금 방지를 보장할 수 없습니다."
            >
              Anlas 소모
              <Switch
                aria-label={`Anlas 소모 ${queue.anlasSpendingEnabled !== false ? 'ON' : 'OFF'}`}
                checked={queue.anlasSpendingEnabled !== false}
                onCheckedChange={(enabled) =>
                  void window.nais
                    .invoke('anlasSpending:set', { enabled })
                    .then((status) => useGenerationStore.setState({ queue: status }))
                }
              />
            </label>
          </>
        )}
        <label
          className="flex cursor-pointer items-center gap-1.5"
          title={
            stripExif
              ? '켜짐: 저장 이미지에서 EXIF와 프롬프트 메타데이터를 제거합니다'
              : '꺼짐: 저장 이미지에 EXIF와 프롬프트 메타데이터를 유지합니다'
          }
        >
          EXIF 제거
          <Switch
            aria-label={`EXIF 자동 제거 ${stripExif ? '켜짐' : '꺼짐'}`}
            checked={stripExif}
            onCheckedChange={(value) => void setStripExif(value)}
          />
        </label>
      </div>

      {/* 생성 행: 배치 / 생성 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-11 items-center rounded-lg bg-paper">
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-7 rounded-r-none"
            onClick={() => setBatchCount(batchCount - 1)}
          >
            <Minus size={13} />
          </Button>
          <EditableCount
            value={batchCount}
            min={1}
            max={99}
            onCommit={setBatchCount}
            className="w-8 text-center text-[13px] font-semibold tabular-nums text-ink"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-7 rounded-l-none"
            onClick={() => setBatchCount(batchCount + 1)}
          >
            <Plus size={13} />
          </Button>
        </div>
        {generating && (
          <Button
            variant="danger"
            size="lg"
            className={isScene ? 'h-11 flex-1 rounded-xl' : 'h-11 shrink-0 rounded-xl px-3'}
            onClick={() => void cancelAll()}
          >
            <Square size={14} /> 취소 ({queueCount})
          </Button>
        )}
        {!generating && isScene ? (
          <Button
            variant="accent"
            size="lg"
            className="h-11 flex-1 gap-2 rounded-xl text-[15px]"
            disabled={sceneReserved === 0}
            title={
              sceneReserved === 0
                ? '씬에 예약(+)을 걸어야 생성할 수 있습니다'
                : `모든 프리셋의 예약 ${sceneReserved}장 생성 (프리셋 순서대로)`
            }
            onClick={() => void generateReserved()}
          >
            씬 생성
            {sceneReserved > 0 && (
              // 한글 '장'이 mono 폴백(Windows Consolas)에서 깨져 보여 기본 폰트(Pretendard) 사용
              <span className="text-[12px] opacity-75">{sceneReserved}장</span>
            )}
          </Button>
        ) : !isScene ? (
          <Button
            variant="accent"
            size="lg"
            className="h-11 flex-1 gap-2 rounded-xl text-[15px]"
            title={anlasTooltip(anlas, batchCount)}
            onClick={() => void generate()}
          >
            생성
          </Button>
        ) : null}
      </div>

      <ParamsDialog open={paramsOpen} onOpenChange={setParamsOpen} />
    </aside>
  )
}

/** 프롬프트/네거티브 라벨 + 개별 접기 토글(^) */
function CollapseHeader({
  label,
  collapsed,
  onToggle,
  action
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between px-0.5 text-[12px] font-semibold text-muted">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 transition-colors hover:text-ink"
        title={collapsed ? `${label} 펼치기` : `${label} 접기`}
      >
        <span>{label}</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {action}
    </div>
  )
}

function TokenBadge({
  tokens,
  limit
}: {
  tokens: number | null
  limit: number
}): React.JSX.Element | null {
  if (tokens === null) return null
  const over = tokens > limit
  return (
    <span
      className={
        'rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] ' +
        (over ? 'text-danger' : 'text-faint')
      }
      title={
        over
          ? `한도 초과 — ${tokens}/${limit} 토큰. 초과분은 잘려서 반영되지 않습니다`
          : `최종 프롬프트 ${tokens}/${limit} 토큰`
      }
    >
      {tokens}/{limit}
    </span>
  )
}

type SplitPartKey = 'base' | 'additional' | 'detail'
type SplitPromptParts = Record<SplitPartKey, string>

const SPLIT_PARTS: { key: SplitPartKey; label: string; placeholder: string }[] = [
  { key: 'base', label: '고정', placeholder: '항상 유지할 기본 프롬프트' },
  { key: 'additional', label: '가변', placeholder: '매번 지우고 바꿀 프롬프트' },
  { key: 'detail', label: '디테일', placeholder: '품질, 구도, 세부 묘사' }
]

const SPLIT_COLLAPSED_KEY = 'prompt_split_collapsed'
const SPLIT_SIZES_KEY = 'prompt_split_sizes'

function loadSplitCollapsed(): Record<SplitPartKey, boolean> {
  const fallback = { base: false, additional: false, detail: false }
  try {
    const raw = JSON.parse(localStorage.getItem(SPLIT_COLLAPSED_KEY) ?? '{}') as Partial<
      Record<SplitPartKey, boolean>
    >
    return {
      base: raw.base === true,
      additional: raw.additional === true,
      detail: raw.detail === true
    }
  } catch {
    return fallback
  }
}

function loadSplitSizes(): Record<SplitPartKey, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SPLIT_SIZES_KEY) ?? '{}') as Partial<
      Record<SplitPartKey, number>
    >
    const base = typeof raw.base === 'number' ? raw.base : 0.34
    const additional = typeof raw.additional === 'number' ? raw.additional : 0.33
    const detail = typeof raw.detail === 'number' ? raw.detail : 0.33
    return { base, additional, detail }
  } catch {
    return { base: 0.34, additional: 0.33, detail: 0.33 }
  }
}

function SplitPromptFields({
  parts,
  onChange
}: {
  parts: SplitPromptParts
  onChange: (patch: Partial<SplitPromptParts>) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(loadSplitCollapsed)
  const [sizes, setSizes] = useState(loadSplitSizes)
  const sizesRef = useRef(sizes)
  useEffect(() => {
    sizesRef.current = sizes
  }, [sizes])

  const openKeys = SPLIT_PARTS.filter((part) => !collapsed[part.key]).map((part) => part.key)

  const togglePart = (key: SplitPartKey): void => {
    setCollapsed((current) => {
      const next = { ...current, [key]: !current[key] }
      localStorage.setItem(SPLIT_COLLAPSED_KEY, JSON.stringify(next))
      return next
    })
  }

  const startSplitResize = (
    before: SplitPartKey,
    after: SplitPartKey,
    e: React.MouseEvent<HTMLDivElement>
  ): void => {
    e.preventDefault()
    const area = containerRef.current
    if (!area) return
    const startY = e.clientY
    const start = sizesRef.current
    const beforeStart = start[before]
    const afterStart = start[after]
    const pairTotal = beforeStart + afterStart
    const min = Math.min(0.16, pairTotal / 2)

    const onMove = (ev: MouseEvent): void => {
      const height = Math.max(1, area.getBoundingClientRect().height)
      const delta = (ev.clientY - startY) / height
      const nextBefore = Math.min(pairTotal - min, Math.max(min, beforeStart + delta))
      const nextAfter = pairTotal - nextBefore
      setSizes((current) => {
        const next = { ...current, [before]: nextBefore, [after]: nextAfter }
        sizesRef.current = next
        return next
      })
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem(SPLIT_SIZES_KEY, JSON.stringify(sizesRef.current))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const nextOpenAfter = (key: SplitPartKey): SplitPartKey | undefined => {
    const index = openKeys.indexOf(key)
    return index >= 0 ? openKeys[index + 1] : undefined
  }

  // flex-grow 합이 1 미만이면 남는 공간을 다 안 채운다 (CSS 스펙) —
  // 칸을 접으면 열린 칸들의 비율 합이 1이 되도록 정규화해서 나머지가 자동으로 커지게 한다
  const openTotal = openKeys.reduce((sum, key) => sum + sizes[key], 0)

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {SPLIT_PARTS.map((part) => {
        const isCollapsed = collapsed[part.key]
        const nextOpen = isCollapsed ? undefined : nextOpenAfter(part.key)
        return (
          <Fragment key={part.key}>
            <SplitField
              label={part.label}
              collapsed={isCollapsed}
              value={parts[part.key]}
              placeholder={part.placeholder}
              grow={sizes[part.key] / (openTotal || 1)}
              onToggle={() => togglePart(part.key)}
              onChange={(value) => onChange({ [part.key]: value })}
            />
            {nextOpen && (
              <div
                className="group -my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                onMouseDown={(e) => startSplitResize(part.key, nextOpen, e)}
              >
                <div className="h-0.5 w-8 rounded-full bg-line transition-colors group-hover:bg-accent/50" />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function SplitField({
  label,
  collapsed,
  value,
  placeholder,
  grow,
  onToggle,
  onChange
}: {
  label: string
  collapsed: boolean
  value: string
  placeholder: string
  grow: number
  onToggle: () => void
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div
      className={
        'flex flex-col gap-1 overflow-hidden ' + (collapsed ? 'flex-none' : 'min-h-[4.5rem]')
      }
      style={collapsed ? undefined : { flexGrow: grow, flexBasis: 0 }}
    >
      <CollapseHeader label={label} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <PromptEditor
          className="min-h-0 flex-1"
          value={value}
          tokensOverride={null}
          placeholder={placeholder}
          onValueChange={onChange}
        />
      )}
    </div>
  )
}

/** 프롬프트 문법 도움말 — ⓘ 팝오버 (주석·조각·순차·랜덤·가중치) */
function SyntaxHelp(): React.JSX.Element {
  const rows: { syntax: string; desc: string }[] = [
    { syntax: '# 메모', desc: '줄 맨 앞의 #만 전체 줄 주석 (전송 제외)' },
    { syntax: '<이름>', desc: '조각 삽입 — 여러 줄이면 매 생성 랜덤 1줄' },
    { syntax: '<*이름>', desc: '순차 선택 — 생성마다 다음 줄 (헤더 ↺로 리셋)' },
    { syntax: '<a|b|c>', desc: '인라인 랜덤 — 셋 중 하나' },
    { syntax: '1.3::태그::', desc: '강조 (1보다 크면 강함, 작으면 약함/음수 가능)' }
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="grid size-5 place-items-center rounded text-faint transition-colors hover:text-ink"
          title="프롬프트 문법 도움말"
        >
          <Info size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2.5">
        <p className="mb-1.5 text-[12px] font-semibold text-ink">프롬프트 문법</p>
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.syntax} className="flex flex-col gap-0.5">
              <code className="w-fit rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                {r.syntax}
              </code>
              <span className="text-[11px] leading-snug text-muted">{r.desc}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ToolButton({
  active,
  icon,
  label,
  badge,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  badge: number
  onClick: () => void
}): React.JSX.Element {
  const inUse = badge > 0
  return (
    <button
      className={cn(
        'flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[12px] font-semibold transition-colors',
        active
          ? 'bg-accent text-white dark:text-paper'
          : inUse
            ? 'bg-accent-soft text-accent'
            : 'text-muted hover:bg-paper hover:text-ink'
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {inUse && (
        <span
          className={cn(
            'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums',
            active ? 'bg-white/25 text-white dark:text-paper' : 'bg-accent text-white dark:text-paper'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
