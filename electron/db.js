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
  }
};

async function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  dbPath = path.join(userDataDir, 'work-checklist.db');

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });

  const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  rawDb = existing ? new SQL.Database(existing) : new SQL.Database();

  db.pragma('foreign_keys = ON');

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
