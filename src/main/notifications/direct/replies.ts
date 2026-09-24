// 알림에서 바로 답글을 다는 플랫폼별 규칙. 주소와 보내는 형식은 각 사이트 웹 코드에서
// 확인했고, 2026-09-24에 플랫폼마다 실제로 답글을 달았다가 지워 동작을 확인했다.
// 흐름: resolve(원래 댓글 찾기) → 화면에서 대상 확인 → post(답글 달기). 9개 플랫폼 모두 지원.
import { BABE_COMMENTS, BABE_REPLYABLE, findBabeComment, REPLY_MAX, ReplyError } from './babe-reply'

export interface ReplyItem {
  platform: string
  sourceType: string
  event: string
  title: string
  body: string
  at: string | null
  actor: { name: string | null }
  work: { id: string | null }
  commentId: string | null
  /** 원문 주소 (루나는 작품 번호가 여기에만 있다) */
  url?: string | null
}
export interface ReplyComment {
  /** 답글을 달 부모 댓글 번호 */
  parentId: string
  /** 작품 번호(에덴처럼 댓글에서 다시 읽는 곳은 그 값) */
  workId: string
  author: string | null
  content: string
  at: string | null
  /** 올릴 때 다시 필요한 값 (루나 CSRF 토큰, 스토리챗 댓글 순번 등) */
  extra?: Record<string, string>
}
export type WriteSend = (
  url: string,
  init: {
    method: 'GET' | 'POST' | 'DELETE'
    body?: string
    headers?: Record<string, string>
    /** 폼 전송 (루나) */
    form?: Record<string, string>
  }
) => Promise<Response>
export interface ReplyContext {
  send: WriteSend
  /** 그 사이트 쿠키 값 (젠잇 CSRF 토큰) */
  cookie(domain: string, name: string): Promise<string | null>
  /** 로그인한 계정 번호 (에덴: 토큰의 sub, 티팟: 토큰의 user_id) */
  accountId(origin: string): string | null
  /** 로그인할 때 기록한 요청 주소 (스토리챗 계정 번호가 여기 있다) */
  route(path: string): string | null
}

interface Adapter {
  /** 이 알림이 답글을 달 수 있는 종류인지 (저장된 정보만으로 판단) */
  accepts(item: ReplyItem): boolean
  /** 쓰기를 허용할 주소 */
  allows(url: URL): boolean
  resolve(ctx: ReplyContext, item: ReplyItem): Promise<ReplyComment>
  post(ctx: ReplyContext, target: ReplyComment, content: string): Promise<{ replyId: string | null }>
}

const TIME_WINDOW = 10_000
const near = (a: string | null | undefined, b: string | null | undefined): number =>
  a && b ? Math.abs(Date.parse(a) - Date.parse(b)) : Number.POSITIVE_INFINITY

async function json(response: Response, stage: string): Promise<unknown> {
  if (response.status === 401 || response.status === 403) throw new ReplyError('LOGIN_REQUIRED', response.status)
  if (!response.ok) throw new ReplyError(stage, response.status)
  return response.json()
}

// 엘린 댓글 알림 본문은 "작성자|댓글번호|작품번호|내용" 모양일 때가 있다 (제목 없는 4칸형).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function elynParts(item: Pick<ReplyItem, 'body'>): { author: string; commentId: string; workId: string; content: string } | null {
  const parts = String(item.body || '').split('|')
  if (parts.length < 4 || !UUID.test(parts[1]) || !UUID.test(parts[2])) return null
  return { author: parts[0], commentId: parts[1], workId: parts[2], content: parts.slice(3).join('|') }
}

