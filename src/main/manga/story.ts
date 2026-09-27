/**
 * 이야기 쓰기·이어 쓰기·편집자 제안. 과제 문장은 NAIMangaMaker(okawaritsuika, 허락)의
 * 흐름을 바탕으로 줄여 다시 썼다: 컷 하나 = 그릴 수 있는 한 순간, 옷차림·소지품은 컷에서 컷으로 이어진다.
 * 이미지용 칸은 영어, 화면용 설명·대사는 한국어로 받는다 (V5가 한국어 말풍선을 그린다).
 */
import { randomUUID } from 'crypto'
import type {
  MangaBrief,
  MangaCastInput,
  MangaCastMember,
  MangaDialogueMode,
  MangaIntent,
  MangaPanel,
  MangaPanelState,
  MangaProject,
  MangaProposal
} from '../../shared/manga'
import { chat, parseJsonObject, TextModelError } from './text'

const PANEL_SCHEMA = [
  '{"subjects":["visible cast ids, at most two"],"speaker":"cast id who speaks in this panel, or null",',
  '"description":"one drawable instant in concise English","description_ko":"the same instant in one natural Korean sentence",',
  '"background":"only this shot\'s visible setting in English","dialogue_ko":"zero or one short Korean line, or empty string",',
  '"framing":"shot size such as close-up, upper body, cowboy shot, full body, wide shot, hands close-up",',
  '"angle":"viewpoint such as from front, from side, from behind, from above, from below, over the shoulder",',
  '"focus":"what the reader must see",',
  '"states":{"actor1":{"appearance":"complete comma-separated English tags for current hair, face, outfit","pose":"pose in this frame","held":"objects actually held now, comma-separated, or empty"}},',
  '"importance":"normal or main"}'
].join('')

const RULES = [
  'Each panel is ONE instant; never pack sequential actions into one panel.',
  'states covers every visible subject and always writes the COMPLETE current appearance, never "same as before". Clothing changes only when the story changes it; keep removals explicit.',
  'Choose camera by what the reader must see. Do not make every panel a face portrait. Adjacent panels must differ clearly in shot size or viewpoint (for example wide shot, then close-up of hands, then face close-up from below); never repeat the same composition.',
  'framing is a short danbooru-style shot tag (close-up, portrait, upper body, cowboy shot, full body, wide shot, hands focus); angle is a short tag (from side, from behind, from above, from below, dutch angle, pov).',
  'Keep established cast ids. Add no new person unless the task asks for one.',
  'Adults only. Every character is an adult.'
].join('\n')

const DIALOGUE: Record<MangaDialogueMode, string> = {
  auto: 'Decide per panel whether a line helps. Prefer silence for visual actions and emphasis. Empty dialogue_ko is valid.',
  with: 'Give each new panel exactly one short Korean line (dialogue_ko).',
  none: 'Every new panel is silent: dialogue_ko is an empty string. No captions or sound effects.'
}

const INTENT: Record<MangaIntent, string> = {
  story: 'Advance the story by a small, causally connected visible event.',
  dialogue: 'Develop the exchange or reaction; keep the physical situation coherent.',
  action:
    'Show the connecting physical action between established moments. Do not skip to a distant outcome.',
  emphasis:
    'Emphasize the last beat from a clearly different angle and framing, showing the tiny next phase of the same action. Do not replay it or add a new event.'
}

function str(v: unknown, max = 600): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function genderOf(prompt: string): 'girl' | 'boy' | 'auto' {
  const t = prompt.toLowerCase()
  if (/\b(1boy|boy|male|man)\b/.test(t) && !/\b(1girl|girl|female|woman)\b/.test(t)) return 'boy'
  if (/\b(1girl|girl|female|woman)\b/.test(t)) return 'girl'
  return 'auto'
}

export function castFromInput(list: MangaCastInput[]): MangaCastMember[] {
  return list.slice(0, 6).map((c, i) => ({
    id: 'actor' + (i + 1),
    name: c.name.trim() || '인물 ' + (i + 1),
    gender: c.gender === 'auto' ? genderOf(c.appearance) : c.gender,
    appearance: c.appearance.trim(),
    personality: c.personality.trim()
  }))
}

