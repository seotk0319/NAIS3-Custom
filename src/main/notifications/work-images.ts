// 작품 썸네일은 1:1 규격인 베이비챗 작품 이미지를 기준으로 쓴다.
// 베이비챗 알림은 작품 번호로, 다른 플랫폼 알림은 작품 제목으로 베이비챗 작품과 잇는다.
// 이미지 주소는 로그인한 계정의 베이비챗 응답에서만 온다. 저장소 주소를 코드에 박지 않고,
// 응답에 나온 호스트만 기억해 두었다가 nais-thumb 프로토콜이 그 호스트의 이미지만 대신 받아 준다.
import type { InboxItem } from '../../shared/inbox'

export interface WorkCatalog {
  fetchedAt: string
  /** 베이비챗 작품 번호 → 이미지 */
  byId: Record<string, string>
  /** 정규화한 작품 제목 → 이미지 */
  byName: Record<string, string>
}

export const emptyCatalog = (): WorkCatalog => ({ fetchedAt: '', byId: {}, byName: {} })

/** 베이비챗 응답에서 본 이미지 호스트. 썸네일 프로토콜은 이 호스트만 받는다. */
const imageHosts = new Set<string>()
export function thumbAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && imageHosts.has(u.host)
  } catch {
    return false
  }
}
export const THUMB_SCHEME = 'nais-thumb'

/** 파일 머리 바이트로 이미지 형식을 판단한다. 이미지가 아니면 null. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number, ...values: number[]): boolean => values.every((v, k) => bytes[i + k] === v)
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif'
  return null
}
export const thumbUrl = (image: string): string =>
  `${THUMB_SCHEME}://img/?u=${encodeURIComponent(image)}`

/** 띄어쓰기·문장부호·기호를 빼고 비교한다 (「Re: 제목」, 「제목!」 같은 차이 흡수). */
export function normTitle(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export function safeImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    imageHosts.add(u.host)
    return u.href
  } catch {
    return null
  }
}

export function catalogFrom(list: unknown, now = new Date()): WorkCatalog {
  const catalog = { ...emptyCatalog(), fetchedAt: now.toISOString() }
  if (!Array.isArray(list)) return catalog
  for (const row of list as Record<string, unknown>[]) {
    const image = safeImage(row?.mainImage) || safeImage(row?.profileImageUrl)
    if (!image) continue
    const id = typeof row.id === 'string' ? row.id : null
    if (id) catalog.byId[id] = image
    const name = normTitle(typeof row.name === 'string' ? row.name : '')
    if (name && !catalog.byName[name]) catalog.byName[name] = image
  }
  return catalog
}

/** 저장된 기준표를 다시 읽을 때 이미지 호스트도 다시 기억한다. */
export function rememberCatalog(catalog: WorkCatalog): void {
  for (const image of [...Object.values(catalog.byId), ...Object.values(catalog.byName)]) safeImage(image)
}

/** 알림이 가리키는 작품 제목. work.title이 없으면 제목의 「」 안을 쓴다. */
export function workTitleOf(item: Pick<InboxItem, 'title' | 'work'>): string | null {
  if (item.work?.title) return item.work.title
  const title = item.title || ''
  // 「작품」 (젠잇·네코·알플레이), '작품' (티팟·루나)
  const quoted = /「(.+?)」/.exec(title) || /^'(.+?)'/.exec(title)
  return quoted ? quoted[1] : null
}

/** 베이비챗 이미지 원본 주소. 없으면 null. */
export function workImageFor(item: InboxItem, catalog: WorkCatalog): string | null {
  if (item.platform === 'babe') {
    const byId = item.work?.id ? catalog.byId[item.work.id] : undefined
    if (byId) return byId
    const raw = (item as InboxItem & { sourceData?: { characterImageUrl?: unknown } }).sourceData
    return safeImage(raw?.characterImageUrl)
  }
  const raw = workTitleOf(item)
  const key = normTitle(raw)
  if (!key) return null
  if (catalog.byName[key]) return catalog.byName[key]
  // 루나는 긴 제목을 "…"로 잘라 보낸다. 잘린 제목은 앞부분이 같은 작품 하나로 잇는다.
  if (/(\.\.\.|…)$/.test(raw || '') && key.length >= 4) {
    const hits = Object.entries(catalog.byName).filter(([name]) => name.startsWith(key))
    if (hits.length === 1) return hits[0][1]
  }
  // 긴 제목끼리만 포함 관계를 인정한다 (짧은 제목의 오탐 방지).
  if (key.length < 6) return null
  for (const [name, image] of Object.entries(catalog.byName))
    if (name.length >= 6 && (key.includes(name) || name.includes(key))) return image
  return null
}

/** 플랫폼 작품 이미지 캐시 (platform:workId → 주소, 없음은 null). */
export type PlatformImages = Record<string, string | null>
export const platformKey = (platform: string, workId: string): string => `${platform}:${workId}`

/** 이미지 고르는 순서: 베이비챗 작품 이미지 → 그 플랫폼 작품 이미지 → 없음(화면이 첫 글자로 채움). */
export function chooseImage(item: InboxItem, catalog: WorkCatalog, platformImages: PlatformImages = {}): string | null {
  const babe = workImageFor(item, catalog)
  if (babe) return babe
  if (item.platform === 'teapot') {
    const raw = (item as InboxItem & { sourceData?: { thumb_url?: unknown } }).sourceData
    const thumb = safeImage(raw?.thumb_url)
    if (thumb) return thumb
  }
  const id = item.work?.id
  return id ? (platformImages[platformKey(item.platform, id)] ?? null) : null
}

/** 렌더러에 넘길 썸네일 주소 (nais-thumb 프로토콜). */
export function thumbnailFor(item: InboxItem, catalog: WorkCatalog, platformImages: PlatformImages = {}): string | null {
  const image = chooseImage(item, catalog, platformImages)
  return image ? thumbUrl(image) : null
}

/** 베이비챗 이미지가 없어서 플랫폼 이미지를 읽어야 하는 작품 (중복 제거). */
export function worksNeedingImage(items: InboxItem[], catalog: WorkCatalog): { platform: string; workId: string }[] {
  const seen = new Map<string, { platform: string; workId: string }>()
  for (const item of items) {
    const id = item.work?.id
    if (!id || item.platform === 'babe' || item.platform === 'teapot' || item.platform === 'luna') continue
    const key = platformKey(item.platform, id)
    if (seen.has(key) || workImageFor(item, catalog)) continue
    seen.set(key, { platform: item.platform, workId: id })
  }
  return [...seen.values()]
}

/** 작품 제목은 있는데 기준표에 없는 알림 — 새 작품일 수 있어 기준표를 일찍 새로 받는다. */
export function hasUnknownWork(items: InboxItem[], catalog: WorkCatalog): boolean {
  return items.some((item) => {
    if (item.platform === 'babe') return !!item.work?.id && !catalog.byId[item.work.id]
    return !!workTitleOf(item) && !workImageFor(item, catalog)
  })
}
