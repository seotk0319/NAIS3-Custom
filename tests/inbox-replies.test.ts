import { describe, expect, it } from 'vitest'
import { canReply, REPLY_ADAPTERS, writeAllowed, type ReplyContext, type ReplyItem } from '../src/main/notifications/direct/replies'
import {
  catalogFrom,
  hasUnknownWork,
  thumbAllowed,
  thumbnailFor,
  workImageFor
} from '../src/main/notifications/work-images'
import type { InboxItem } from '../src/shared/inbox'

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const item = (patch: Partial<ReplyItem>): ReplyItem => ({
  platform: 'crack',
  sourceType: 'social',
  event: 'comment',
  title: '내 스토리에 댓글이 달렸어요',
  body: '',
  at: '2026-09-23T12:17:12.687Z',
  actor: { name: null },
  work: { id: '6a00000000000000000c0c01' },
  commentId: null,
  ...patch
})
const ctx = (routes: (url: string, method: string) => Response, account: string | null = 'me'): ReplyContext & { posts: string[] } => {
  const posts: string[] = []
  return {
    posts,
    send: async (url, init) => {
      if (init.method !== 'GET') posts.push(init.method + ' ' + url + ' ' + (init.body || ''))
      return routes(url, init.method)
    },
    cookie: async () => 'csrf',
    accountId: () => account,
    route: () => 'https://api.rplay.live/account/getuser?userOid=me&requestorOid=me&loginType=rplay'
  }
}

describe('reply adapters', () => {
  it('limits writes to each platform comment route', () => {
    expect(writeAllowed('babe', 'https://api.babechatapi.com/ko/api/comments/1/replies')).toBe(true)
    expect(writeAllowed('babe', 'https://api.babechatapi.com/ko/api/characters/my')).toBe(false)
    expect(writeAllowed('crack', 'https://crack-api.wrtn.ai/crack-api/stories/6a00000000000000000c0c01/comments')).toBe(true)
    expect(writeAllowed('crack', 'https://crack-api.wrtn.ai/crack-api/alarm')).toBe(false)
    expect(writeAllowed('eden', 'https://jhbfalszdxacwjnrrvms.supabase.co/rest/v1/users')).toBe(false)
    expect(writeAllowed('luna', 'https://lunatalk.chat/anything')).toBe(false)
  })

  it('finds a Crack comment by the notification time and skips the creator own comments', async () => {
    const c = ctx(() =>
      json({ data: { comments: [
        { _id: 'own', content: '공지', createdAt: '2026-09-23T12:17:12.600Z', isOwner: true },
        { _id: 'fan', content: '잘 봤어요', createdAt: '2026-09-23T12:17:12.627Z', writer: { nickname: '독자' } },
        { _id: 'old', content: '예전', createdAt: '2026-09-23T10:00:00.000Z' }
      ], nextCursor: null } })
    )
    const target = await REPLY_ADAPTERS.crack.resolve(c, item({}))
    expect(target).toMatchObject({ parentId: 'fan', author: '독자', content: '잘 봤어요' })
  })

  it('refuses a Crack comment that is not within ten seconds', async () => {
    const c = ctx(() => json({ data: { comments: [{ _id: 'x', content: 'y', createdAt: '2026-09-23T12:10:00.000Z' }], nextCursor: null } }))
    await expect(REPLY_ADAPTERS.crack.resolve(c, item({}))).rejects.toThrow('COMMENT_NOT_FOUND')
    expect(c.posts).toEqual([])
  })

  it('replies to the parent when an Elyn notification points at a reply, and never to my own comment', async () => {
    const i = item({ platform: 'elyn', sourceType: 'ENTITY_REFERENCE', title: '알림', body: 'nick|11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|내용', at: null, work: { id: null } })
    expect(canReply(i)).toBe(true)
    const c = ctx(() => json({ comments: [{ id: '11111111-1111-4111-8111-111111111111', content: '내용', parentCommentId: 'root', authorHandle: 'nick' }] }))
    expect(await REPLY_ADAPTERS.elyn.resolve(c, i)).toMatchObject({ parentId: 'root', workId: '22222222-2222-4222-8222-222222222222' })
    const mine = ctx(() => json({ comments: [{ id: '11111111-1111-4111-8111-111111111111', content: '내용', isMyComment: true }] }))
    await expect(REPLY_ADAPTERS.elyn.resolve(mine, i)).rejects.toThrow('OWN_COMMENT')
  })

  it('writes an Eden reply as the signed-in account into the comment thread', async () => {
    const i = item({ platform: 'eden', sourceType: 'reply', commentId: 'c2', at: null, work: { id: null } })
    const c = ctx((url, method) =>
      method === 'GET'
        ? json([{ id: 'c2', work_id: 'w', user_id: 'fan', content: '답글', parent_id: 'c1', created_at: '2026-09-23T00:00:00Z' }])
        : json([{ id: 'new' }], 201)
    )
    const target = await REPLY_ADAPTERS.eden.resolve(c, i)
    expect(target.parentId).toBe('c1')
    expect(await REPLY_ADAPTERS.eden.post(c, target, '감사합니다')).toEqual({ replyId: 'new' })
    expect(JSON.parse(c.posts[0].split(' ').slice(2).join(' '))).toEqual({ work_id: 'w', user_id: 'me', content: '감사합니다', parent_id: 'c1' })
  })
})