const babe: Adapter = {
  accepts: (i) => BABE_REPLYABLE.has(i.sourceType) && !!i.work.id && !!i.body,
  allows: (u) => u.origin === 'https://api.babechatapi.com' && u.pathname.startsWith('/ko/api/comments'),
  async resolve(ctx, i) {
    const c = await findBabeComment((url, init) => ctx.send(url, init), {
      characterId: i.work.id!,
      author: i.actor.name,
      body: i.body,
      at: i.at,
      content: ''
    })
    return { parentId: String(c.id), workId: i.work.id!, author: c.nickname ?? i.actor.name, content: String(c.content ?? ''), at: c.createdAt ?? i.at }
  },
  async post(ctx, t, content) {
    await json(await ctx.send(`${BABE_COMMENTS}/${t.parentId}/replies`, { method: 'POST', body: JSON.stringify({ commentId: t.parentId, content }) }), 'POST_FAILED')
    const replies = (await json(await ctx.send(`${BABE_COMMENTS}/${t.parentId}/replies?limit=500`, { method: 'GET' }), 'REPLIES_FAILED').catch(() => [])) as { id: number; content: string; isCreator?: boolean }[]
    const mine = Array.isArray(replies) ? replies.filter((r) => r.isCreator && r.content === content).at(-1) : undefined
    return { replyId: mine ? String(mine.id) : null }
  }
}

const GENIT = 'https://api.genit.ai/api/comments/'
const genit: Adapter = {
  accepts: (i) => i.sourceType === 'creator_character_comment' && !!i.commentId && !!i.work.id,
  allows: (u) => u.origin === 'https://api.genit.ai' && u.pathname.startsWith('/api/comments/'),
  async resolve(_ctx, i) {
    return { parentId: i.commentId!, workId: i.work.id!, author: i.actor.name, content: i.body, at: i.at }
  },
  async post(ctx, t, content) {
    const csrf = await ctx.cookie('genit.ai', 'wavechat_csrftoken')
    if (!csrf) throw new ReplyError('LOGIN_REQUIRED')
    const created = (await json(
      await ctx.send(GENIT, {
        method: 'POST',
        headers: { 'x-csrftoken': csrf, referer: 'https://genit.ai/', origin: 'https://genit.ai' },
        body: JSON.stringify({ content, character: t.workId, parent: t.parentId })
      }),
      'POST_FAILED'
    )) as { id?: string }
    return { replyId: created?.id ?? null }
  }
}

const ELYN = 'https://api.seoul.elyn.ai/api/v1/characters/'
interface ElynComment { id: string; content: string; authorHandle?: string; parentCommentId?: string | null; isMyComment?: boolean; createdAt?: string }
const elyn: Adapter = {
  accepts: (i) => i.event === 'comment' && (!!(i.commentId && i.work.id) || !!elynParts(i)),
  allows: (u) => u.origin === 'https://api.seoul.elyn.ai' && /^\/api\/v1\/characters\/[^/]+\/comments(\/|$)/.test(u.pathname),
  async resolve(ctx, i) {
    const parts = elynParts(i)
    const workId = i.work.id || parts?.workId
    const commentId = i.commentId || parts?.commentId
    if (!workId || !commentId) throw new ReplyError('BAD_TARGET')
    for (let page = 1; page <= 10; page++) {
      const body = (await json(await ctx.send(`${ELYN}${workId}/comments?page=${page}&limit=50`, { method: 'GET' }), 'LIST_FAILED')) as { comments?: ElynComment[]; total?: number }
      const rows = body.comments || []
      const hit = rows.find((c) => c.id === commentId)
      if (hit) {
        if (hit.isMyComment) throw new ReplyError('OWN_COMMENT')
        // 엘린은 답글에 다시 답글을 달 수 없어서, 답글이면 그 부모 댓글에 단다.
        return { parentId: hit.parentCommentId || hit.id, workId, author: hit.authorHandle ?? i.actor.name, content: hit.content, at: hit.createdAt ?? i.at }
      }
      if (rows.length < 50) break
    }
    throw new ReplyError('COMMENT_NOT_FOUND')
  },
  async post(ctx, t, content) {
    const created = (await json(await ctx.send(`${ELYN}${t.workId}/comments`, { method: 'POST', body: JSON.stringify({ content, parent_comment_id: t.parentId }) }), 'POST_FAILED')) as { id?: string }
    return { replyId: created?.id ?? null }
  }
}

