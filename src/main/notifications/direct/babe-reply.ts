// 베이비챗 작품 댓글에 답글을 단다. 알림에는 댓글 번호가 없어서, 작품 댓글 목록에서
// 같은 작성자·같은 내용의 댓글을 찾아 그 번호로 답글을 올린다.
// 주소는 babechat.ai 웹 코드에서 확인했다 (2026-09-24): 목록 GET /api/comments?characterId=,
// 답글 POST /api/comments/{id}/replies {commentId, content}, 답글 목록 GET .../replies.

export const BABE_COMMENTS = 'https://api.babechatapi.com/ko/api/comments'
export const BABE_REPLYABLE = new Set(['characterComment', 'characterDonationComment'])
export const REPLY_MAX = 1000

export interface ReplyTarget {
  characterId: string
  author: string | null
  body: string
  at: string | null
  content: string
}
export type ReplySend = (url: string, init: { method: 'GET' | 'POST'; body?: string }) => Promise<Response>

interface BabeComment {
  id: number | string
  nickname?: string | null
  content?: string | null
  isCreator?: boolean
  createdAt?: string | null
}

export class ReplyError extends Error {
  constructor(
    public code: string,
    public status?: number
  ) {
    super(status ? `${code}:${status}` : code)
    this.name = 'ReplyError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim()

/** 알림 한 건이 가리키는 댓글인지. 내용이 같고, 작성자를 알면 작성자도 같아야 한다. */
export function sameComment(comment: BabeComment, target: Pick<ReplyTarget, 'author' | 'body'>): boolean {
  const body = norm(target.body)
  if (!body) return false
  if (target.author && norm(comment.nickname) && norm(comment.nickname) !== norm(target.author))
    return false
  const content = norm(comment.content)
  // 알림 본문이 잘려 오는 경우를 위해, 충분히 긴 본문은 앞부분 일치도 인정한다.
  return content === body || (body.length >= 20 && content.startsWith(body))
}

async function readJson(response: Response, stage: string): Promise<unknown> {
  if (response.status === 401 || response.status === 403) throw new ReplyError('LOGIN_REQUIRED', response.status)
  if (!response.ok) throw new ReplyError(stage, response.status)
  return response.json()
}

export async function findBabeComment(
  send: ReplySend,
  target: ReplyTarget,
  { pageSize = 20, maxPages = 25 } = {}
): Promise<BabeComment> {
  if (!UUID.test(target.characterId)) throw new ReplyError('BAD_TARGET')
  // 알림보다 하루 이상 앞선 댓글까지 내려가면 더 볼 필요가 없다 (최신순 목록).
  const floor = target.at ? Date.parse(target.at) - 86_400_000 : null
  for (let page = 0; page < maxPages; page++) {
    const url = `${BABE_COMMENTS}?characterId=${target.characterId}&sort=latest&limit=${pageSize}&offset=${page * pageSize}`
    const rows = (await readJson(await send(url, { method: 'GET' }), 'LIST_FAILED')) as BabeComment[]
    if (!Array.isArray(rows)) throw new ReplyError('LIST_FAILED')
    const hit = rows.find((c) => sameComment(c, target))
    if (hit) return hit
    const oldest = rows.at(-1)?.createdAt
    if (rows.length < pageSize || (floor !== null && oldest && Date.parse(oldest) < floor)) break
  }
  throw new ReplyError('COMMENT_NOT_FOUND')
}

export async function replyBabe(
  send: ReplySend,
  target: ReplyTarget
): Promise<{ commentId: string; replyId: string | null }> {
  const content = target.content.trim()
  if (!content || content.length > REPLY_MAX) throw new ReplyError('BAD_CONTENT')
  const comment = await findBabeComment(send, target)
  const id = String(comment.id)
  const posted = await send(`${BABE_COMMENTS}/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ commentId: id, content })
  })
  await readJson(posted, 'POST_FAILED')
  // 응답에 새 답글 번호가 없어서, 답글 목록에서 방금 단 내 답글을 찾아 둔다.
  let replyId: string | null = null
  try {
    const replies = (await readJson(
      await send(`${BABE_COMMENTS}/${id}/replies?limit=500`, { method: 'GET' }),
      'REPLIES_FAILED'
    )) as BabeComment[]
    const mine = Array.isArray(replies)
      ? replies.filter((r) => r.isCreator && norm(r.content) === norm(content)).at(-1)
      : undefined
    replyId = mine ? String(mine.id) : null
  } catch {
    // 답글은 이미 올라갔다. 번호 확인 실패는 결과를 바꾸지 않는다.
  }
  return { commentId: id, replyId }
}