describe('reply adapters for Rplay, Teapot and Luna', () => {
  it('replies to a Rplay comment by its position and names the commenter as receiver', async () => {
    const c = ctx((url, method) =>
      method === 'GET'
        ? json({ comments: [{ oid: 'a', text: '첫', commenterOid: 'x', commentReceiver: 'me' }, { oid: 'b', text: 'かわいい！', commenterOid: 'fan', commentReceiver: 'me', commenterNickname: 'ファン' }] })
        : json({ commentData: {} })
    )
    const i = item({ platform: 'rplay', sourceType: 'storychatsCommentByUser', commentId: 'b', work: { id: '6a00000000000000000a0a01' } })
    expect(canReply(i)).toBe(true)
    const target = await REPLY_ADAPTERS.rplay.resolve(c, i)
    expect(target).toMatchObject({ parentId: '1', author: 'ファン', content: 'かわいい！' })
    await REPLY_ADAPTERS.rplay.post(c, target, '감사합니다')
    const body = JSON.parse(c.posts[0].split(' ').slice(2).join(' '))
    expect(body).toMatchObject({ contentOid: '6a00000000000000000a0a01', commentIdx: 1, mode: 'storychatsComment', requestorOid: 'me', commentContent: { text: '감사합니다', commenterOid: 'me', commentReceiver: 'fan' } })
  })

  it('reads the Teapot comment document and refuses my own comment', async () => {
    const i = item({ platform: 'teapot', sourceType: '댓글', commentId: 'c1', work: { id: 'oc1' } })
    const fan = ctx(() => json({ fields: { content: { stringValue: '최고예요' }, author_uid: { stringValue: 'fan' }, author_name: { stringValue: '독자B' }, depth: { integerValue: '0' } } }))
    expect(await REPLY_ADAPTERS.teapot.resolve(fan, i)).toMatchObject({ parentId: 'c1', workId: 'oc1', author: '독자B' })
    const own = ctx(() => json({ fields: { content: { stringValue: '공지' }, author_uid: { stringValue: 'me' } } }))
    await expect(REPLY_ADAPTERS.teapot.resolve(own, i)).rejects.toThrow('OWN_COMMENT')
  })

  it('finds the Luna comment written in the notification minute (Korean time) and posts a form', async () => {
    const i = item({ platform: 'luna', sourceType: '캐릭터 댓글', at: '2026-09-23T12:42:00.000Z', url: 'https://lunatalk.chat/character/detail/10001', work: { id: null } })
    expect(canReply(i)).toBe(true)
    const c = ctx((url, method) => {
      if (method === 'GET') return new Response('<script>var csrfToken = "tok";</script><input id="commentFormTs" value="99">')
      return json({ success: true, comments: [
        { idx: 1, content: '내 공지', created_at: '2026-09-23 21:42:10', is_mine: true },
        { idx: 2, content: '좋아요', created_at: '2026-09-23 21:42:04', mb_nick: '독자C', is_mine: false },
        { idx: 3, content: '다른 시각', created_at: '2026-09-23 12:42:44', is_mine: false }
      ], comment: { idx: 9 } })
    })
    const target = await REPLY_ADAPTERS.luna.resolve(c, i)
    expect(target).toMatchObject({ parentId: '2', workId: '10001', author: '독자C' })
    expect(await REPLY_ADAPTERS.luna.post(c, target, '감사합니다')).toEqual({ replyId: '9' })
    expect(writeAllowed('luna', 'https://lunatalk.chat/character/api')).toBe(true)
    expect(writeAllowed('luna', 'https://lunatalk.chat/member/mypage_api')).toBe(false)
  })
})

describe('work thumbnails', () => {
  const catalog = catalogFrom([
    { id: 'b1', name: '우리 사이는 비밀 계약', mainImage: 'https://images.example-cdn.com/a.webp' },
    { id: 'b2', name: 'Re: 그 여자는 모르는 약속', mainImage: 'http://insecure.example/a.webp' }
  ])
  const inbox = (patch: Partial<InboxItem>): InboxItem => ({
    id: 'x', platform: 'genit', event: 'comment', sourceType: 's', title: '', body: '', actor: { id: null, name: null }, work: { id: null, title: null, url: null }, at: null, unread: null, url: null, ...patch
  })
  it('uses the Babe image for the same work title on other platforms, whatever host Babe uses', () => {
    expect(workImageFor(inbox({ title: '「우리 사이는 비밀 계약」 comment' }), catalog)).toBe('https://images.example-cdn.com/a.webp')
    expect(workImageFor(inbox({ platform: 'eden', work: { id: null, title: '우리 사이는, 비밀 계약!', url: null } }), catalog)).toContain('a.webp')
    expect(workImageFor(inbox({ platform: 'babe', work: { id: 'b1', title: null, url: null } }), catalog)).toContain('a.webp')
    expect(thumbnailFor(inbox({ title: '「우리 사이는 비밀 계약」' }), catalog)).toMatch(/^nais-thumb:\/\/img\/\?u=https%3A/)
  })
  it('proxies only hosts that came from a Babe response, over https', () => {
    expect(thumbAllowed('https://images.example-cdn.com/other.webp')).toBe(true)
    expect(thumbAllowed('https://evil.example/a.webp')).toBe(false)
    expect(thumbAllowed('http://images.example-cdn.com/a.webp')).toBe(false)
    expect(workImageFor(inbox({ title: '「Re: 그 여자는 모르는 약속」' }), catalog)).toBeNull()
  })
  it('flags notifications for works missing from the catalog so a new work is picked up early', () => {
    expect(hasUnknownWork([inbox({ title: '「우리 사이는 비밀 계약」' })], catalog)).toBe(false)
    expect(hasUnknownWork([inbox({ title: '「방금 올린 새 작품」' })], catalog)).toBe(true)
    expect(hasUnknownWork([inbox({ platform: 'babe', work: { id: 'new', title: null, url: null } })], catalog)).toBe(true)
    expect(hasUnknownWork([inbox({ title: '팔로우했어요' })], catalog)).toBe(false)
  })
})
