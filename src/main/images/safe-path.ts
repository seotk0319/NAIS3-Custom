import { isAbsolute, relative, resolve } from 'path'

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_INVALID = /[\\/:*?"<>|]/g

export function sanitizePathSegment(value: string, fallback: string, maxLength = 80): string {
  let safe = value
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 0x1f && (code < 0x7f || code > 0x9f)
    })
    .join('')
    .replace(WINDOWS_INVALID, '_')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!safe || safe === '.' || safe === '..') safe = fallback
  if (WINDOWS_DEVICE.test(safe)) safe = `_${safe}`
  safe = safe.slice(0, maxLength).replace(/[. ]+$/g, '')
  return safe || fallback
}

export function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, ...segments)
  const rel = relative(resolvedRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('저장 경로가 허용된 루트를 벗어났습니다')
  }
  return target
}
