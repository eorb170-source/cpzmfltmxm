'use strict';

const { Notification } = require('electron');
const {
  todayStr,
  nowTimeStr,
  nowIso,
  taskAppliesToDate,
  timeLte,
  minutesBetween
} = require('./dateUtils');

let lastGeneratedDate = null;

function generateInstancesForDate(db, dateStr) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO task_instances (task_id, instance_date, status) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const task of tasks) {
      if (taskAppliesToDate(task, dateStr)) {
        insert.run(task.id, dateStr, 'pending');
      }
    }
  });
  tx();
}

function markPastPendingAsMissed(db, beforeDateStr) {
  db.prepare(
    `UPDATE task_instances SET status = 'missed'
     WHERE status = 'pending' AND instance_date < ?`
  ).run(beforeDateStr);
}

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function sendDueNotifications(db) {
  const notificationsEnabled = getSetting(db, 'notifications_enabled', '1') === '1';
  if (!notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const today = todayStr();
  const nowTime = nowTimeStr();

  const due = db
    .prepare(
      `SELECT ti.id as instance_id, ti.last_notified_at, ti.notify_count,
              t.id as task_id, t.title, t.due_time, t.reminder_enabled, t.reminder_interval_minutes
       FROM task_instances ti
       JOIN tasks t ON t.id = ti.task_id
       WHERE ti.instance_date = ?
         AND ti.status = 'pending'
         AND t.reminder_enabled = 1
         AND t.due_time IS NOT NULL
         AND t.due_time <= ?`
    )
    .all(today, nowTime);

  const touch = db.prepare(
    `UPDATE task_instances SET last_notified_at = ?, notify_count = notify_count + 1 WHERE id = ?`
  );

  for (const row of due) {
    const interval = Math.max(Number(row.reminder_interval_minutes) || 30, 1);
    const shouldNotify =
      !row.last_notified_at || minutesBetween(row.last_notified_at, new Date().toISOString()) >= interval;

    if (shouldNotify) {
      const notice = new Notification({
        title: '업무 체크 알림',
        body: `[${row.title}] 예정 시간(${row.due_time})이 지났는데 아직 체크되지 않았습니다.`
      });
      notice.show();
      touch.run(nowIso(), row.instance_id);
    }
  }
}

function tick(db) {
  const today = todayStr();
  if (lastGeneratedDate !== today) {
    if (lastGeneratedDate) {
      markPastPendingAsMissed(db, today);
    }
    generateInstancesForDate(db, today);
    lastGeneratedDate = today;
  }
  sendDueNotifications(db);
}

function start(db, intervalMs = 60 * 1000) {
  // run once immediately on startup, then on an interval
  tick(db);
  return setInterval(() => tick(db), intervalMs);
}

module.exports = {
  generateInstancesForDate,
  markPastPendingAsMissed,
  sendDueNotifications,
  tick,
  start
};
