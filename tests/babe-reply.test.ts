import { describe, expect, it } from 'vitest'
import {
  BABE_COMMENTS,
  replyBabe,
  sameComment,
  type ReplySend
} from '../src/main/notifications/direct/babe-reply'

const character = '66666666-6666-4666-8666-666666666666'
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('babe reply', () => {
  it('matches only the same author and text', () => {
    const target = { author: '독자', body: '재밌어요 ' }
    expect(sameComment({ id: 1, nickname: '독자', content: '재밌어요' }, target)).toBe(true)
    expect(sameComment({ id: 2, nickname: '다른사람', content: '재밌어요' }, target)).toBe(false)
    expect(sameComment({ id: 3, nickname: '독자', content: '재밌어요!!' }, target)).toBe(false)
  })

  it('finds the comment on a later page, replies to it and reads back the reply id', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    const send: ReplySend = async (url, init) => {
      calls.push({ url, ...init })
      if (init.method === 'POST') return json({ message: 'Create comment success' })
      if (url.endsWith('/replies?limit=500'))
        return json([{ id: 9, content: '감사합니다', isCreator: true }])
      const offset = Number(new URL(url).searchParams.get('offset'))
      if (offset === 0)
        return json(
          Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, nickname: 'x', content: 'y' }))
        )
      return json([{ id: 77, nickname: '독자', content: '재밌어요' }])
    }
    const result = await replyBabe(send, {
      characterId: character,
      author: '독자',
      body: '재밌어요',
      at: null,
      content: ' 감사합니다 '
    })
    expect(result).toEqual({ commentId: '77', replyId: '9' })
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe(`${BABE_COMMENTS}/77/replies`)
    expect(JSON.parse(post.body!)).toEqual({ commentId: '77', content: '감사합니다' })
  })

  it('does not post when the comment is gone or the session expired', async () => {
    const posts: string[] = []
    const empty: ReplySend = async (url, init) => {
      if (init.method === 'POST') posts.push(url)
      return json([])
    }
    const target = { characterId: character, author: null, body: '안녕', at: null, content: 'hi' }
    await expect(replyBabe(empty, target)).rejects.toThrow('COMMENT_NOT_FOUND')
    const expired: ReplySend = async () => json({}, 401)
    await expect(replyBabe(expired, target)).rejects.toThrow('LOGIN_REQUIRED')
    expect(posts).toEqual([])
  })
})
