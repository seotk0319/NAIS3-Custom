import { INBOX_EVENTS, INBOX_EVENT_GROUPS, INBOX_PLATFORMS } from '../../shared/inbox'
import { emptyCatalog, thumbnailFor, type PlatformImages, type WorkCatalog } from './work-images'
import { canReply } from './direct/replies'
import type {
  InboxView,
  InboxQuery,
  InboxResult,
  InboxItem,
  InboxPlatform,
  InboxEvent
} from '../../shared/inbox'

// Luna returns HTML-escaped text. Decode for display/search only; React still renders text.
export function decodeLunaText(value: string): string {
  const names: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value.replace(
    /&(?:#(x[\da-f]+|\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (entity, numeric: string | undefined, name: string | undefined) => {
      if (name) return names[name.toLowerCase()]
      const number = numeric?.toLowerCase().startsWith('x')
        ? parseInt(numeric.slice(1), 16)
        : Number(numeric)
      return Number.isInteger(number) &&
        number > 0 &&
        number <= 0x10ffff &&
        !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : entity
    }
  )
}

// Eden, Babe and Teapot deliver HTML inside notification text. Remove it for display
// and search only; the stored original keeps its markup. Block tags become line breaks
// so an admin notice stays readable instead of collapsing into one run of words.
const blockBreak = /<\/(?:p|div|tr|li|h[1-6]|blockquote)\s*>|<br\s*\/?>/gi
const cellBreak = /<\/(?:td|th)\s*>/gi
// A letter must follow "<", so prose like "a < b" is never mistaken for a tag.
const anyTag = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi
export function stripMarkup(value: string): string {
  return value
    .replace(blockBreak, '\n')
    .replace(cellBreak, ' ')
    .replace(anyTag, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
export function displayText(value: string): string {
  return decodeLunaText(stripMarkup(value))
}

export function canReplyTo(item: InboxItem): boolean {
  const raw = item as InboxItem & { commentId?: string | null }
  return canReply({
    platform: item.platform,
    sourceType: item.sourceType,
    event: item.event,
    title: item.title,
    body: item.body,
    at: item.at,
    actor: { name: item.actor?.name ?? null },
    work: { id: item.work?.id ?? null },
    commentId: raw.commentId ?? null,
    url: item.url
  })
}

export function queryInbox(
  view: InboxView,
  query: InboxQuery = {},
  now = Date.now(),
  catalog: WorkCatalog = emptyCatalog(),
  platformImages: PlatformImages = {}
): InboxResult {
  const events = Object.fromEntries(Object.keys(INBOX_EVENTS).map((k) => [k, 0])) as Record<
    InboxEvent,
    number
  >
  const counts = Object.fromEntries(Object.keys(INBOX_PLATFORMS).map((k) => [k, 0])) as Record<
    InboxPlatform,
    number
  >
  const search = String(query.search || '')
    .slice(0, 300)
    .trim()
    .toLocaleLowerCase()
  const displayItems = view.items.map((item) => {
    // Genit and Neko append the raw event name ("「작품」 comment", "이름 · follow");
    // the row already says 댓글, so drop the word and the dot that led into it.
    const heading =
      item.platform === 'genit' || item.platform === 'neko'
        ? item.title.replace(/(?:\s+·)?\s+(?:comment|reply|like|follow)$/i, '')
        : item.title
    const title = displayText(heading)
    let body = displayText(item.body),
      work = item.work
    // A Babe character like carries the character's name as its body and no work title.
    if (item.platform === 'babe' && item.event === 'like' && work?.id && !work.title && body) {
      work = { ...work, title: body }
      body = ''
    }
    // Reaction bodies such as 독자님이 "작품"을(를) 좋아합니다 only restate the actor and the
    // work the row already shows.
    const actor = item.actor?.name
    if (
      (INBOX_EVENT_GROUPS.reaction as readonly string[]).includes(item.event) &&
      actor &&
      body.includes(actor) &&
      (!work?.title || body.includes(work.title))
    )
      body = ''
    return title === item.title && body === item.body && work === item.work
      ? item
      : { ...item, title, body, work }
  })
  // An event filter is either one event or a named group of them.
  const group = Object.hasOwn(INBOX_EVENT_GROUPS, query.event || '')
    ? (INBOX_EVENT_GROUPS[query.event as keyof typeof INBOX_EVENT_GROUPS] as readonly string[])
    : null
  const eventMatches = (value: string): boolean =>
    !query.event || (group ? group.includes(value) : query.event === value)
  // A platform the person turned off keeps its stored rows but leaves the inbox.
  const shown = (item: InboxItem): boolean => view.selection?.[item.platform] !== false
  const filtered = displayItems.filter((item) => {
    if (Object.hasOwn(counts, item.platform)) counts[item.platform]++
    if (!shown(item)) return false
    const platformMatches = !query.platform || query.platform === item.platform
    if (platformMatches && Object.hasOwn(events, item.event)) events[item.event]++
    return (
      platformMatches &&
      eventMatches(item.event) &&
      (!query.unread || item.unread === true) &&
      (!search ||
        [item.title, item.body, item.actor?.name, item.work?.title, item.work?.id].some((v) =>
          v?.toLocaleLowerCase().includes(search)
        ))
    )
  })
  const unread = filtered.reduce((total, item) => total + (item.unread === true ? 1 : 0), 0)
  const pageSize = 80
  const requested = Number.isFinite(query.page) ? Math.max(0, Math.floor(query.page!)) : 0
  const page = Math.min(requested, Math.max(0, Math.ceil(filtered.length / pageSize) - 1))
  // Explicit projection: raw source records and pairing/auth data never cross IPC.
  const items: InboxItem[] = filtered.slice(page * pageSize, (page + 1) * pageSize).map((item) => ({
    id: item.id,
    platform: item.platform,
    event: item.event,
    sourceType: item.sourceType,
    title: item.title,
    body: item.body,
    actor: item.actor,
    work: item.work,
    at: item.at,
    unread: item.unread,
    url: item.url,
    thumbnail: thumbnailFor(item, catalog, platformImages),
    canReply: canReplyTo(item)
  }))
  return {
    available: true,
    intervalMinutes: view.intervalMinutes ?? 60,
    collecting: view.collecting ?? false,
    nextCollectionAt: view.nextCollectionAt ?? null,
    error: null,
    enabled: view.enabled,
    collectorOnline: !!view.collector && now - Date.parse(view.collector.lastSeen) < 120_000,
    collectorVersion: view.collector?.version || null,
    lastSeen: view.collector?.lastSeen || null,
    total: displayItems.filter(shown).length,
    filtered: filtered.length,
    unread,
    page,
    pageSize,
    items,
    events,
    platforms: (Object.entries(INBOX_PLATFORMS) as [InboxPlatform, string][]).map(
      ([id, label]) => ({
        id,
        label,
        count: counts[id],
        connected:
          (id === 'luna'
            ? !!view.platforms[id]?.lastSuccess
            : view.collector?.sessions?.[id]?.connected === true) &&
          ['ok', 'partial'].includes(view.platforms[id]?.status || ''),
        status: view.platforms[id]?.status || 'pending',
        detail: view.platforms[id]?.detail || null,
        lastSuccess: view.platforms[id]?.lastSuccess || null,
        lastAttempt: view.platforms[id]?.lastAttempt || null,
        lastNewAt: view.platforms[id]?.lastNewAt || null,
        // The collector reports the stored token's own expiry, never the token.
        expiresAt: view.collector?.sessions?.[id]?.expiresAt || null,
        canRenew: view.collector?.sessions?.[id]?.canRenew === true,
        selected: view.selection?.[id] !== false,
        // The service fills these from the in-app collector, which this pure view cannot see.
        appConnected: false,
        awaitingLogin: false,
        loginWindowOpen: false,
        connecting: false
      })
    ),
    directError: null,
    thumbnailsPending: false
  }
}

export function sourceUrl(item: InboxItem): string {
  if (!item.url) throw new Error('원문 주소가 없는 알림이에요.')
  const url = new URL(item.url)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('원문 주소를 열 수 없어요.')
  return url.href
}
