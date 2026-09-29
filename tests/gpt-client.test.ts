import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SseReader, buildBody } from '../src/main/gpt/client'
import { getCredentials, jwtClaims } from '../src/main/gpt/auth'
import type { GptRequest } from '../src/shared/gpt'

const req = (over: Partial<GptRequest> = {}): GptRequest => ({
  prompt: '코코아 컵',
  refs: [],
  size: '1024x1536',
  quality: 'low',
  model: 'gpt-5.6-luna',
  mode: 'direct',
  ...over
})

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  return enc({ alg: 'none' }) + '.' + enc(claims) + '.sig'
}

describe('gpt client', () => {
  it('reads the image even when stream chunks break mid-line', () => {
    const r = new SseReader()
    const img = JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: 'QUJD', revised_prompt: 'cocoa' }
    })
    const all = 'data: {"type":"response.created"}\n\ndata: ' + img + '\n\ndata: [DONE]\n'
    for (let i = 0; i < all.length; i += 7) r.push(all.slice(i, i + 7))
    const out = r.end()
    expect(out.b64).toBe('QUJD')
    expect(out.revisedPrompt).toBe('cocoa')
  })

  it('keeps a text-only answer so a refusal can be shown', () => {
    const r = new SseReader()
    r.push('data: {"type":"response.output_text.done","text":"I can\'t make that."}\n')
    expect(r.end()).toMatchObject({ b64: null, text: "I can't make that." })
  })

  it('sends references as input images before the prompt and asks for the canvas shape', () => {
    const body = buildBody(req({ refs: [{ b64: 'AAA', mime: 'image/webp' }] })) as {
      input: { role: string; content: unknown }[]
      tools: { type: string; size: string }[]
      stream: boolean
      store: boolean
    }
    const content = body.input[1].content as { type: string; image_url?: string; text?: string }[]
    expect(content[0]).toEqual({ type: 'input_image', image_url: 'data:image/webp;base64,AAA' })
    expect(content[1].text).toContain('tall portrait canvas')
    expect(content[1].text).toContain('코코아 컵')
    expect(body.tools[0]).toMatchObject({ type: 'image_generation', size: '1024x1536' })
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
  })
})

describe('gpt auth', () => {
  const home = mkdtempSync(join(tmpdir(), 'nais3-codex-'))
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.CODEX_HOME
  })

  it('uses a fresh token as-is and reads the account from the id token', async () => {
    process.env.CODEX_HOME = home
    const id = jwt({
      email: 'a@b.c',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1', chatgpt_plan_type: 'pro' }
    })
    writeFileSync(
      join(home, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: jwt({ exp: Date.now() / 1000 + 3600 }),
          id_token: id,
          refresh_token: 'r1'
        }
      })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const c = await getCredentials()
    expect(c).toMatchObject({ accountId: 'acc-1', email: 'a@b.c', plan: 'pro' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes an expiring token and writes the new tokens back, keeping other fields', async () => {
    process.env.CODEX_HOME = home
    writeFileSync(
      join(home, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: {
          access_token: jwt({ exp: Date.now() / 1000 + 10 }),
          refresh_token: 'old',
          account_id: 'acc-2'
        }
      })
    )
    const newAccess = jwt({ exp: Date.now() / 1000 + 86400 })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: newAccess, refresh_token: 'new' }), {
            status: 200
          })
      )
    )
    const c = await getCredentials()
    expect(c.accessToken).toBe(newAccess)
    const saved = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'))
    expect(saved.tokens).toMatchObject({
      access_token: newAccess,
      refresh_token: 'new',
      account_id: 'acc-2'
    })
    expect(saved).toHaveProperty('OPENAI_API_KEY', null)
    expect(jwtClaims(saved.tokens.access_token).exp).toBeGreaterThan(Date.now() / 1000)
    rmSync(home, { recursive: true, force: true })
  })
})
