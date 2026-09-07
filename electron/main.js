'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbModule = require('./db');
const scheduler = require('./scheduler');
const reports = require('./reports');
const { todayStr } = require('./dateUtils');

let mainWindow;
let db;
let schedulerHandle;

const VALID_REPEAT_TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'once'];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function validateTaskInput(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim()) {
    throw new Error('업무 제목을 입력해 주세요.');
  }
  if (!VALID_REPEAT_TYPES.includes(input.repeat_type)) {
    throw new Error('반복 유형이 올바르지 않습니다.');
  }
  if (input.due_time && !/^\d{2}:\d{2}$/.test(input.due_time)) {
    throw new Error('예정 시간 형식이 올바르지 않습니다. (HH:MM)');
  }
}

function registerIpcHandlers() {
  ipcMain.handle('tasks:list', (event, activeOnly = true) => {
    const query = activeOnly
      ? 'SELECT * FROM tasks WHERE active = 1 ORDER BY category, title'
      : 'SELECT * FROM tasks ORDER BY category, title';
    return db.prepare(query).all();
  });

  ipcMain.handle('tasks:create', (event, input) => {
    validateTaskInput(input);
    const stmt = db.prepare(`
      INSERT INTO tasks (title, category, memo, repeat_type, repeat_config, due_time, reminder_enabled, reminder_interval_minutes)
      VALUES (@title, @category, @memo, @repeat_type, @repeat_config, @due_time, @reminder_enabled, @reminder_interval_minutes)
    `);
    const info = stmt.run({
      title: input.title.trim(),
      category: input.category ? input.category.trim() : '',
      memo: input.memo || '',
      repeat_type: input.repeat_type,
      repeat_config: JSON.stringify(input.repeat_config || {}),
      due_time: input.due_time || null,
      reminder_enabled: input.reminder_enabled ? 1 : 0,
      reminder_interval_minutes: input.reminder_interval_minutes || 30
    });
    scheduler.generateInstancesForDate(db, todayStr());
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  });

  ipcMain.handle('tasks:update', (event, id, patch) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) throw new Error('업무를 찾을 수 없습니다.');
    const merged = { ...existing, ...patch };
    validateTaskInput(merged);
    db.prepare(`
      UPDATE tasks SET title=@title, category=@category, memo=@memo, repeat_type=@repeat_type,
        repeat_config=@repeat_config, due_time=@due_time, reminder_enabled=@reminder_enabled,
        reminder_interval_minutes=@reminder_interval_minutes, active=@active
      WHERE id=@id
    `).run({
      id,
      title: merged.title.trim(),
      category: merged.category ? merged.category.trim() : '',
      memo: merged.memo || '',
      repeat_type: merged.repeat_type,
      repeat_config:
        typeof merged.repeat_config === 'string' ? merged.repeat_config : JSON.stringify(merged.repeat_config || {}),
      due_time: merged.due_time || null,
      reminder_enabled: merged.reminder_enabled ? 1 : 0,
      reminder_interval_minutes: merged.reminder_interval_minutes || 30,
      active: merged.active ? 1 : 0
    });
    scheduler.generateInstancesForDate(db, todayStr());
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });

  ipcMain.handle('tasks:archive', (event, id) => {
    db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('tasks:delete', (event, id) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('instances:today', () => {
    const today = todayStr();
    return db
      .prepare(
        `SELECT ti.id as instance_id, ti.status, ti.completed_at, ti.notify_count,
                t.id as task_id, t.title, t.category, t.memo, t.repeat_type, t.due_time
         FROM task_instances ti
         JOIN tasks t ON t.id = ti.task_id
         WHERE ti.instance_date = ?
         ORDER BY (t.due_time IS NULL), t.due_time, t.category, t.title`
      )
      .all(today);
  });

  ipcMain.handle('instances:toggle', (event, instanceId, done) => {
    db.prepare(
      `UPDATE task_instances SET status = ?, completed_at = ? WHERE id = ?`
    ).run(done ? 'done' : 'pending', done ? new Date().toISOString() : null, instanceId);
    return true;
  });

  ipcMain.handle('instances:history', (event, filter = {}) => {
    const start = filter.start || '0000-01-01';
    const end = filter.end || '9999-12-31';
    const clauses = ['ti.instance_date BETWEEN ? AND ?'];
    const params = [start, end];
    if (filter.category) {
      clauses.push('t.category = ?');
      params.push(filter.category);
    }
    if (filter.repeatType) {
      clauses.push('t.repeat_type = ?');
      params.push(filter.repeatType);
    }
    if (filter.status) {
      clauses.push('ti.status = ?');
      params.push(filter.status);
    }
    const query = `
      SELECT ti.id as instance_id, ti.instance_date, ti.status, ti.completed_at,
             t.title, t.category, t.repeat_type
      FROM task_instances ti
      JOIN tasks t ON t.id = ti.task_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY ti.instance_date DESC, t.category, t.title
    `;
    return db.prepare(query).all(...params);
  });

  ipcMain.handle('report:summary', (event, range = {}) => {
    const start = range.start || todayStr();
    const end = range.end || todayStr();
    return reports.getCompletionSummary(db, start, end);
  });

  ipcMain.handle('report:exportPdf', async (event, range = {}) => {
    const start = range.start || todayStr();
    const end = range.end || todayStr();
    const summary = reports.getCompletionSummary(db, start, end);
    const html = reports.renderSummaryHtml(summary);

    const tmpFile = path.join(os.tmpdir(), `work-checklist-report-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf-8');

    const pdfWindow = new BrowserWindow({ show: false });
    try {
      await pdfWindow.loadFile(tmpFile);
      const pdfBuffer = await pdfWindow.webContents.printToPDF({});

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '연봉협상 자료 저장',
        defaultPath: `업무수행요약_${start}_${end}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (canceled || !filePath) return { saved: false };
      fs.writeFileSync(filePath, pdfBuffer);
      return { saved: true, filePath };
    } finally {
      pdfWindow.destroy();
      fs.unlink(tmpFile, () => {});
    }
  });

  ipcMain.handle('settings:get', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return settings;
  });

  ipcMain.handle('settings:update', (event, patch) => {
    const stmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=@value'
    );
    const tx = db.transaction((entries) => {
      for (const [key, value] of entries) stmt.run({ key, value: String(value) });
    });
    tx(Object.entries(patch));
    return true;
  });
}

app.whenReady().then(async () => {
  db = await dbModule.init(path.join(app.getPath('userData')));
  registerIpcHandlers();
  createWindow();
  schedulerHandle = scheduler.start(db);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (schedulerHandle) clearInterval(schedulerHandle);
  if (process.platform !== 'darwin') app.quit();
});
