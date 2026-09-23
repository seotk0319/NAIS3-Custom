import { safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { SessionProfile } from './engine.mjs'

export interface DirectPlatform {
  profile: SessionProfile
  connectedAt: string
}
export interface DirectState {
  version: 1
  userAgent: string | null
  platforms: Partial<Record<string, DirectPlatform>>
  checkpoints: Record<string, { complete?: boolean; next?: string | null } | undefined>
  lastRun: Record<string, number>
}
export const emptyDirectState = (): DirectState => ({
  version: 1,
  userAgent: null,
  platforms: {},
  checkpoints: {},
  lastRun: {}
})

// Session profiles hold bearer and refresh tokens, so they are only ever written
// encrypted with the operating system's user key.
export function createVault(file: string): {
  load(): Promise<DirectState>
  save(state: DirectState): Promise<void>
} {
  let chain: Promise<void> = Promise.resolve()
  return {
    async load() {
      let raw: Buffer
      try {
        raw = await readFile(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDirectState()
        throw error
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
      const value = JSON.parse(safeStorage.decryptString(raw))
      if (value?.version !== 1) throw new Error('UNSUPPORTED_SESSION_STORE')
      return { ...emptyDirectState(), ...value }
    },
    save(state) {
      const run = chain.then(async () => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
        await writeFile(file + '.tmp', safeStorage.encryptString(JSON.stringify(state)))
        await rename(file + '.tmp', file)
      })
      chain = run.catch(() => undefined)
      return run
    }
  }
}
