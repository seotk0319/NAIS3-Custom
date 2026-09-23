import type { InboxView } from '../../../shared/inbox'

export const platformIds: string[]
export interface InboxStore {
  view(): Promise<InboxView>
  control(enabled: boolean): Promise<{ enabled: boolean }>
  setInterval(
    minutes: number
  ): Promise<{ intervalMinutes: number; collecting: boolean; nextCollectionAt: string | null }>
  heartbeat(detail: {
    version: string
    running: boolean
    sessions: Record<string, unknown>
  }): Promise<{ enabled: boolean; selection: Partial<Record<string, boolean>> }>
  select(
    platform: string,
    selected: boolean
  ): Promise<{ selection: Partial<Record<string, boolean>> }>
  ingest(batch: Record<string, unknown>): Promise<{ accepted: number; added: number }>
}
export function createStore(directory: string): Promise<InboxStore>
export function cleanItem(item: unknown, platform: string): Record<string, unknown>
export function cleanSessions(sessions: unknown): Record<string, Record<string, unknown>>