const CRACK = 'https://crack-api.wrtn.ai/crack-api/stories/'
interface CrackComment { _id: string; content: string; createdAt: string; writer?: { nickname?: string }; isOwner?: boolean }
const crack: Adapter = {
  // 크랙 알림에는 댓글 내용도 작성자도 없다. 작품 댓글 가운데 알림과 같은 시각에 달린 댓글을 찾는다.
  accepts: (i) => i.event === 'comment' && /^내 스토리에 댓글이 달렸어요/.test(i.title) && !!i.work.id && !!i.at,
  allows: (u) => u.origin === 'https://crack-api.wrtn.ai' && /^\/crack-api\/stories\/[a-f0-9]{24}\/comments(\/|$)/.test(u.pathname),
  async resolve(ctx, i) {
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const q: string = `?limit=20&sort=createdAt.desc${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`
      const body = (await json(await ctx.send(`${CRACK}${i.work.id}/comments${q}`, { method: 'GET' }), 'LIST_FAILED')) as { data?: { comments?: CrackComment[]; nextCursor?: string | null } }
      const rows = body.data?.comments || []
      const hit = rows.filter((c) => !c.isOwner).sort((a, b) => near(a.createdAt, i.at) - near(b.createdAt, i.at))[0]
      if (hit && near(hit.createdAt, i.at) <= TIME_WINDOW)
        return { parentId: hit._id, workId: i.work.id!, author: hit.writer?.nickname ?? null, content: hit.content, at: hit.createdAt }
      const oldest = rows.at(-1)?.createdAt
      cursor = body.data?.nextCursor ?? null
      if (!cursor || (oldest && Date.parse(oldest) < Date.parse(i.at!) - TIME_WINDOW)) break
    }
    throw new ReplyError('COMMENT_NOT_FOUND')
  },
  async post(ctx, t, content) {
    const created = (await json(await ctx.send(`${CRACK}${t.workId}/comments`, { method: 'POST', body: JSON.stringify({ parentId: t.parentId, content }) }), 'POST_FAILED')) as { data?: { _id?: string } }
    return { replyId: created?.data?._id ?? null }
  }
}

const NEKO = 'https://www.nekochat.xyz/api/characters/'
interface NekoComment { id: string; content: string; createdAt: string; authorNickname?: string; isCharacterCreator?: boolean; replies?: NekoComment[] }
const neko: Adapter = {
  accepts: (i) => i.event === 'comment' && !!i.work.id && !!i.at,
  allows: (u) => u.origin === 'https://www.nekochat.xyz' && /^\/api\/characters\/[^/]+\/comments$/.test(u.pathname),
  async resolve(ctx, i) {
    for (let page = 1; page <= 10; page++) {
      const body = (await json(await ctx.send(`${NEKO}${encodeURIComponent(i.work.id!)}/comments?page=${page}&limit=20`, { method: 'GET' }), 'LIST_FAILED')) as { comments?: NekoComment[] }
      const rows = (body.comments || []).filter((c) => !c.isCharacterCreator)
      const hit = rows
        .filter((c) => !i.actor.name || c.authorNickname === i.actor.name)
        .sort((a, b) => near(a.createdAt, i.at) - near(b.createdAt, i.at))[0]
      if (hit && near(hit.createdAt, i.at) <= TIME_WINDOW)
        return { parentId: hit.id, workId: i.work.id!, author: hit.authorNickname ?? i.actor.name, content: hit.content, at: hit.createdAt }
      if ((body.comments || []).length < 20) break
    }
    throw new ReplyError('COMMENT_NOT_FOUND')
  },
  async post(ctx, t, content) {
    const created = (await json(await ctx.send(`${NEKO}${encodeURIComponent(t.workId)}/comments`, { method: 'POST', body: JSON.stringify({ content, parentCommentId: t.parentId, isSecret: false }) }), 'POST_FAILED')) as { comment?: { id?: string } }
    return { replyId: created?.comment?.id ?? null }
  }
}

