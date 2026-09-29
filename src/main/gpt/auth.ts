/**
 * Codex 로그인 파일(~/.codex/auth.json)의 ChatGPT 토큰을 읽고, 만료가 가까우면 갱신해 같은 파일에 다시 쓴다.
 * 갱신 토큰은 한 번 쓰면 바뀌므로 다른 도구(Codex CLI, ima2)와 어긋나지 않게 늘 파일을 새로 읽고,
 * 실제로 만료가 가까울 때만 갱신한다.
 */
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface GptCredentials {
  accessToken: string
  accountId: string
  email?: string
  plan?: string
}

interface AuthFile {
  tokens?: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string }
  last_refresh?: string
  [key: string]: unknown
}

export class GptAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GptAuthError'
  }
}

export function authFileCandidates(): string[] {
  const out: string[] = []
  if (process.env.CODEX_HOME) out.push(join(process.env.CODEX_HOME, 'auth.json'))
  out.push(join(homedir(), '.codex', 'auth.json'))
  return [...new Set(out)]
}

/** JWT 본문 (서명은 확인하지 않는다 — 만료 시각과 계정 정보만 읽는다) */
export function jwtClaims(token: string | undefined): Record<string, unknown> {
  if (!token) return {}
  const part = token.split('.')[1]
  if (!part) return {}
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function authClaim(claims: Record<string, unknown>): Record<string, unknown> {
  const v = claims['https://api.openai.com/auth']
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export function tokenExpiresAt(token: string | undefined): number | null {
  const exp = jwtClaims(token).exp
  return typeof exp === 'number' ? exp * 1000 : null
}

async function readAuth(): Promise<{ path: string; data: AuthFile } | null> {
  for (const path of authFileCandidates()) {
    try {
      const data = JSON.parse(await fs.readFile(path, 'utf8')) as AuthFile
      if (data?.tokens?.access_token || data?.tokens?.refresh_token) return { path, data }
    } catch {
      // 다음 후보
    }
  }
  return null
}

let refreshing: Promise<GptCredentials> | null = null

async function refresh(path: string, data: AuthFile): Promise<GptCredentials> {
  const rt = data.tokens?.refresh_token
  if (!rt) throw new GptAuthError('ChatGPT 로그인이 만료됐어요. Codex에서 다시 로그인해 주세요.')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: CLIENT_ID,
      scope: 'openid profile email offline_access'
    })
  })
  if (!res.ok)
    throw new GptAuthError(
      'ChatGPT 로그인을 갱신하지 못했어요 (' + res.status + '). Codex에서 다시 로그인해 주세요.'
    )
  const body = (await res.json()) as {
    access_token?: string
    id_token?: string
    refresh_token?: string
  }
  if (!body.access_token) throw new GptAuthError('ChatGPT 로그인 갱신 응답이 비어 있어요')
  // 그 사이 다른 도구가 갱신했을 수 있으니 파일을 다시 읽고 토큰만 바꿔 쓴다
  let latest: AuthFile = data
  try {
    latest = JSON.parse(await fs.readFile(path, 'utf8')) as AuthFile
  } catch {
    // 방금 읽은 값 사용
  }
  const tokens = {
    ...(latest.tokens ?? {}),
    access_token: body.access_token,
    id_token: body.id_token ?? latest.tokens?.id_token,
    refresh_token: body.refresh_token ?? rt
  }
  const next: AuthFile = { ...latest, tokens, last_refresh: new Date().toISOString() }
  const tmp = path + '.nais3-tmp'
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, path)
  return toCredentials(next)
}

function toCredentials(data: AuthFile): GptCredentials {
  const t = data.tokens ?? {}
  const id = jwtClaims(t.id_token)
  const auth = authClaim(id)
  const accountId =
    t.account_id || (typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : '')
  if (!t.access_token || !accountId)
    throw new GptAuthError('ChatGPT 로그인 정보가 완전하지 않아요. Codex에서 다시 로그인해 주세요.')
  return {
    accessToken: t.access_token,
    accountId,
    email: typeof id.email === 'string' ? id.email : undefined,
    plan: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined
  }
}

/** 요청에 쓸 자격 증명. force면 만료 전이어도 갱신한다 (401을 받았을 때) */
export async function getCredentials(force = false): Promise<GptCredentials> {
  const found = await readAuth()
  if (!found)
    throw new GptAuthError('ChatGPT 로그인 파일을 찾지 못했어요. Codex에서 로그인해 주세요.')
  const exp = tokenExpiresAt(found.data.tokens?.access_token)
  const fresh = exp !== null && exp - Date.now() > REFRESH_MARGIN_MS
  if (fresh && !force) return toCredentials(found.data)
  refreshing ??= refresh(found.path, found.data).finally(() => {
    refreshing = null
  })
  return refreshing
}
