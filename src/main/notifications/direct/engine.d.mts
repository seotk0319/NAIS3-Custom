/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SessionProfile {
  headers?: Record<string, string>
  headersByOrigin?: Record<string, Record<string, string>>
  routes?: Record<string, string>
  queries?: unknown[]
  renewal?: { kind: string; refreshToken: string; [key: string]: unknown }
  capturedAt?: string
  renewedAt?: string
  [key: string]: unknown
}
export interface EngineRequest {
  platform: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}
export type EngineTransport = (request: EngineRequest) => Promise<Response>
export interface EngineBatch {
  platform: string
  channel?: string
  items: unknown[]
  issues?: unknown[]
  unmapped?: number
  received?: number
  checkpoint?: { next?: string | null; complete?: boolean; [key: string]: unknown } | null
  [key: string]: unknown
}
export type EngineCommit = (batch: EngineBatch) => Promise<void>
export const endpoints: Record<string, string>
export const allowed: Record<
  string,
  { origin: string; paths: string[]; alternates?: { origin: string; paths: string[] }[] }
>
export function readRoute(platform: string, url: string): string
export class SessionExpired extends Error {
  platform: string
  trace: Record<string, unknown>
}
export function readError(
  platform: string,
  response: Response,
  url: string,
  stage: string
): Promise<Error>
export function traceText(trace: Record<string, unknown>): string
export function renewable(response: Response, hint?: unknown): Promise<boolean>
export function collectPages(options: {
  platform: string
  transport: EngineTransport
  commit: EngineCommit
  startUrl?: string
  checkpoint?: any
  maxPages?: number
  signal?: AbortSignal
  stage?: string
}): Promise<any>
export function collectEden(options: {
  profile: SessionProfile
  transport: EngineTransport
  commit: EngineCommit
  checkpoint?: any
}): Promise<void>
export function collectLuna(options: {
  transport: EngineTransport
  commit: EngineCommit
  checkpoint?: any
}): Promise<void>
export function collectTeapot(options: {
  profile: SessionProfile
  transport: EngineTransport
  commit: EngineCommit
}): Promise<void>
export function normalize(platform: string, body: unknown, options?: unknown): EngineBatch
export function profileUpdate(
  platform: string,
  message: unknown,
  previous?: SessionProfile
): SessionProfile
export function safeSessionSummary(profile: SessionProfile | undefined): {
  connected: boolean
  expiresAt: string | null
  canRenew: boolean
  [key: string]: unknown
}
export function teapotQueries(profile: SessionProfile | undefined): unknown[]
export function expiryByOrigin(profile: SessionProfile | undefined): Record<string, string>
export function renewableExpiry(profile: SessionProfile | undefined): string | null
export function renewSession(options: {
  platform: string
  profile: SessionProfile
  fetchImpl?: typeof fetch
}): Promise<{
  authorization: string
  origins: string[]
  renewal: SessionProfile['renewal']
}>
