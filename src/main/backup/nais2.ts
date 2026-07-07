import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { createPromptPreset } from '../prompts/repo'

export interface Nais2ImportResult {
  characters: number
  presets: number
  fragments: number
  prompt: boolean
}

/**
 * NAIS2 백업 JSON → NAIS3 가져오기 (텍스트 데이터만: 캐릭터·프롬프트 프리셋·조각).
 * 바이브/캐릭레퍼/라이브러리 이미지는 NAIS2 백업 JSON에 원본 base64가 비어 있어(파일 경로만) 제외.
 * 기존 NAIS3 데이터는 지우지 않고 추가(merge)한다.
 */

type Obj = Record<string, unknown>

function state(data: Obj, key: string): Obj {
  const wrap = data[key] as Obj | undefined
  return (wrap?.state ?? {}) as Obj
}
function removeComments(s: string): string {
  return s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
}

/** base+additional+detail를 NAIS2 규칙(주석 제거, ', ' 결합)으로 합친다 */
function mergePrompt(base: unknown, add: unknown, detail: unknown): string {
  return [base, add, detail]
    .map((x) => removeComments(String(x ?? '')).trim())
    .filter(Boolean)
    .join(', ')
}

export function importNais2(data: Obj): Nais2ImportResult {
  const db = getDb()
  const res: Nais2ImportResult = { characters: 0, presets: 0, fragments: 0, prompt: false }

  const tx = db.transaction(() => {
    // 1. 캐릭터 — 가져올 항목이 있으면 기존 캐릭터를 비우고 교체 (바이브/캐릭레퍼는 건드리지 않음)
    const chs = state(data, 'nais2-character-prompts')
    const rawChars = (Array.isArray(chs.characters) && chs.characters.length
      ? chs.characters
      : chs.presets) as Obj[] | undefined
    const chars = (rawChars ?? [])
      .map((c) => ({
        name: String(c.name ?? ''),
        prompt: String(c.prompt ?? ''),
        negative: String(c.negative ?? '')
      }))
      .filter((c) => c.prompt || c.negative || c.name)
    if (chars.length) {
      db.prepare('DELETE FROM character_prompts').run()
      chars.forEach((c, i) => {
        db.prepare(
          'INSERT INTO character_prompts (name, prompt, negative_prompt, sort_order) VALUES (?, ?, ?, ?)'
        ).run(c.name, c.prompt, c.negative, i)
        res.characters++
      })
    }

    // 2. 프롬프트 프리셋 — '기본'(default) 포함(내용 있는 경우 많음). 빈 것만 제외.
    const ps = state(data, 'nais2-presets')
    const presets = (Array.isArray(ps.presets) ? (ps.presets as Obj[]) : [])
      .map((p) => ({
        name: String(p.name ?? '가져온 프리셋'),
        prompt: mergePrompt(p.basePrompt, p.additionalPrompt, p.detailPrompt),
        negative: removeComments(String(p.negativePrompt ?? '')).trim()
      }))
      .filter((p) => p.prompt || p.negative)
    if (presets.length) {
      db.prepare('DELETE FROM prompt_presets').run()
      for (const p of presets) {
        createPromptPreset(p.name, p.prompt, p.negative)
        res.presets++
      }
    }

    // 3. 조각 — 메타(nais2-wildcards.files) + 내용(nais2-wildcard-content[id])
    const wc = state(data, 'nais2-wildcards')
    const contentMap = (data['nais2-wildcard-content'] ?? {}) as Record<string, unknown>
    const frags = (Array.isArray(wc.files) ? (wc.files as Obj[]) : [])
      .map((f) => {
        const lines = (Array.isArray(contentMap[String(f.id)])
          ? contentMap[String(f.id)]
          : Array.isArray(f.content)
            ? f.content
            : []) as unknown[]
        return {
          name: String(f.name ?? '').trim(),
          content: lines.map((l) => String(l)).join('\n'),
          folder: f.folder ? String(f.folder) : null
        }
      })
      .filter((f) => f.name)
    if (frags.length) {
      db.prepare('DELETE FROM fragments').run()
      frags.forEach((f, i) => {
        const info = db
          .prepare(
            'INSERT OR IGNORE INTO fragments (name, content, folder, sort_order) VALUES (?, ?, ?, ?)'
          )
          .run(f.name, f.content, f.folder, i)
        if (info.changes) res.fragments++
      })
    }

    // 4. 현재 메인 프롬프트 (nais2-generation) → NAIS3 main_params에 병합
    const gen = state(data, 'nais2-generation')
    const prompt = mergePrompt(gen.basePrompt, gen.additionalPrompt, gen.detailPrompt)
    const negative = removeComments(String(gen.negativePrompt ?? '')).trim()
    if (prompt || negative) {
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(getSetting('main_params') || '{}')
      } catch {
        params = {}
      }
      params.prompt = prompt
      params.negativePrompt = negative
      setSetting('main_params', JSON.stringify(params))
      res.prompt = true
    }
  })
  tx()
  return res
}