const EDEN_ORIGIN = 'https://jhbfalszdxacwjnrrvms.supabase.co'
const EDEN = EDEN_ORIGIN + '/rest/v1/work_comments'
interface EdenComment { id: string; work_id: string; user_id: string; content: string; parent_id: string | null; created_at: string }
const eden: Adapter = {
  accepts: (i) => (i.sourceType === 'comment' || i.sourceType === 'reply') && !!i.commentId,
  allows: (u) => u.origin === EDEN_ORIGIN && u.pathname === '/rest/v1/work_comments',
  async resolve(ctx, i) {
    const rows = (await json(await ctx.send(`${EDEN}?id=eq.${encodeURIComponent(i.commentId!)}&select=id,work_id,user_id,content,parent_id,created_at`, { method: 'GET' }), 'LIST_FAILED')) as EdenComment[]
    const c = Array.isArray(rows) ? rows[0] : undefined
    if (!c) throw new ReplyError('COMMENT_NOT_FOUND')
    if (c.user_id === ctx.accountId(EDEN_ORIGIN)) throw new ReplyError('OWN_COMMENT')
    // 답글에 다는 답글은 같은 묶음(부모 댓글)에 단다.
    return { parentId: c.parent_id || c.id, workId: c.work_id, author: i.actor.name, content: c.content, at: c.created_at }
  },
  async post(ctx, t, content) {
    const me = ctx.accountId(EDEN_ORIGIN)
    if (!me) throw new ReplyError('LOGIN_REQUIRED')
    const created = (await json(
      await ctx.send(`${EDEN}?select=id`, {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ work_id: t.workId, user_id: me, content, parent_id: t.parentId })
      }),
      'POST_FAILED'
    )) as { id?: string }[]
    return { replyId: Array.isArray(created) ? (created[0]?.id ?? null) : null }
  }
}

// 스토리챗: 댓글은 작품 정보의 comments 배열에 있고, 답글은 그 배열 순번(commentIdx)으로 단다.
const RPLAY_READ = 'https://chat-api.rplay.live/story-chat/chat-content'
const RPLAY_WRITE = 'https://api.rplay.live/content/comment'
interface RplayComment { oid: string; text: string; commenterOid: string; commentReceiver: string; commenterNickname?: string; visible?: boolean; cocomments?: RplayComment[] }
function rplayAccount(ctx: ReplyContext): { me: string; loginType: string } {
  const route = ctx.route('/account/getuser')
  const url = route ? new URL(route) : null
  const me = url?.searchParams.get('requestorOid')
  if (!me) throw new ReplyError('LOGIN_REQUIRED')
  return { me, loginType: url?.searchParams.get('loginType') || 'rplay' }
}
const rplay: Adapter = {
  accepts: (i) => (i.event === 'comment' || i.event === 'reply') && !!i.commentId && !!i.work.id,
  allows: (u) =>
    (u.origin === 'https://chat-api.rplay.live' && u.pathname === '/story-chat/chat-content') ||
    (u.origin === 'https://api.rplay.live' && u.pathname === '/content/comment'),
  async resolve(ctx, i) {
    const { me } = rplayAccount(ctx)
    const options = encodeURIComponent(JSON.stringify({ withComments: true, includeImageUrl: false, preset: 'detail' }))
    const body = (await json(await ctx.send(`${RPLAY_READ}?contentOid=${encodeURIComponent(i.work.id!)}&options=${options}&platformType=rplay&lang=ko`, { method: 'GET' }), 'LIST_FAILED')) as { comments?: RplayComment[] }
    const rows = body.comments || []
    let idx = rows.findIndex((c) => c.oid === i.commentId)
    let hit = rows[idx]
    // 답글 알림이면 그 답글이 달린 댓글에 단다 (스토리챗은 한 단계만 답글을 받는다).
    if (idx < 0) {
      idx = rows.findIndex((c) => (c.cocomments || []).some((r) => r.oid === i.commentId))
      hit = (rows[idx]?.cocomments || []).find((r) => r.oid === i.commentId) as RplayComment
    }
    if (idx < 0 || !hit || hit.visible === false) throw new ReplyError('COMMENT_NOT_FOUND')
    if (hit.commenterOid === me) throw new ReplyError('OWN_COMMENT')
    return {
      parentId: String(idx),
      workId: i.work.id!,
      author: hit.commenterNickname ?? i.actor.name,
      content: hit.text,
      at: i.at,
      extra: { receiver: rows[idx].commenterOid }
    }
  },
  async post(ctx, t, content) {
    const { me, loginType } = rplayAccount(ctx)
    await json(
      await ctx.send(RPLAY_WRITE, {
        method: 'POST',
        body: JSON.stringify({
          contentOid: t.workId,
          commentIdx: Number(t.parentId),
          mode: 'storychatsComment',
          commentContent: { text: content, donationAmount: 0, donationCurrency: 'coin', commenterOid: me, commentReceiver: t.extra?.receiver },
          isWeb: true,
          lang: 'ko',
          requestorOid: me,
          platformType: 'rplay',
          loginType
        })
      }),
      'POST_FAILED'
    )
    return { replyId: null }
  }
}

