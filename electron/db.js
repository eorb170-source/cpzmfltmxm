'use strict';

// sql.js는 순수 WebAssembly로 동작하는 SQLite라, Node/Electron 버전이 바뀌거나
// 사용자 PC에 C++ 빌드 도구가 없어도 별도 컴파일 없이 그대로 설치/실행됩니다.
// (better-sqlite3 같은 네이티브 모듈은 Node/Electron 버전마다 다시 빌드해야 해서
//  Visual Studio Build Tools 같은 게 없는 PC에서 설치가 실패하는 문제가 있었습니다.)

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let dbPath;
let rawDb;
let inTransaction = false;

// 스키마 버전. 다음 배포 때 tasks/task_instances 테이블 구조를 바꿔야 하면
// SCHEMA_VERSION을 1 올리고, 아래 MIGRATIONS 객체에 같은 번호로
// "옛날 스키마 -> 새 스키마"로 바꾸는 ALTER TABLE 등을 추가하세요.
// 이렇게 해두면 이미 설치되어 데이터가 쌓여있는 사용자가 자동 업데이트를 받아도
// 기존 체크리스트 데이터가 사라지거나 앱이 깨지지 않고, 필요한 변경만 적용됩니다.
const SCHEMA_VERSION = 1;
const MIGRATIONS = {
  // 예시) 2: () => { rawDb.exec("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0"); }
};

function persist() {
  if (inTransaction) return;
  const data = rawDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function toParamList(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const named = {};
    for (const [key, value] of Object.entries(args[0])) named[`@${key}`] = value;
    return named;
  }
  return args;
}

function bindAndRun(sql, args, collect) {
  const stmt = rawDb.prepare(sql);
  try {
    const params = toParamList(args);
    if (Array.isArray(params) ? params.length : Object.keys(params).length) {
      stmt.bind(params);
    }
    return collect(stmt);
  } finally {
    stmt.free();
  }
}

function makeStatement(sql) {
  return {
    run(...args) {
      bindAndRun(sql, args, (stmt) => stmt.step());
      const idRow = rawDb.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = idRow.length ? idRow[0].values[0][0] : 0;
      const changes = rawDb.getRowsModified();
      persist();
      return { lastInsertRowid, changes };
    },
    get(...args) {
      return bindAndRun(sql, args, (stmt) => (stmt.step() ? stmt.getAsObject() : undefined));
    },
    all(...args) {
      return bindAndRun(sql, args, (stmt) => {
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      });
    }
  };
}

const db = {
  exec(sql) {
    rawDb.exec(sql);
    persist();
  },
  pragma(statement) {
    try {
      rawDb.run(`PRAGMA ${statement}`);
    } catch (err) {
      // sql.js는 journal_mode 같은 일부 pragma를 지원하지 않을 수 있으므로 무시합니다.
    }
  },
  prepare(sql) {
    return makeStatement(sql);
  },
  transaction(fn) {
    return (...args) => {
      rawDb.exec('BEGIN');
      inTransaction = true;
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        inTransaction = false;
        persist();
        return result;
      } catch (err) {
        inTransaction = false;
        rawDb.exec('ROLLBACK');
        throw err;
      }
    };
  },
  // 이 PC에 저장된 모든 업무/이력을 지웁니다. 알림·기본 설정 값은 유지됩니다.
  // 다른 사람에게 이 PC(또는 이 프로그램)를 넘길 때 내 업무 데이터가 보이지 않도록
  // 설정 화면에서 이 기능을 호출합니다.
  resetAllData() {
    rawDb.exec('DELETE FROM task_instances; DELETE FROM tasks;');
    persist();
  }
};

async function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  dbPath = path.join(userDataDir, 'work-checklist.db');

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });

  const isExistingDb = fs.existsSync(dbPath);
  const existing = isExistingDb ? fs.readFileSync(dbPath) : null;
  rawDb = existing ? new SQL.Database(existing) : new SQL.Database();

  db.pragma('foreign_keys = ON');

  // 아래 CREATE TABLE은 항상 "최신" 스키마 기준입니다. 새로 설치하는 사용자는
  // 이 스키마로 바로 시작하고, 이미 데이터가 있던 사용자는 MIGRATIONS를 거쳐
  // 같은 최신 스키마로 맞춰집니다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      repeat_type TEXT NOT NULL CHECK (repeat_type IN ('daily','weekly','monthly','yearly','once')),
      repeat_config TEXT NOT NULL DEFAULT '{}',
      due_time TEXT,
      reminder_enabled INTEGER NOT NULL DEFAULT 1,
      reminder_interval_minutes INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      instance_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','missed')),
      completed_at TEXT,
      last_notified_at TEXT,
      notify_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(task_id, instance_date)
    );

    CREATE INDEX IF NOT EXISTS idx_instances_date ON task_instances(instance_date);
    CREATE INDEX IF NOT EXISTS idx_instances_task ON task_instances(task_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (isExistingDb) {
    // 기존에 쓰던 DB 파일이면, 그 파일이 기록하고 있는 스키마 버전부터
    // 최신 버전까지 필요한 마이그레이션만 순서대로 적용합니다.
    const versionRow = rawDb.exec('PRAGMA user_version');
    let version = versionRow.length ? versionRow[0].values[0][0] : 0;
    while (version < SCHEMA_VERSION) {
      version += 1;
      const migrate = MIGRATIONS[version];
      if (migrate) migrate();
    }
  }
  rawDb.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  persist();

  const defaults = {
    notifications_enabled: '1',
    default_reminder_interval: '30'
  };
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    if (!getSetting.get(key)) setSetting.run(key, value);
  }

  return db;
}

function getDb() {
  if (!rawDb) throw new Error('DB가 초기화되지 않았습니다.');
  return db;
}

module.exports = { init, getDb };
