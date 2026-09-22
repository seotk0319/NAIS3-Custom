export interface Schedule {
  intervalMinutes: number
  lastStartedAt: number | null
  pending: string[]
}
export const POLL_INTERVALS: number[]
export function validateInterval(minutes: number): number
export function initializeSchedule(state: {
  schedule?: Schedule
  platforms?: Record<string, { lastAttempt?: string }>
}): Schedule
export function scheduleView(
  schedule: Schedule,
  enabled: boolean,
  now?: number
): { intervalMinutes: number; collecting: boolean; nextCollectionAt: string | null }
export function advanceSchedule(
  schedule: Schedule,
  enabled: boolean,
  platforms: string[],
  now?: number
): { schedule: Schedule; allowed: boolean }
