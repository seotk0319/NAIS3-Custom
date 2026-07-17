import type Database from 'better-sqlite3'

/**
 * 버전드 마이그레이션. 배열 인덱스+1 = 적용 후 user_version.
 *
 * 규칙 (NAIS2 2.0.7 세이브 유실 사고의 재발 방지 장치):
 * - 이미 배포된 마이그레이션은 절대 수정하지 않는다. 스키마 변경은 항상 새 항목 추가.
 * - 각 마이그레이션은 트랜잭션 안에서 실행된다 (db/index.ts).
 * - 실행 전 DB 파일 백업이 자동 생성된다 (db/index.ts).
 */
export const migrations: ((db: Database.Database) => void)[] = [
  // v1: 초기 스키마
  (db) => {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- 조각 프롬프트 (<이름> 치환). NAIS2 txt 내보내기와 호환되는 평문 저장.
      CREATE TABLE fragments (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        folder TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE character_prompts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        negative_prompt TEXT NOT NULL DEFAULT '',
        folder TEXT,
        thumbnail BLOB,
        settings_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE scene_presets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT,
        params_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY,
        preset_id INTEGER NOT NULL REFERENCES scene_presets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        params_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_scenes_preset ON scenes(preset_id);

      -- 생성 이미지 히스토리. 원본은 디스크 파일, DB에는 경로/메타/재현용 payload만.
      CREATE TABLE images (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        thumbnail BLOB,
        kind TEXT NOT NULL DEFAULT 't2i', -- t2i | i2i | inpaint | scene | upscale
        seed INTEGER,
        payload_json TEXT NOT NULL,       -- 실제 전송한 요청 JSON 원본 (시드 재현 보장)
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_images_created ON images(created_at DESC);
      CREATE INDEX idx_images_kind ON images(kind);
    `)
  },

  // v2: 캐릭터 단일 리스트 모델 — 카드가 직접 enabled/위치/순서를 가진다.
  // 폴더는 별도 테이블 (이름 변경·정렬·접기). folder_id는 리스트 내 위치로부터 재계산됨.
  (db) => {
    db.exec(`
      CREATE TABLE character_folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0
      );

      ALTER TABLE character_prompts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE character_prompts ADD COLUMN center_x REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE character_prompts ADD COLUMN center_y REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE character_prompts ADD COLUMN folder_id INTEGER REFERENCES character_folders(id) ON DELETE SET NULL;
    `)
    // v1의 TEXT folder 값을 폴더 테이블로 이관
    const folders = db
      .prepare(
        `SELECT DISTINCT folder FROM character_prompts WHERE folder IS NOT NULL AND folder != '' ORDER BY folder`
      )
      .all() as { folder: string }[]
    const insert = db.prepare('INSERT INTO character_folders (name, sort_order) VALUES (?, ?)')
    const link = db.prepare('UPDATE character_prompts SET folder_id = ? WHERE folder = ?')
    folders.forEach((f, i) => {
      const id = insert.run(f.folder, i).lastInsertRowid
      link.run(id, f.folder)
    })
  },

  // v3: 조각도 캐릭터와 동일한 폴더 모델 (폴더 테이블 + folder_id + 리스트 순서)
  (db) => {
    db.exec(`
      CREATE TABLE fragment_folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE fragments ADD COLUMN folder_id INTEGER REFERENCES fragment_folders(id) ON DELETE SET NULL;
    `)
    const folders = db
      .prepare(
        `SELECT DISTINCT folder FROM fragments WHERE folder IS NOT NULL AND folder != '' ORDER BY folder`
      )
      .all() as { folder: string }[]
    const insert = db.prepare('INSERT INTO fragment_folders (name, sort_order) VALUES (?, ?)')
    const link = db.prepare('UPDATE fragments SET folder_id = ? WHERE folder = ?')
    folders.forEach((f, i) => {
      const id = insert.run(f.folder, i).lastInsertRowid
      link.run(id, f.folder)
    })
  },

  // v4: Anlas 잔액 로그 — 사용량 추적은 잔액 스냅샷 간 감소분으로 계산
  (db) => {
    db.exec(`
      CREATE TABLE anlas_log (
        id INTEGER PRIMARY KEY,
        balance INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_anlas_log_created ON anlas_log(created_at);
    `)
  },

  // v5: 바이브 트랜스퍼 / 캐릭터 레퍼런스 라이브러리 (캐릭터·조각과 동일한 폴더 리스트 모델)
  // 원본 이미지는 userData/refs/ 파일로, DB에는 경로·썸네일·파라미터만 (P3 원칙)
  (db) => {
    db.exec(`
      CREATE TABLE vibe_folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE vibe_images (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail BLOB,
        enabled INTEGER NOT NULL DEFAULT 0,
        strength REAL NOT NULL DEFAULT 0.6,
        info_extracted REAL NOT NULL DEFAULT 0.7,
        encoded TEXT,             -- encode-vibe 결과 (2 Anlas — 캐시로 재소모 방지)
        encoded_ie REAL,          -- 인코딩 당시 info_extracted (다르면 재인코딩 필요)
        folder_id INTEGER REFERENCES vibe_folders(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE charref_folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE charref_images (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail BLOB,
        enabled INTEGER NOT NULL DEFAULT 0,
        ref_type TEXT NOT NULL DEFAULT 'character&style',
        strength REAL NOT NULL DEFAULT 0.6,
        fidelity REAL NOT NULL DEFAULT 0.6,
        folder_id INTEGER REFERENCES charref_folders(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },

  // v6: 폴더 색상 (구분용, null=기본). 4개 폴더 테이블 공통
  (db) => {
    for (const table of [
      'character_folders',
      'fragment_folders',
      'vibe_folders',
      'charref_folders'
    ]) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN color TEXT`)
    }
  },

  // v7: 씬 모드. 씬은 프롬프트+해상도를 미리 저장, N회 자동 생성. 생성 이미지는 images.scene_id로 연결.
  // (v1의 미사용 scene_presets/scenes는 그대로 두고 새 gen_scenes 사용)
  (db) => {
    db.exec(`
      CREATE TABLE gen_scenes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        negative_prompt TEXT NOT NULL DEFAULT '',
        width INTEGER NOT NULL DEFAULT 832,
        height INTEGER NOT NULL DEFAULT 1216,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE images ADD COLUMN scene_id INTEGER REFERENCES gen_scenes(id) ON DELETE SET NULL;
      ALTER TABLE images ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
      -- 씬별 이미지 페이지네이션용 (수만 장 대비)
      CREATE INDEX idx_images_scene ON images(scene_id, id DESC);
      CREATE INDEX idx_images_favorite ON images(favorite);
    `)
  },

  // v8: 씬 프리셋(그룹) + 씬별 예약 수(reserve_count). 예약→생성 워크플로 (NAIS2식).
  (db) => {
    db.exec(`
      DROP TABLE IF EXISTS scenes;          -- v1 미사용
      DROP TABLE IF EXISTS scene_presets;   -- v1 미사용 (스키마 재정의)
      CREATE TABLE scene_presets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO scene_presets (id, name, sort_order) VALUES (1, '기본', 0);
      -- SQLite: FK 절 포함 ADD COLUMN 제약 때문에 REFERENCES 없이 추가 (앱에서 정합성 관리)
      ALTER TABLE gen_scenes ADD COLUMN preset_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE gen_scenes ADD COLUMN reserve_count INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_gen_scenes_preset ON gen_scenes(preset_id, sort_order);
    `)
  },
  // v9: 프롬프트 프리셋 — 좌측 사이드바의 기본 프롬프트+네거티브를 이름 붙여 저장/불러오기
  (db) => {
    db.exec(`
      CREATE TABLE prompt_presets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        negative_prompt TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `)
  },

  // v10: 프롬프트 프리셋에 생성 파라미터도 저장 — NAIS2처럼 프리셋 전환 시 스텝·CFG 등 복원
  (db) => {
    db.exec(`ALTER TABLE prompt_presets ADD COLUMN params_json TEXT;`)
  },

  // v11: 씬 프리셋별 기본 해상도 — 새 씬 생성 시 적용 (null = 832×1216)
  (db) => {
    db.exec(`
      ALTER TABLE scene_presets ADD COLUMN default_width INTEGER;
      ALTER TABLE scene_presets ADD COLUMN default_height INTEGER;
    `)
  },

  // v12: upstream v1.0.12와 동일 — 큐레이션 라이브러리.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS library_stacks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS library_images (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        thumbnail BLOB,
        width INTEGER,
        height INTEGER,
        stack_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_library_images_stack ON library_images(stack_id, id DESC);
    `)
  },

  // v13: upstream v1.0.12와 동일 — 라이브러리 드래그 정렬.
  (db) => {
    if (!hasColumn(db, 'library_images', 'sort_order')) {
      db.exec(`
        ALTER TABLE library_images ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        UPDATE library_images SET sort_order = id;
      `)
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_library_images_order ON library_images(sort_order DESC, id DESC)`
    )
  },

  // v14: upstream v1.0.12와 같은 프롬프트 3분할 저장.
  // 기존 Custom v13 DB에는 컬럼이 이미 있으므로 중복 추가를 피한다.
  (db) => {
    if (!hasColumn(db, 'prompt_presets', 'prompt_parts_json')) {
      db.exec(`ALTER TABLE prompt_presets ADD COLUMN prompt_parts_json TEXT;`)
    }
  },

  // v15: 기존 Custom v10~v13과 upstream v12~v14를 모두 현재 스키마로 수렴시키는 repair.
  (db) => {
    if (!hasColumn(db, 'prompt_presets', 'params_json')) {
      db.exec(`ALTER TABLE prompt_presets ADD COLUMN params_json TEXT;`)
    }
    if (!hasColumn(db, 'prompt_presets', 'base_prompt')) {
      db.exec(`ALTER TABLE prompt_presets ADD COLUMN base_prompt TEXT NOT NULL DEFAULT '';`)
    }
    if (!hasColumn(db, 'prompt_presets', 'prompt_parts_json')) {
      db.exec(`ALTER TABLE prompt_presets ADD COLUMN prompt_parts_json TEXT;`)
    }
    if (!hasTable(db, 'library_stacks')) {
      db.exec(`
        CREATE TABLE library_stacks (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
    }
    if (!hasTable(db, 'library_images')) {
      db.exec(`
        CREATE TABLE library_images (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          file_path TEXT NOT NULL,
          thumbnail BLOB,
          width INTEGER,
          height INTEGER,
          stack_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          sort_order INTEGER NOT NULL DEFAULT 0
        );
      `)
    } else if (!hasColumn(db, 'library_images', 'sort_order')) {
      db.exec(`
        ALTER TABLE library_images ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        UPDATE library_images SET sort_order = id;
      `)
    }
    db.exec(`
      DELETE FROM images
        WHERE id NOT IN (SELECT MAX(id) FROM images GROUP BY file_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_images_file_path ON images(file_path);
      CREATE INDEX IF NOT EXISTS idx_library_images_stack
        ON library_images(stack_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_library_images_order
        ON library_images(sort_order DESC, id DESC);
      CREATE TABLE IF NOT EXISTS nais3_schema (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO nais3_schema (key, value) VALUES ('schema_flavor', 'nais3-custom')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `)
  },

  // v16: 라이브러리 중첩 가상 폴더. 분류값만 DB에 저장하고 실제 이미지 파일은 이동하지 않는다.
  (db) => {
    db.exec(`
      CREATE TABLE library_virtual_folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES library_virtual_folders(id) ON DELETE SET NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_library_virtual_folders_parent
        ON library_virtual_folders(parent_id, sort_order, id);
    `)
    if (!hasColumn(db, 'images', 'library_folder_id')) {
      db.exec(
        `ALTER TABLE images ADD COLUMN library_folder_id INTEGER REFERENCES library_virtual_folders(id) ON DELETE SET NULL;`
      )
    }
    if (!hasColumn(db, 'library_stacks', 'folder_id')) {
      db.exec(
        `ALTER TABLE library_stacks ADD COLUMN folder_id INTEGER REFERENCES library_virtual_folders(id) ON DELETE SET NULL;`
      )
    }
    db.exec(`
      CREATE INDEX idx_images_library_folder ON images(library_folder_id, id DESC);
      CREATE INDEX idx_library_stacks_folder ON library_stacks(folder_id, id DESC);
    `)
  }
]

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  )
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (entry) => entry.name === column
  )
}
