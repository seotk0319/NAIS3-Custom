import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { migrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized — call initDb() first')
  return db
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'nais3.db')
}

/**
 * DB 열기 + 마이그레이션.
 *
 * 안전장치 (NAIS2 세이브 유실 문제의 근본 대책):
 * - WAL 모드: 크래시 시에도 커밋된 데이터 보존
 * - 마이그레이션 필요 시 실행 전 파일 백업 자동 생성 (pre-migration-v{N}.db)
 * - 각 마이그레이션은 개별 트랜잭션: 실패하면 해당 버전 이전 상태로 남고 앱은 에러 표면화
 */
export function initDb(): { version: number; path: string } {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const path = getDbPath()

  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -65536')

  let current = db.pragma('user_version', { simple: true }) as number
  const target = migrations.length

  // Custom 1.0.12의 v12/v13은 upstream과 번호 의미가 달랐다. 라이브러리 테이블이
  // 없다면 v11부터 upstream v12~v14를 다시 적용하되, 각 migration은 기존 컬럼을 보존한다.
  const legacyCustomVersion = (current === 12 || current === 13) && !hasTable(db, 'library_stacks')

  if (current < target) {
    if (legacyCustomVersion) {
      current = 11
      db.pragma('user_version = 11')
    }
    try {
      for (let v = current; v < target; v++) {
        const migrate = db.transaction(() => {
          migrations[v](db!)
          db!.pragma(`user_version = ${v + 1}`)
        })
        migrate()
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`DB migration 실패: ${detail}`)
    }
  } else if (current > target) {
    // 다운그레이드된 앱이 미래 버전 DB를 여는 상황 — 조용히 진행하면 데이터가 깨진다
    throw new Error(
      `DB version ${current} is newer than app supports (${target}). ` +
        'NAIS3를 최신 버전으로 업데이트하세요.'
    )
  }

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_images_scene_favorite ON images(scene_id, favorite DESC, id DESC)'
  )

  return { version: target, path }
}

export function closeDb(): void {
  db?.close()
  db = null
}

function hasTable(database: Database.Database, table: string): boolean {
  return Boolean(
    database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  )
}
