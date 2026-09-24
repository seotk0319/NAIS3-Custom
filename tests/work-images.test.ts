import { describe, expect, it } from 'vitest'
import { imageReadAllowed, readWorkImage } from '../src/main/notifications/direct/work-image-routes'
import { catalogFrom, chooseImage, sniffImage, worksNeedingImage } from '../src/main/notifications/work-images'
import type { InboxItem } from '../src/shared/inbox'

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const inbox = (patch: Partial<InboxItem> & { sourceData?: unknown }): InboxItem =>
  ({ id: 'x', platform: 'genit', event: 'comment', sourceType: 's', title: '', body: '', actor: { id: null, name: null }, work: { id: null, title: null, url: null }, at: null, unread: null, url: null, ...patch }) as InboxItem

describe('platform work images', () => {
  it('reads each platform image field from its own work response', async () => {
    const reply = (body: unknown) => async () => json(body)
    expect(await readWorkImage('eden', '33333333-3333-4333-8333-333333333333', reply([{ cover_image_url: 'https://e.example/c.webp' }]))).toBe('https://e.example/c.webp')
    expect(await readWorkImage('genit', '44444444-4444-4444-8444-444444444444', reply({ profile_images: [{ url: 'https://g.example/p.webp' }] }))).toBe('https://g.example/p.webp')
    expect(await readWorkImage('crack', '6a00000000000000000c0c01', reply({ data: { portraitImage: { origin: 'https://c.example/o.webp', w600: 'https://c.example/w600.webp' } } }))).toBe('https://c.example/w600.webp')
    expect(await readWorkImage('elyn', '55555555-5555-4555-8555-555555555555', reply({ characters: [{ imageUrl: 'https://i.example/d' }] }))).toBe('https://i.example/d')
    expect(await readWorkImage('neko', 'char_1700000000000_sample1', reply({ character: { avatar: { url: 'https://n.example/a.webp' } } }))).toBe('https://n.example/a.webp')
  })
  it('builds the Rplay thumbnail without a request and rejects odd ids or http images', async () => {
    const never = async (): Promise<Response> => { throw new Error('no request') }
    expect(await readWorkImage('rplay', '6a00000000000000000b0b01', never)).toBe('https://pb3.rplay.live/thumbnail/6a00000000000000000b0b01')
    expect(await readWorkImage('crack', '../../admin', never)).toBeNull()
    expect(await readWorkImage('genit', '44444444-4444-4444-8444-444444444444', async () => json({ profile_images: [{ url: 'http://g.example/p.webp' }] }))).toBeNull()
    await expect(readWorkImage('crack', '6a00000000000000000c0c01', async () => json({}, 401))).rejects.toThrow('LOGIN_REQUIRED')
  })
  it('only reads from each platform own API origin', () => {
    expect(imageReadAllowed('genit', 'https://api.genit.ai/api/characters/x/')).toBe(true)
    expect(imageReadAllowed('genit', 'https://evil.example/api/characters/x/')).toBe(false)
    expect(imageReadAllowed('rplay', 'https://pb3.rplay.live/thumbnail/x')).toBe(false)
  })
  it('prefers the Babe image, then the platform image, then nothing', () => {
    const catalog = catalogFrom([{ id: 'b1', name: '같은 작품', mainImage: 'https://b.example/b.webp' }])
    const images = { 'genit:g1': 'https://g.example/g.webp', 'genit:g2': null }
    expect(chooseImage(inbox({ title: '「같은 작품」', work: { id: 'g1', title: null, url: null } }), catalog, images)).toBe('https://b.example/b.webp')
    expect(chooseImage(inbox({ title: '「다른 작품」', work: { id: 'g1', title: null, url: null } }), catalog, images)).toBe('https://g.example/g.webp')
    expect(chooseImage(inbox({ title: '「다른 작품」', work: { id: 'g2', title: null, url: null } }), catalog, images)).toBeNull()
    expect(chooseImage(inbox({ platform: 'teapot', sourceData: { thumb_url: 'https://t.example/t.webp' } }), catalog, images)).toBe('https://t.example/t.webp')
    expect(worksNeedingImage([
      inbox({ title: '「같은 작품」', work: { id: 'g1', title: null, url: null } }),
      inbox({ title: '「다른 작품」', work: { id: 'g3', title: null, url: null } }),
      inbox({ title: '「다른 작품」', work: { id: 'g3', title: null, url: null } })
    ], catalog)).toEqual([{ platform: 'genit', workId: 'g3' }])
  })
})

describe('thumbnail proxy', () => {
  it('recognises images by their first bytes, not the server label', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x70, 0xb6, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(sniffImage(webp)).toBe('image/webp')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull()
  })
})

describe('quoted and cut titles', () => {
  const catalog = catalogFrom([
    { id: 'b1', name: 'Re: 그 여자는 모르는 약속', mainImage: 'https://b.example/r.webp' },
    { id: 'b2', name: '우리 사이는 비밀 계약', mainImage: 'https://b.example/o.webp' }
  ])
  it('matches Teapot quotes and Luna titles cut with ...', () => {
    expect(chooseImage(inbox({ platform: 'teapot', title: "'우리 사이는 비밀 계약' 독자B님이 댓글을 달았습니다." }), catalog)).toBe('https://b.example/o.webp')
    expect(chooseImage(inbox({ platform: 'luna', title: "'Re: 그 여자는 모르는 약...'에 새 댓글이 달렸습니다." }), catalog)).toBe('https://b.example/r.webp')
  })
})

