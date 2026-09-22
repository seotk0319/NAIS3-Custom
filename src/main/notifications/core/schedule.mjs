export const POLL_INTERVALS = [5, 15, 30, 60, 120, 360, 1440]
export function validateInterval(minutes) {
  if (!POLL_INTERVALS.includes(minutes)) throw new Error('Unsupported collection interval')
  return minutes
}
export function initializeSchedule(state) {
  if (state.schedule && POLL_INTERVALS.includes(state.schedule.intervalMinutes))
    return state.schedule
  const attempts = Object.values(state.platforms || {})
    .map((p) => Date.parse(p.lastAttempt || ''))
    .filter(Number.isFinite)
  return {
    intervalMinutes: 60,
    lastStartedAt: attempts.length ? Math.max(...attempts) : null,
    pending: []
  }
}
export function scheduleView(schedule, enabled, now = Date.now()) {
  const next =
    schedule.lastStartedAt === null
      ? now
      : schedule.lastStartedAt + schedule.intervalMinutes * 60_000
  const collecting =
    enabled &&
    schedule.pending.length > 0 &&
    now < schedule.lastStartedAt + Math.min(10, schedule.intervalMinutes) * 60_000
  return {
    intervalMinutes: schedule.intervalMinutes,
    collecting,
    nextCollectionAt: enabled ? new Date(next).toISOString() : null
  }
}
export function advanceSchedule(schedule, enabled, platforms, now = Date.now()) {
  if (!enabled) return { schedule, allowed: false }
  const view = scheduleView(schedule, enabled, now)
  if (view.collecting) return { schedule, allowed: true }
  if (now < Date.parse(view.nextCollectionAt))
    return { schedule: { ...schedule, pending: [] }, allowed: false }
  return { schedule: { ...schedule, lastStartedAt: now, pending: [...platforms] }, allowed: true }
}
