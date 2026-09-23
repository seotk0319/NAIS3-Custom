export const INBOX_PLATFORMS = {
  eden: '에덴',
  babe: '베이비챗',
  luna: '루나',
  elyn: '엘린',
  neko: '네코',
  teapot: '티팟',
  crack: '크랙',
  rplay: '알플레이',
  genit: '젠잇'
} as const
export const INBOX_EVENTS = {
  comment: '댓글',
  reply: '답글',
  like: '좋아요',
  follow: '팔로우',
  admin: '공지',
  other: '기타'
} as const
// Reactions outnumber conversation roughly three to one, so they get their own view
// instead of burying the comments a creator actually needs to answer.
export const INBOX_EVENT_GROUPS = {
  conversation: ['comment', 'reply', 'admin', 'other'],
  reaction: ['like', 'follow']
} as const
export type InboxEventGroup = keyof typeof INBOX_EVENT_GROUPS
export type InboxPlatform = keyof typeof INBOX_PLATFORMS
export type InboxEvent = keyof typeof INBOX_EVENTS
export interface InboxItem {
  id: string
  platform: InboxPlatform
  event: InboxEvent
  sourceType: string
  title: string
  body: string
  actor: { id: string | null; name: string | null }
  work: { id: string | null; title: string | null; url: string | null }
  at: string | null
  unread: boolean | null
  url: string | null
}
export interface InboxPlatformStatus {
  status?: string
  lastSuccess?: string | null
  detail?: string
}
export interface InboxView {
  intervalMinutes?: number
  collecting?: boolean
  nextCollectionAt?: string | null
  enabled: boolean
  mode: string
  collector: null | {
    lastSeen: string
    version: string
    running: boolean
    sessions?: Partial<
      Record<
        InboxPlatform,
        {
          connected: boolean
          expiresAt?: string | null
          canRenew?: boolean
        }
      >
    >
  }
  /** Platforms the person turned off; absent means on. */
  selection?: Partial<Record<InboxPlatform, boolean>>
  platforms: Partial<Record<InboxPlatform, InboxPlatformStatus>>
  items: InboxItem[]
}
export interface InboxQuery {
  platform?: string
  event?: string
  search?: string
  page?: number
  unread?: boolean
}
export interface InboxResult {
  intervalMinutes: number
  collecting: boolean
  nextCollectionAt: string | null
  available: boolean
  error: string | null
  enabled: boolean
  collectorOnline: boolean
  collectorVersion: string | null
  lastSeen: string | null
  total: number
  filtered: number
  unread: number
  page: number
  pageSize: number
  items: InboxItem[]
  platforms: {
    id: InboxPlatform
    label: string
    count: number
    connected: boolean
    status: string
    detail: string | null
    lastSuccess: string | null
    expiresAt: string | null
    canRenew: boolean
    selected: boolean
    /** NAIS3 holds a signed-in session for this platform. */
    appConnected: boolean
    /** A sign-in window is open and waiting for the person to finish. */
    awaitingLogin: boolean
    /** That sign-in window is still open, so finishing sign-in connects by itself. */
    loginWindowOpen: boolean
    connecting: boolean
  }[]
  events: Record<InboxEvent, number>
  /** Why the in-app collector could not open its session store, if it could not. */
  directError: string | null
}
export interface InboxConnectResult {
  state: 'connected' | 'login-required' | 'error'
  message: string
}