// 티팟: 댓글은 파이어스토어 OC/{작품}/comments에 있고, 쓰기는 파이어베이스 함수 createOCComment로 한다.
const TEAPOT_DOCS = 'https://firestore.googleapis.com/v1/projects/chat-ai-7a275/databases/(default)/documents/OC/'
const TEAPOT_CREATE = 'https://us-central1-chat-ai-7a275.cloudfunctions.net/createOCComment'
type FsValue = { stringValue?: string; integerValue?: string; timestampValue?: string; booleanValue?: boolean }
const teapot: Adapter = {
  accepts: (i) => i.sourceType === '댓글' && !!i.commentId && !!i.work.id,
  allows: (u) =>
    (u.origin === 'https://firestore.googleapis.com' && u.pathname.startsWith('/v1/projects/chat-ai-7a275/databases/(default)/documents/OC/')) ||
    (u.origin === 'https://us-central1-chat-ai-7a275.cloudfunctions.net' && u.pathname === '/createOCComment'),
  async resolve(ctx, i) {
    const doc = (await json(await ctx.send(`${TEAPOT_DOCS}${encodeURIComponent(i.work.id!)}/comments/${encodeURIComponent(i.commentId!)}`, { method: 'GET' }), 'LIST_FAILED')) as { fields?: Record<string, FsValue> }
    const f = doc.fields || {}
    if (!f.content || f.is_deleted?.booleanValue) throw new ReplyError('COMMENT_NOT_FOUND')
    if (f.author_uid?.stringValue && f.author_uid.stringValue === ctx.accountId('https://firestore.googleapis.com')) throw new ReplyError('OWN_COMMENT')
    const depth = Number(f.depth?.integerValue || 0)
    // 답글의 답글은 원래 댓글 묶음(root)에 단다.
    const parentId = depth > 0 ? f.root_id?.stringValue || f.parent_id?.stringValue || i.commentId! : i.commentId!
    return { parentId, workId: i.work.id!, author: f.author_name?.stringValue ?? i.actor.name, content: f.content.stringValue || '', at: f.time_created?.timestampValue ?? i.at }
  },
  async post(ctx, t, content) {
    const created = (await json(
      await ctx.send(TEAPOT_CREATE, { method: 'POST', body: JSON.stringify({ data: { ocId: t.workId, content, parentId: t.parentId, isSecret: false } }) }),
      'POST_FAILED'
    )) as { result?: { id?: string } }
    return { replyId: created?.result?.id ?? null }
  }
}