/** 글 모델이 준 컷 하나를 검사해 정리한다. 모르는 인물 id는 버린다 */
export function normalizePanel(
  raw: unknown,
  cast: MangaCastMember[],
  dialogue: MangaDialogueMode,
  prevStates: Record<string, MangaPanelState>
): MangaPanel {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = new Set(cast.map((c) => c.id))
  const byName = new Map(cast.map((c) => [c.name, c.id]))
  const fix = (v: unknown): string | null => {
    const s = str(v, 40)
    if (ids.has(s)) return s
    return byName.get(s) ?? null
  }
  const subjects = (Array.isArray(r.subjects) ? r.subjects : [])
    .map(fix)
    .filter((s): s is string => !!s)
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 2)
  const statesRaw = (r.states && typeof r.states === 'object' ? r.states : {}) as Record<
    string,
    unknown
  >
  const states: Record<string, MangaPanelState> = {}
  for (const id of subjects) {
    const s = (statesRaw[id] && typeof statesRaw[id] === 'object' ? statesRaw[id] : {}) as Record<
      string,
      unknown
    >
    const base = prevStates[id] ?? {
      appearance: cast.find((c) => c.id === id)?.appearance ?? '',
      pose: '',
      held: ''
    }
    const held = Array.isArray(s.held)
      ? s.held
          .map((h) => str(h, 60))
          .filter(Boolean)
          .join(', ')
      : str(s.held, 200)
    states[id] = {
      appearance: str(s.appearance, 900) || base.appearance,
      pose: str(s.pose, 200),
      held
    }
  }
  const speaker = fix(r.speaker)
  let dialogueKo = dialogue === 'none' ? '' : str(r.dialogue_ko ?? r.dialogue, 80)
  if (dialogueKo === '""') dialogueKo = ''
  const description = str(r.description, 500)
  if (!description)
    throw new TextModelError('컷 설명이 비어 있어요', JSON.stringify(raw).slice(0, 400))
  return {
    id: 'c' + randomUUID().slice(0, 8),
    subjects,
    speaker: dialogueKo ? (speaker ?? subjects[0] ?? null) : null,
    description,
    descriptionKo: str(r.description_ko, 300) || description,
    background: str(r.background, 300),
    dialogueKo: dialogueKo.replace(/^["“]|["”]$/g, ''),
    framing: str(r.framing, 60) || 'upper body',
    angle: str(r.angle, 60),
    focus: str(r.focus, 120),
    states,
    importance: r.importance === 'main' ? 'main' : 'normal'
  }
}

/** 마지막으로 보인 인물별 상태 (옷차림 이어가기용) */
export function activeStates(panels: MangaPanel[]): Record<string, MangaPanelState> {
  const out: Record<string, MangaPanelState> = {}
  for (const p of panels) for (const [id, s] of Object.entries(p.states)) out[id] = s
  return out
}

function castText(cast: MangaCastMember[]): string {
  return JSON.stringify(
    cast.map((c) => ({
      id: c.id,
      name: c.name,
      gender: c.gender,
      appearance: c.appearance,
      personality: c.personality
    }))
  )
}

function recentText(panels: MangaPanel[], n = 6): string {
  return JSON.stringify(
    panels.slice(-n).map((p) => ({
      subjects: p.subjects,
      description: p.description,
      dialogue_ko: p.dialogueKo,
      framing: p.framing,
      angle: p.angle,
      states: p.states
    }))
  )
}

function storySoFar(panels: MangaPanel[]): string {
  return panels
    .map(
      (p, i) => i + 1 + '. ' + p.descriptionKo + (p.dialogueKo ? ' 「' + p.dialogueKo + '」' : '')
    )
    .join('\n')
}

export function createTask(brief: MangaBrief, cast: MangaCastMember[]): string {
  const input = {
    idea: brief.seed,
    direction: brief.direction,
    place: brief.place,
    requested_action: brief.action,
    state_change: brief.stateChange
  }
  const castRule = cast.length
    ? 'Use exactly this cast (ids are fixed, appearance is authoritative): ' + castText(cast)
    : 'Plan the minimum cast (1 to 3 adults) with ids actor1, actor2... Invent concise English appearance tags.'
  return [
    'Create ONLY the first ' +
      brief.startCuts +
      ' panel(s) of a short comic inspired by this brief (it may be Korean). Do not outline or finish the story.',
    JSON.stringify(input),
    castRule,
    DIALOGUE[brief.dialogue],
    RULES,
    'Return JSON only:',
    '{"title_ko":"short Korean title","setting":"initial location in English","cast":[{"id":"actor1","name":"name","gender":"girl or boy","appearance":"English tags","personality":"short English"}],"panels":[' +
      PANEL_SCHEMA +
      '],"ended":false}'
  ].join('\n\n')
}

