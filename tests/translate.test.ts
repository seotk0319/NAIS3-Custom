import { describe, expect, it } from 'vitest'
import { codeForStatus, deeplBase, deeplTranslate, deeplUsage } from '../src/main/translate/deepl'
import { guessReplyTarget, languageLabel, looksForeign } from '../src/shared/translate'

const reply = (status: number, value: unknown = {}): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

describe('DeepL client', () => {
  it('uses the free host for :fx keys and sends Korean replies with source KO', async () => {
    expect(deeplBase('abc:fx')).toBe('https://api-free.deepl.com')
    expect(deeplBase('abc')).toBe('https://api.deepl.com')
    let sent: { url: string; body: Record<string, unknown>; auth: string } | null = null
    const fetcher = (async (url: string, init: RequestInit) => {
      sent = {
        url,
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).Authorization
      }
      return new Response(JSON.stringify({ translations: [{ text: 'Thank you!', detected_source_language: 'KO' }] }))
    }) as unknown as typeof fetch
    const result = await deeplTranslate('k:fx', { text: '감사해요', target: 'EN-US', source: 'KO' }, fetcher)
    expect(result).toEqual({ text: 'Thank you!', detected: 'KO' })
    expect(sent).toEqual({
      url: 'https://api-free.deepl.com/v2/translate',
      body: { text: ['감사해요'], target_lang: 'EN-US', preserve_formatting: true, source_lang: 'KO' },
      auth: 'DeepL-Auth-Key k:fx'
    })
  })

  it('maps failures to the codes the screen explains', async () => {
    expect([401, 403, 456, 429, 413, 414, 400, 503].map(codeForStatus)).toEqual([
      'AUTH', 'AUTH', 'QUOTA', 'RATE', 'TOO_LONG', 'TOO_LONG', 'BAD_REQUEST', 'SERVER'
    ])
    await expect(deeplUsage('k', reply(456))).rejects.toMatchObject({ code: 'QUOTA', status: 456 })
    await expect(deeplTranslate('k', { text: 'x', target: 'KO' }, reply(200, {}))).rejects.toMatchObject({ code: 'SERVER' })
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(deeplUsage('k', offline)).rejects.toMatchObject({ code: 'NETWORK' })
    await expect(deeplUsage('  ', reply(200))).rejects.toMatchObject({ code: 'NO_KEY' })
    expect(await deeplUsage('k', reply(200, { character_count: 12, character_limit: 500000 }))).toEqual({
      used: 12,
      limit: 500000
    })
  })
})

describe('comment language hints', () => {
  it('offers Korean reading only for mostly foreign comments and guesses the reply language', () => {
    expect(looksForeign('정말 재밌어요!')).toBe(false)
    expect(looksForeign('ok')).toBe(true)
    expect(guessReplyTarget('とても面白かったです')).toBe('JA')
    expect(guessReplyTarget('這個角色很可愛')).toBe('ZH-HANT')
    expect(guessReplyTarget('I love this character')).toBe('EN-US')
    expect(guessReplyTarget('좋아요 good')).toBe(null)
    expect(languageLabel('JA')).toBe('일본어')
    expect(languageLabel('EN-US')).toBe('영어')
  })
})
