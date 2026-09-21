import { safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import type { NaiAccountInfo } from '../../shared/types'
import { getDb } from './index'

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
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
const ACCOUNTS_KEY = 'nai_accounts_encrypted_v1'

export interface NaiAccountSecret {
  id: string
  name: string
  token: string
}

function encryptValue(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value).toString('base64')
}

function decryptValue(stored: string): string | null {
  const buf = Buffer.from(stored, 'base64')
  try {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return null
  }
}

function getLegacyNaiToken(): string | null {
  const stored = getSetting(TOKEN_KEY)
  if (!stored) return null
  return decryptValue(stored)
}

function readStoredAccounts(): NaiAccountSecret[] | null {
  const stored = getSetting(ACCOUNTS_KEY)
  if (stored === null) return null
  const raw = decryptValue(stored)
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Partial<NaiAccountSecret>
      const token = typeof row.token === 'string' ? row.token.trim() : ''
      if (!token) return []
      return [
        {
          id: typeof row.id === 'string' && row.id ? row.id : randomUUID(),
          name: typeof row.name === 'string' && row.name ? row.name : '',
          token
        }
      ]
    })
  } catch {
    return []
  }
}

function writeAccounts(accounts: NaiAccountSecret[]): void {
  const normalized = accounts.map((account, index) => ({
    ...account,
    name: `계정 ${index + 1}`,
    token: account.token.trim()
  }))
  setSetting(ACCOUNTS_KEY, encryptValue(JSON.stringify(normalized)))
  const primary = normalized[0]?.token
  if (primary) setSetting(TOKEN_KEY, encryptValue(primary))
  else getDb().prepare('DELETE FROM settings WHERE key = ?').run(TOKEN_KEY)
}

/**
 * NAI 토큰은 OS 키체인 기반 safeStorage로 암호화해 저장한다.
 * (NAIS2에서 "설정 파일 못 뜯어본다"는 불만이 있었지만 토큰만큼은 평문 금지)
 */
export function setNaiToken(token: string): void {
  const normalized = token.trim()
  const accounts = readStoredAccounts()
  if (accounts !== null) {
    if (accounts[0]) accounts[0] = { ...accounts[0], token: normalized }
    else accounts.push({ id: randomUUID(), name: '계정 1', token: normalized })
    writeAccounts(accounts)
    return
  }
  setSetting(TOKEN_KEY, encryptValue(normalized))
}

export function getNaiToken(): string | null {
  const accounts = readStoredAccounts()
  if (accounts !== null) return accounts[0]?.token ?? null
  return getLegacyNaiToken()
}

export function deleteNaiToken(): void {
  const db = getDb()
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(TOKEN_KEY, ACCOUNTS_KEY)
}

/** 마스킹 표시용 메타 (WHIMS 프로바이더 키 UI 패턴) */
export function getNaiTokenInfo(): { hasToken: boolean; prefix: string; length: number } {
  const token = getNaiToken()
  if (!token) return { hasToken: false, prefix: '', length: 0 }
  return { hasToken: true, prefix: token.slice(0, 4), length: token.length }
}

/** 구버전 단일 토큰은 쓰기 없이 계정 1로 투영한다. 두 번째 계정을 추가할 때만 새 배열로 이관한다. */
export function getNaiAccounts(): NaiAccountSecret[] {
  const stored = readStoredAccounts()
  if (stored !== null) return stored
  const token = getLegacyNaiToken()
  return token ? [{ id: 'legacy-primary', name: '계정 1', token }] : []
}

export function getNaiAccountInfos(): NaiAccountInfo[] {
  return getNaiAccounts().map((account, index) => ({
    id: account.id,
    name: `계정 ${index + 1}`,
    prefix: account.token.slice(0, 4),
    length: account.token.length
  }))
}

export function getNaiAccountToken(id: string): string | null {
  return getNaiAccounts().find((account) => account.id === id)?.token ?? null
}

export function addNaiAccount(token: string): { added: boolean; error?: string } {
  const normalized = token.trim()
  const accounts = getNaiAccounts()
  if (accounts.some((account) => account.token === normalized)) {
    return { added: false, error: '이미 등록된 토큰입니다' }
  }
  accounts.push({ id: randomUUID(), name: `계정 ${accounts.length + 1}`, token: normalized })
  writeAccounts(accounts)
  return { added: true }
}

export function deleteNaiAccount(id: string): boolean {
  const accounts = getNaiAccounts()
  const next = accounts.filter((account) => account.id !== id)
  if (next.length === accounts.length) return false
  writeAccounts(next)
  return true
}
