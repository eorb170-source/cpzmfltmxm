'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db;

function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'work-checklist.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
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
  if (!db) throw new Error('DB가 초기화되지 않았습니다.');
  return db;
}

module.exports = { init, getDb };