export function expandTask(
  project: MangaProject,
  req: { count: number; intent: MangaIntent; dialogue: MangaDialogueMode; instruction?: string }
): string {
  return [
    'You continue an incrementally written comic. Write ONLY the next ' + req.count + ' panel(s).',
    'Cast (fixed): ' + castText(project.cast),
    'Setting: ' +
      project.setting +
      (project.brief.direction ? ' / Direction: ' + project.brief.direction : ''),
    'Story so far (Korean summary):\n' + storySoFar(project.panels),
    'Most recent panels with exact current states:\n' + recentText(project.panels),
    INTENT[req.intent],
    req.instruction ? 'Editor request: ' + req.instruction : '',
    DIALOGUE[req.dialogue],
    RULES,
    'Return JSON only: {"panels":[' +
      PANEL_SCHEMA +
      '],"ended":false}. Set ended true only for an actual resolution.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function proposeTask(project: MangaProject): string {
  const per = project.brief.maxCuts
  const last = project.pages[project.pages.length - 1]
  const slots = last && last.state === 'draft' ? Math.max(0, per - last.panelIds.length) : per
  const ctx = {
    target_pages: project.brief.targetPages,
    pages_so_far: project.pages.length,
    panels_per_page: [project.brief.minCuts, project.brief.maxCuts],
    current_page_slots: slots || per,
    closing_required: project.pages.length >= project.brief.targetPages && slots <= 1,
    story_ko: storySoFar(project.panels),
    recent_panels: JSON.parse(recentText(project.panels, 4))
  }
  return [
    'You are the editor of an incrementally generated comic. First check whether the accepted panels already resolve the story goal; if so choose stop.',
    'Otherwise choose ONE next request for the writer: a new small event (story), a necessary physical connection (action), a reaction or exchange (dialogue), or a different angle on the tiny next phase of the last action (emphasis). Choose by what the reader is missing, never by rotation.',
    'Aim for about target_pages pages. When closing_required is true choose finish or stop. finish GENERATES the concluding panel(s); stop generates nothing and instruction must be empty.',
    'count is 1 or 2 and cannot exceed current_page_slots. Decide whether speech is needed (dialogue none/with/auto). Keep instruction concrete and in English; reason_ko is one short Korean sentence for the author.',
    'Context: ' + JSON.stringify(ctx),
    'Return JSON only: {"action":"expand|emphasis|finish|stop","count":1,"intent":"story|action|dialogue|emphasis","dialogue":"auto|with|none","instruction":"English","reason_ko":"Korean"}'
  ].join('\n\n')
}

export function normalizeProposal(raw: Record<string, unknown>): MangaProposal {
  const action =
    (['expand', 'emphasis', 'finish', 'stop'] as const).find((a) => a === raw.action) ?? 'expand'
  const intent =
    (['story', 'action', 'dialogue', 'emphasis'] as const).find((a) => a === raw.intent) ??
    (action === 'emphasis' ? 'emphasis' : 'story')
  const dialogue = (['auto', 'with', 'none'] as const).find((a) => a === raw.dialogue) ?? 'auto'
  const count = Math.max(1, Math.min(2, Math.round(Number(raw.count) || 1)))
  return {
    action,
    count,
    intent: action === 'emphasis' ? 'emphasis' : intent,
    dialogue,
    instruction: action === 'stop' ? '' : str(raw.instruction, 600),
    reasonKo: str(raw.reason_ko, 300)
  }
}

export async function writeStart(
  token: string,
  brief: MangaBrief,
  castIn: MangaCastInput[]
): Promise<{
  title: string
  setting: string
  cast: MangaCastMember[]
  panels: MangaPanel[]
  ended: boolean
}> {
  const given = castFromInput(castIn)
  const raw = parseJsonObject(await chat(token, 'xialong-v1', createTask(brief, given)))
  let cast = given
  if (!given.length) {
    const list = Array.isArray(raw.cast) ? raw.cast : []
    cast = list.slice(0, 4).map((c, i) => {
      const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
      const id = /^actor[1-9]$/.test(str(o.id)) ? str(o.id) : 'actor' + (i + 1)
      return {
        id,
        name: str(o.name, 40) || '인물 ' + (i + 1),
        gender: o.gender === 'boy' ? 'boy' : o.gender === 'girl' ? 'girl' : 'auto',
        appearance: str(o.appearance, 600),
        personality: str(o.personality, 300)
      }
    })
    if (!cast.length)
      throw new TextModelError('인물을 정하지 못했어요', JSON.stringify(raw).slice(0, 400))
  }
  const list = Array.isArray(raw.panels) ? raw.panels : []
  if (!list.length)
    throw new TextModelError('첫 컷을 받지 못했어요', JSON.stringify(raw).slice(0, 400))
  const panels: MangaPanel[] = []
  for (const p of list.slice(0, brief.startCuts))
    panels.push(normalizePanel(p, cast, brief.dialogue, activeStates(panels)))
  return {
    title: str(raw.title_ko, 40) || brief.seed.slice(0, 20),
    setting: str(raw.setting, 300) || brief.place,
    cast,
    panels,
    ended: raw.ended === true
  }
}

export async function writeNext(
  token: string,
  project: MangaProject,
  req: { count: number; intent: MangaIntent; dialogue: MangaDialogueMode; instruction?: string }
): Promise<{ panels: MangaPanel[]; ended: boolean }> {
  const raw = parseJsonObject(await chat(token, 'xialong-v1', expandTask(project, req)))
  const list = Array.isArray(raw.panels) ? raw.panels : []
  if (!list.length)
    throw new TextModelError('다음 컷을 받지 못했어요', JSON.stringify(raw).slice(0, 400))
  const panels: MangaPanel[] = []
  for (const p of list.slice(0, req.count))
    panels.push(
      normalizePanel(p, project.cast, req.dialogue, activeStates([...project.panels, ...panels]))
    )
  return { panels, ended: raw.ended === true }
}

export async function propose(token: string, project: MangaProject): Promise<MangaProposal> {
  return normalizeProposal(
    parseJsonObject(await chat(token, 'glm-4-6', proposeTask(project), { maxTokens: 1200 }))
  )
}
