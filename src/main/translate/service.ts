// 댓글 번역. 키는 NAI 토큰처럼 OS 암호화로 저장하고, 화면에는 끝 6자리만 보낸다.
// 번역한 글과 결과는 어디에도 남기지 않는다.
import { HANGUL, TRANSLATE_MAX } from '../../shared/translate'
import type {
  TranslateResult,
  TranslateStatus,
  TranslateTarget,
  TranslateUsage
} from '../../shared/translate'
import { deleteDeeplKey, getDeeplKey, setDeeplKey } from '../db/settings'
import { DeepLError, deeplTranslate, deeplUsage, isFreeKey } from './deepl'

export const TRANSLATE_MESSAGES: Record<string, string> = {
  NO_KEY: 'DeepL API 키가 아직 없어요. 설정 > 번역에서 키를 넣어주세요.',
  AUTH: 'DeepL 인증에 실패했어요. 설정의 API 키를 확인해주세요.',
  QUOTA: '이번 달 DeepL 사용량 한도를 다 썼어요.',
  RATE: '요청이 잠깐 몰렸어요. 조금 뒤 다시 시도해주세요.',
  TOO_LONG: '글이 너무 길어요. 조금 나눠서 번역해주세요.',
  BAD_REQUEST: 'DeepL이 요청을 받지 않았어요. 글을 확인해주세요.',
  SERVER: 'DeepL 서버에 문제가 있어요. 잠시 뒤 다시 시도해주세요.',
  NETWORK: '네트워크에 연결할 수 없어요. 인터넷 연결을 확인해주세요.',
  TIMEOUT: 'DeepL 응답이 너무 늦어요. 다시 시도해주세요.',
  UNKNOWN: '알 수 없는 오류가 났어요. 다시 시도해주세요.'
}
export const translateMessage = (error: unknown): string =>
  TRANSLATE_MESSAGES[error instanceof DeepLError ? error.code : 'UNKNOWN'] ||
  TRANSLATE_MESSAGES.UNKNOWN

const TARGETS: TranslateTarget[] = ['KO', 'EN-US', 'ZH-HANT', 'JA']

export function translateStatus(): TranslateStatus {
  const key = getDeeplKey()
  return key
    ? { hasKey: true, tail: key.slice(-6), free: isFreeKey(key) }
    : { hasKey: false, tail: '', free: false }
}

export async function translateUsage(): Promise<TranslateUsage> {
  const key = getDeeplKey()
  if (!key) return { ok: false, used: null, limit: null, message: TRANSLATE_MESSAGES.NO_KEY }
  try {
    return { ok: true, ...(await deeplUsage(key)), message: '' }
  } catch (error) {
    return { ok: false, used: null, limit: null, message: translateMessage(error) }
  }
}

/** 키를 확인(사용량 조회)한 뒤 맞으면 저장한다. */
export async function saveTranslateKey(
  raw: string
): Promise<{ ok: boolean; message: string; usage?: TranslateUsage }> {
  const key = String(raw || '').trim()
  if (!key || key.length > 200 || /\s/.test(key))
    return { ok: false, message: 'DeepL API 키 모양이 아니에요. 다시 붙여넣어 주세요.' }
  try {
    const usage = await deeplUsage(key)
    setDeeplKey(key)
    return {
      ok: true,
      message: '키를 확인하고 저장했어요.',
      usage: { ok: true, ...usage, message: '' }
    }
  } catch (error) {
    return { ok: false, message: translateMessage(error) }
  }
}
export function removeTranslateKey(): { ok: true } {
  deleteDeeplKey()
  return { ok: true }
}

/** 읽기(KO)는 원문 언어를 DeepL이 알아내고, 쓰기는 한글이 있으면 한국어에서 옮긴다. */
export async function translateText(
  text: string,
  target: TranslateTarget
): Promise<TranslateResult> {
  const body = String(text || '').trim()
  const fail = (message: string): TranslateResult => ({
    ok: false,
    text: '',
    detected: null,
    message
  })
  if (!TARGETS.includes(target)) return fail(TRANSLATE_MESSAGES.BAD_REQUEST)
  if (!body) return fail('번역할 글이 없어요.')
  if (body.length > TRANSLATE_MAX) return fail(TRANSLATE_MESSAGES.TOO_LONG)
  const key = getDeeplKey()
  if (!key) return fail(TRANSLATE_MESSAGES.NO_KEY)
  try {
    const source = target !== 'KO' && HANGUL.test(body) ? 'KO' : null
    const result = await deeplTranslate(key, { text: body, target, source })
    return { ok: true, text: result.text, detected: result.detected, message: '' }
  } catch (error) {
    return fail(translateMessage(error))
  }
}
