// 플랫폼별 작품 대표 이미지. 로그인한 계정으로 작품 정보를 읽어 이미지 주소만 꺼낸다.
// 주소와 필드는 2026-09-24에 각 플랫폼 응답으로 확인했다. 원본 비율:
// 에덴·크랙 2:3, 젠잇 3:4, 알플레이 4:5, 나머지 1:1 (화면에서 한 틀에 위쪽 기준으로 자른다).

export type ImageRead = (url: string) => Promise<Response>

interface ImageRoute {
  /** 작품 번호가 이 플랫폼 모양인지 */
  id: RegExp
  /** 읽을 주소. null이면 요청 없이 build로 바로 만든다. */
  url: ((id: string) => string) | null
  pick(body: unknown, id: string): unknown
}

const get = (value: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key as string] : undefined), value)

export const IMAGE_ROUTES: Record<string, ImageRoute> = {
  eden: {
    id: /^[0-9a-f-]{36}$/i,
    url: (id) => `https://jhbfalszdxacwjnrrvms.supabase.co/rest/v1/works?id=eq.${id}&select=cover_image_url`,
    pick: (b) => get(b, 0, 'cover_image_url')
  },
  genit: {
    id: /^[0-9a-f-]{36}$/i,
    url: (id) => `https://api.genit.ai/api/characters/${id}/`,
    pick: (b) => get(b, 'profile_images', 0, 'url')
  },
  crack: {
    id: /^[a-f0-9]{24}$/,
    url: (id) => `https://crack-api.wrtn.ai/crack-api/stories/${id}`,
    pick: (b) => get(b, 'data', 'portraitImage', 'w600') || get(b, 'data', 'portraitImage', 'origin')
  },
  elyn: {
    id: /^[0-9a-f-]{36}$/i,
    url: (id) => `https://api.seoul.elyn.ai/api/v1/characters/${id}?minimal=true`,
    pick: (b) => get(b, 'characters', 0, 'imageUrl')
  },
  neko: {
    id: /^char_[a-z0-9_]+$/i,
    url: (id) => `https://www.nekochat.xyz/api/characters/${id}`,
    pick: (b) => get(b, 'character', 'avatar', 'url')
  },
  rplay: {
    // 알플레이는 작품 번호로 만든 공개 썸네일 주소가 곧 대표 이미지다.
    id: /^[a-f0-9]{24}$/,
    url: null,
    pick: (_b, id) => `https://pb3.rplay.live/thumbnail/${id}`
  }
}

export function imageReadAllowed(platform: string, url: string): boolean {
  const route = IMAGE_ROUTES[platform]
  if (!route?.url) return false
  try {
    const u = new URL(url)
    const expected = new URL(route.url('x'))
    return u.origin === expected.origin && !u.username && !u.password
  } catch {
    return false
  }
}

/** 작품 대표 이미지 주소. 없거나 읽지 못하면 null (로그인 만료는 예외로 올린다). */
export async function readWorkImage(platform: string, workId: string, read: ImageRead): Promise<string | null> {
  const route = IMAGE_ROUTES[platform]
  if (!route || !route.id.test(workId)) return null
  let body: unknown = null
  if (route.url) {
    const response = await read(route.url(encodeURIComponent(workId)))
    if (response.status === 401 || response.status === 403) throw new Error('LOGIN_REQUIRED')
    if (!response.ok) return null
    body = await response.json().catch(() => null)
  }
  const value = route.pick(body, workId)
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch {
    return null
  }
}
