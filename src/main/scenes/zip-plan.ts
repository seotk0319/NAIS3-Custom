import { extname } from 'path'

/**
 * ZIP 내보내기 "계획" 단계 — 어떤 파일을 어떤 이름으로 담을지만 계산한다.
 * DB/다이얼로그/파일 I/O와 분리된 순수 모듈 (단위 테스트 대상).
 */

export interface ZipEntry {
  filePath: string
  name: string
}

export interface SceneZipSource {
  sceneId: number
  name: string
  /** 즐겨찾기 이미지 경로(최신순) — 있으면 전부 내보낸다 */
  favoritePaths: string[]
  /** 최신 이미지 1장 — 즐겨찾기가 없을 때 폴백 (이미지 없으면 null) */
  topPath: string | null
}

/** 파일명에 못 쓰는 문자 치환. 전부 지워지면 폴백 이름 */
export function sanitizeZipName(name: string, fallback: string): string {
  const safe = name.replace(/[/\\:*?"<>|]/g, '_').trim()
  return safe || fallback
}

/**
 * 씬별 내보낼 이미지 선정 + 이름 (NAIS2 ExportDialog와 동일):
 * 즐겨찾기가 있으면 즐겨찾기 전부, 없으면 최상단(최신) 1장.
 * 이름은 씬 이름 그대로 — 한 씬에서 여러 장(즐겨찾기 다수)일 때만 _1, _2 접미사.
 */
export function planSceneZipEntries(scenes: SceneZipSource[]): ZipEntry[] {
  const entries: ZipEntry[] = []
  for (const s of scenes) {
    const picks = s.favoritePaths.length > 0 ? s.favoritePaths : s.topPath ? [s.topPath] : []
    const safe = sanitizeZipName(s.name, `씬-${s.sceneId}`)
    picks.forEach((p, i) => {
      const suffix = picks.length > 1 ? `_${i + 1}` : ''
      entries.push({ filePath: p, name: `${safe}${suffix}${extname(p) || '.png'}` })
    })
  }
  return entries
}

/** 동명 씬 충돌 폴백 — 이미 쓰인 이름이면 '_' 접두. used에 확정 이름을 기록한다 */
export function uniqueZipName(name: string, used: Set<string>): string {
  let n = name
  while (used.has(n)) n = `_${n}`
  used.add(n)
  return n
}
