import { isV5Model } from '../../shared/nai-models'
import { getSetting, setSetting } from '../db/settings'

const USAGE_KEY = 'nai_daily_generation_usage_v1'

export interface DailyModelUsage {
  v45: number
  v5: number
}

interface StoredDailyUsage {
  date: string
  accounts: Record<string, DailyModelUsage>
}

function localDateKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function readToday(): StoredDailyUsage {
  const date = localDateKey()
  const raw = getSetting(USAGE_KEY)
  if (!raw) return { date, accounts: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDailyUsage>
    if (parsed.date !== date || !parsed.accounts || typeof parsed.accounts !== 'object') {
      return { date, accounts: {} }
    }
    const accounts: Record<string, DailyModelUsage> = {}
    for (const [id, value] of Object.entries(parsed.accounts)) {
      if (!value || typeof value !== 'object') continue
      const counts = value as Partial<DailyModelUsage>
      accounts[id] = { v45: safeCount(counts.v45), v5: safeCount(counts.v5) }
    }
    return { date, accounts }
  } catch {
    return { date, accounts: {} }
  }
}

/** 이미지가 실제 파일로 저장된 뒤에만 오늘 성공 장수를 1 올린다. 날짜 경계는 PC 현지 자정이다. */
export function logGeneratedImage(accountId: string, model: string): void {
  if (!accountId) return
  const usage = readToday()
  const counts = usage.accounts[accountId] ?? { v45: 0, v5: 0 }
  if (isV5Model(model)) counts.v5++
  else if (model.includes('nai-diffusion-4-5')) counts.v45++
  else return
  usage.accounts[accountId] = counts
  setSetting(USAGE_KEY, JSON.stringify(usage))
}

export function getTodayGenerationUsage(): StoredDailyUsage {
  return readToday()
}