// 루나: 서버 렌더 페이지. 작품 페이지의 CSRF 토큰으로 /character/api에 폼을 보낸다.
// 알림에는 분 단위 시각만 있어서, 그 1분 안에 달린 남의 댓글을 찾는다 (루나 시각은 한국 시간).
const LUNA = 'https://lunatalk.chat'
interface LunaComment { idx: number | string; content: string; created_at: string; mb_nick?: string; is_mine?: boolean | string; is_deleted?: boolean | string; replies?: LunaComment[]; children?: LunaComment[] }
const lunaChar = (i: ReplyItem): string | null => /lunatalk\.chat\/character\/detail\/(\d+)/.exec(i.url || '')?.[1] ?? null
const kst = (value: string): number => Date.parse(value.replace(' ', 'T') + '+09:00')
const luna: Adapter = {
  accepts: (i) => (i.event === 'comment' || i.event === 'reply') && !!lunaChar(i) && !!i.at,
  allows: (u) => u.origin === LUNA && (/^\/character\/detail\/\d+$/.test(u.pathname) || u.pathname === '/character/api'),
  async resolve(ctx, i) {
    const char = lunaChar(i)!
    const page = await ctx.send(`${LUNA}/character/detail/${char}`, { method: 'GET' })
    if (!page.ok) throw new ReplyError('LIST_FAILED', page.status)
    const html = await page.text()
    const csrf = /csrfToken\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1]
    const ts = /id="commentFormTs" value="(\d+)"/.exec(html)?.[1] || '0'
    if (!csrf) throw new ReplyError('LOGIN_REQUIRED')
    const body = (await json(await ctx.send(`${LUNA}/character/api`, { method: 'POST', form: { csrf_token: csrf, action: 'get_comments', char_idx: char, sort: 'latest' } }), 'LIST_FAILED')) as { comments?: LunaComment[] }
    const flat: LunaComment[] = []
    const walk = (list?: LunaComment[]): void => { for (const c of list || []) { flat.push(c); walk(c.replies || c.children) } }
    walk(body.comments)
    const at = Date.parse(i.at!)
    const hit = flat
      .filter((c) => String(c.is_mine) !== 'true' && String(c.is_deleted) !== 'true')
      .map((c) => ({ c, d: kst(c.created_at) - at }))
      .filter((x) => x.d >= -1_000 && x.d < 60_000)
      .sort((a, b) => a.d - b.d)[0]?.c
    if (!hit) throw new ReplyError('COMMENT_NOT_FOUND')
    return { parentId: String(hit.idx), workId: char, author: hit.mb_nick ?? null, content: hit.content, at: new Date(kst(hit.created_at)).toISOString(), extra: { csrf, ts } }
  },
  async post(ctx, t, content) {
    const created = (await json(
      await ctx.send(`${LUNA}/character/api`, {
        method: 'POST',
        form: { csrf_token: t.extra?.csrf || '', action: 'add_comment', char_idx: t.workId, content, is_anonymous: '0', parent_idx: t.parentId, form_ts: t.extra?.ts || '0', website_url: '' }
      }),
      'POST_FAILED'
    )) as { success?: boolean; comment?: { idx?: number | string } }
    if (!created?.success) throw new ReplyError('POST_FAILED')
    return { replyId: created.comment?.idx != null ? String(created.comment.idx) : null }
  }
}

export const REPLY_ADAPTERS: Record<string, Adapter> = { babe, genit, elyn, crack, neko, eden, rplay, teapot, luna }

export function canReply(item: ReplyItem): boolean {
  return !!REPLY_ADAPTERS[item.platform]?.accepts(item)
}
export function writeAllowed(platform: string, url: string): boolean {
  try {
    const u = new URL(url)
    return !u.username && !u.password && !!REPLY_ADAPTERS[platform]?.allows(u)
  } catch {
    return false
  }
}
export function checkContent(content: string): string {
  const text = content.trim()
  if (!text || text.length > REPLY_MAX) throw new ReplyError('BAD_CONTENT')
  return text
}
