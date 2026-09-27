/**
 * 페이지 한 장 그리기: 칸 선을 그린 빈 페이지 + 칸 안쪽 마스크 → V5 인페인팅 1장.
 * 컷마다 V5 캐릭터 프롬프트 하나를 칸의 면적 중심에 둔다. 끝나면 칸 밖을 흰 여백으로 정리하고 칸 선을 다시 긋는다.
 */
import sharp from 'sharp'
import type { CharacterPromptInput, GenerationRequest } from '../../shared/types'
import {
  MANGA_H,
  MANGA_W,
  pageLayout,
  polyCenter,
  type MangaPage,
  type MangaPanel,
  type MangaProject,
  type Poly
} from '../../shared/manga'
import { NAI_MODEL_V5_FULL, isV5Model } from '../../shared/nai-models'

const BORDER = 6
const PANEL_EXCLUSIONS = 'empty panel, inset panel, extra panels, merged panels, split panel'
const TEXT_EXCLUSIONS = 'text, speech bubble, caption, sound effects'

function pts(poly: Poly): string {
  return poly.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
}

function svg(body: string, bg = 'none'): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      MANGA_W +
      '" height="' +
      MANGA_H +
      '" viewBox="0 0 ' +
      MANGA_W +
      ' ' +
      MANGA_H +
      '">' +
      (bg === 'none' ? '' : '<rect width="100%" height="100%" fill="' + bg + '"/>') +
      body +
      '</svg>'
  )
}

/** 칸 선이 그려진 빈 페이지 (인페인팅 원본) */
export async function templatePng(polys: Poly[]): Promise<Buffer> {
  const body = polys
    .map(
      (p) =>
        '<polygon points="' +
        pts(p) +
        '" fill="#ececec" stroke="#000" stroke-width="' +
        BORDER +
        '" stroke-linejoin="round"/>'
    )
    .join('')
  return sharp(svg(body, '#ffffff')).png().toBuffer()
}

/** 칸 안쪽만 흰색인 마스크 (흰색 = 새로 그릴 곳) */
export async function maskPng(polys: Poly[]): Promise<Buffer> {
  const body = polys.map((p) => '<polygon points="' + pts(p) + '" fill="#ffffff"/>').join('')
  return sharp(svg(body, '#000000')).png().toBuffer()
}

/** 생성 결과에서 칸 안쪽만 남기고 칸 선을 다시 그어 완성 페이지를 만든다 */
export async function composePage(raw: Buffer, polys: Poly[]): Promise<Buffer> {
  const cut = svg(polys.map((p) => '<polygon points="' + pts(p) + '" fill="#ffffff"/>').join(''))
  const inside = await sharp(raw)
    .resize(MANGA_W, MANGA_H, { fit: 'fill' })
    .ensureAlpha()
    .composite([{ input: cut, blend: 'dest-in' }])
    .png()
    .toBuffer()
  const lines = svg(
    polys
      .map(
        (p) =>
          '<polygon points="' +
          pts(p) +
          '" fill="none" stroke="#000" stroke-width="' +
          BORDER +
          '" stroke-linejoin="round"/>'
      )
      .join('')
  )
  return sharp({ create: { width: MANGA_W, height: MANGA_H, channels: 4, background: '#ffffff' } })
    .composite([{ input: inside }, { input: lines }])
    .png()
    .toBuffer()
}

function who(project: MangaProject, panel: MangaPanel, id: string): string {
  const c = project.cast.find((m) => m.id === id)
  const s = panel.states[id]
  const gender = c && c.gender !== 'auto' ? c.gender : ''
  return [gender, s?.appearance || c?.appearance || ''].filter(Boolean).join(', ')
}

/** 컷 하나의 캐릭터 프롬프트 */
export function panelCaption(project: MangaProject, panel: MangaPanel, index: number): string {
  const parts: string[] = []
  // 구도가 칸마다 달라야 만화가 된다 — 거리·각도를 맨 앞에, 조금 세게
  const camera = [panel.framing, panel.angle]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
  if (camera) parts.push('1.35::' + camera + '::')
  if (panel.focus) parts.push('focus on ' + panel.focus)
  if (panel.subjects.length === 0) parts.push('no humans, scenery, objects only')
  else if (panel.subjects.length === 1) parts.push('solo', who(project, panel, panel.subjects[0]))
  else parts.push('2 people', ...panel.subjects.map((id) => who(project, panel, id)))
  parts.push(panel.background)
  for (const id of panel.subjects) {
    const s = panel.states[id]
    if (s?.pose) parts.push(s.pose)
    if (s?.held) parts.push('holding ' + s.held)
  }
  parts.push(panel.description, 'panel ' + (index + 1) + ', one continuous view inside this panel')
  if (panel.dialogueKo) parts.push('speech bubble', JSON.stringify(panel.dialogueKo))
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ')
}

export function pagePrompts(
  project: MangaProject,
  page: MangaPage
): { prompt: string; negative: string; characters: CharacterPromptInput[]; polys: Poly[] } {
  const panels = page.panelIds
    .map((id) => project.panels.find((p) => p.id === id))
    .filter((p): p is MangaPanel => !!p)
  const polys = pageLayout(page, project.panels)
  const silent = panels.every((p) => !p.dialogueKo)
  const n = panels.length
  const structure =
    n === 1
      ? 'single illustration, one continuous scene'
      : 'comic page, manga, ' +
        n +
        ' panels, each panel is a separate shot with its own camera distance and angle, varied composition, clear black panel borders, read left to right then top to bottom'
  const prompt = [project.style.prompt.trim(), structure, silent ? 'silent comic, wordless' : '']
    .filter(Boolean)
    .join(', ')
  const negative = [project.style.negative.trim(), PANEL_EXCLUSIONS, silent ? TEXT_EXCLUSIONS : '']
    .filter(Boolean)
    .join(', ')
  const characters = panels.map((panel, i) => {
    const c = polyCenter(polys[i])
    const neg = [
      panel.dialogueKo ? '' : TEXT_EXCLUSIONS,
      panel.subjects.length === 1 ? 'multiple people' : ''
    ]
      .filter(Boolean)
      .join(', ')
    return {
      prompt: panelCaption(project, panel, i),
      negativePrompt: neg,
      center: {
        x: Math.round((c[0] / MANGA_W) * 1000) / 1000,
        y: Math.round((c[1] / MANGA_H) * 1000) / 1000
      },
      enabled: true
    }
  })
  return { prompt, negative, characters, polys }
}

/** 대기열에 넣을 요청. base는 메인 탭의 생성 설정(스텝·CFG·샘플러 등) */
export async function buildPageRequest(
  project: MangaProject,
  page: MangaPage,
  base: GenerationRequest
): Promise<GenerationRequest> {
  const { prompt, negative, characters, polys } = pagePrompts(project, page)
  const [template, mask] = await Promise.all([templatePng(polys), maskPng(polys)])
  return {
    ...base,
    prompt,
    promptParts: undefined,
    negativePrompt: negative,
    model: isV5Model(base.model) ? base.model.replace(/-inpainting$/, '') : NAI_MODEL_V5_FULL,
    width: MANGA_W,
    height: MANGA_H,
    seed: page.seed,
    transparentBackground: false,
    characterPrompts: characters,
    useCoords: true,
    source: {
      imageBase64: template.toString('base64'),
      maskBase64: mask.toString('base64'),
      strength: 1,
      noise: 0
    },
    extraCharRefs: undefined,
    sceneId: undefined,
    arenaRenderId: undefined,
    skipWildcards: true
  }
}
