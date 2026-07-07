import { safeStorage } from 'electron'
import { getDb } from './index'

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

const TOKEN_KEY = 'nai_token_encrypted'

/**
 * NAI 토큰은 OS 키체인 기반 safeStorage로 암호화해 저장한다.
 * (NAIS2에서 "설정 파일 못 뜯어본다"는 불만이 있었지만 토큰만큼은 평문 금지)
 */
export function setNaiToken(token: string): void {
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token.trim()).toString('base64')
    : Buffer.from(token.trim()).toString('base64')
  setSetting(TOKEN_KEY, encrypted)
}

export function getNaiToken(): string | null {
  const stored = getSetting(TOKEN_KEY)
  if (!stored) return null
  const buf = Buffer.from(stored, 'base64')
  try {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return null
  }
}

export function deleteNaiToken(): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(TOKEN_KEY)
}

/** 마스킹 표시용 메타 (WHIMS 프로바이더 키 UI 패턴) */
export function getNaiTokenInfo(): { hasToken: boolean; prefix: string; length: number } {
  const token = getNaiToken()
  if (!token) return { hasToken: false, prefix: '', length: 0 }
  return { hasToken: true, prefix: token.slice(0, 4), length: token.length }
}
