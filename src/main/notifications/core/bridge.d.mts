import type { InboxView } from '../../../shared/inbox'
export function startBridge(
  directory: string,
  port?: number
): Promise<{
  store: {
    view(): Promise<InboxView>
    control(enabled: boolean): Promise<{ enabled: boolean }>
    setInterval(
      minutes: number
    ): Promise<{ intervalMinutes: number; collecting: boolean; nextCollectionAt: string | null }>
  }
  port: number
  close(): Promise<void>
}>
