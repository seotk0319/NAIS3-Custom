// 댓글 번역(DeepL) 공용 정의. 본체와 화면이 함께 쓴다.

/** 읽을 때는 한국어로, 답글을 쓸 때는 이 셋 중 하나로 바꾼다. */
export type TranslateTarget = 'KO' | 'EN-US' | 'ZH-HANT' | 'JA'
export const WRITE_TARGETS: { id: Exclude<TranslateTarget, 'KO'>; label: string; name: string }[] =
  [
    { id: 'EN-US', label: 'English', name: '영어' },
    { id: 'ZH-HANT', label: '繁體中文', name: '중국어 번체' },
    { id: 'JA', label: '日本語', name: '일본어' }
  ]
export const TRANSLATE_MAX = 5000

export interface TranslateStatus {
  hasKey: boolean
  /** 키 끝 6자리 (나머지는 화면에 보내지 않는다) */
  tail: string
  /** 무료 API 키(:fx)인지 */
  free: boolean
}
export interface TranslateUsage {
  ok: boolean
  used: number | null
  limit: number | null
  message: string
}
export interface TranslateResult {
  ok: boolean
  text: string
  /** DeepL이 알아낸 원문 언어 (예: JA, EN) */
  detected: string | null
  message: string
}

export const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/
const SOURCE_LABELS: Record<string, string> = {
  KO: '한국어',
  EN: '영어',
  JA: '일본어',
  ZH: '중국어',
  DE: '독일어',
  FR: '프랑스어',
  ES: '스페인어',
  PT: '포르투갈어',
  IT: '이탈리아어',
  RU: '러시아어',
  ID: '인도네시아어',
  TR: '튀르키예어',
  UK: '우크라이나어',
  PL: '폴란드어',
  NL: '네덜란드어',
  VI: '베트남어',
  TH: '태국어',
  AR: '아랍어',
  SV: '스웨덴어',
  DA: '덴마크어',
  FI: '핀란드어',
  NB: '노르웨이어'
}
export function languageLabel(code: string | null | undefined): string {
  if (!code) return '자동 감지'
  const upper = String(code).toUpperCase()
  if (upper === 'ZH-HANT') return '중국어 번체'
  if (upper === 'ZH-HANS') return '중국어 간체'
  const base = upper.split('-')[0]
  return SOURCE_LABELS[base] || base
}

const KANA = /[\u3040-\u30FF]/g
const HAN = /[\u4E00-\u9FFF]/g
const LATIN = /[A-Za-z]/g
const HANGUL_ALL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/g
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0

/** 한국어로 읽어 볼 만한 글인지: 한글이 거의 없고 다른 글자가 있을 때. */
export function looksForeign(text: string): boolean {
  const hangul = count(text, HANGUL_ALL)
  const other = count(text, KANA) + count(text, HAN) + count(text, LATIN)
  return other >= 2 && hangul < other * 0.5
}

/** 댓글 글자로 짐작한 답글 언어. 가나가 있으면 일본어, 한자만 있으면 중국어, 로마자면 영어. */
export function guessReplyTarget(text: string): Exclude<TranslateTarget, 'KO'> | null {
  if (!looksForeign(text)) return null
  if (count(text, KANA) > 0) return 'JA'
  if (count(text, HAN) >= count(text, LATIN)) return 'ZH-HANT'
  return 'EN-US'
}
