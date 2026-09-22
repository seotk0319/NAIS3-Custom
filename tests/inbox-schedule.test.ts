import { describe, expect, it } from 'vitest'
import {
  initializeSchedule,
  scheduleView,
  advanceSchedule,
  validateInterval
} from '../src/main/notifications/core/schedule.mjs'

const sites = ['eden', 'babe', 'luna', 'elyn', 'neko', 'teapot', 'crack', 'rplay', 'genit']
describe('collection scheduling with the existing 0.3.4 collector', () => {
  it('defaults existing stores to an hour after their latest attempt', () => {
    const now = Date.parse('2026-09-22T06:00:00Z')
    const schedule = initializeSchedule({
      platforms: { eden: { lastAttempt: new Date(now).toISOString() } }
    })
    expect(schedule.intervalMinutes).toBe(60)
    expect(advanceSchedule(schedule, true, sites, now + 59 * 60_000).allowed).toBe(false)
    expect(advanceSchedule(schedule, true, sites, now + 60 * 60_000).allowed).toBe(true)
    expect(scheduleView(schedule, true, now).nextCollectionAt).toBe('2026-09-22T07:00:00.000Z')
  })
  it('allows one staggered pass across all sites then denies external polling until the next hour', () => {
    let schedule = initializeSchedule({})
    const lastRun: Record<string, number> = {}
    const counts: Record<string, number> = {}
    const start = Date.parse('2026-09-22T06:00:00Z')
    // Same due selection and 30-second heartbeat cadence as the installed worker.
    for (let now = start; now < start + 60 * 60_000; now += 30_000) {
      const gate = advanceSchedule(schedule, true, sites, now)
      schedule = gate.schedule
      if (!gate.allowed) continue
      const due = sites.filter((p) => now - (lastRun[p] || 0) >= 300_000).slice(0, 2)
      for (const p of due) {
        lastRun[p] = now
        counts[p] = (counts[p] || 0) + 1
        schedule.pending = schedule.pending.filter((x) => x !== p)
      }
    }
    expect(counts).toEqual(Object.fromEntries(sites.map((p) => [p, 1])))
    expect(advanceSchedule(schedule, true, sites, start + 60 * 60_000).allowed).toBe(true)
  })
  it('preserves the saved interval after restart, supports shortening, and pauses without changing the setting', () => {
    const now = Date.parse('2026-09-22T06:00:00Z')
    const saved = { intervalMinutes: 120, lastStartedAt: now, pending: [] }
    expect(initializeSchedule({ schedule: saved })).toEqual(saved)
    expect(advanceSchedule(saved, false, sites, now + 3 * 60 * 60_000).allowed).toBe(false)
    expect(scheduleView(saved, false, now).nextCollectionAt).toBeNull()
    expect(
      advanceSchedule({ ...saved, intervalMinutes: 15 }, true, sites, now + 15 * 60_000).allowed
    ).toBe(true)
  })
  it('bounds an incomplete pass instead of polling every five minutes indefinitely', () => {
    const start = Date.parse('2026-09-22T06:00:00Z')
    const { schedule } = advanceSchedule(initializeSchedule({}), true, sites, start)
    expect(advanceSchedule(schedule, true, sites, start + 10 * 60_000).allowed).toBe(false)
    expect(advanceSchedule(schedule, true, sites, start + 60 * 60_000).allowed).toBe(true)
  })
  it('rejects malformed or unsupported durations', () => {
    for (const value of [0, -1, NaN, Infinity, 1, 61, 100000])
      expect(() => validateInterval(value)).toThrow()
    expect(validateInterval(1440)).toBe(1440)
  })
})
