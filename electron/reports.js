'use strict';

// 연봉협상 자료용: 기간 내 완료된 업무를 반복 유형/카테고리별로 집계
function getCompletionSummary(db, startDate, endDate) {
  const rows = db
    .prepare(
      `SELECT ti.instance_date, ti.completed_at, t.id as task_id, t.title, t.category, t.repeat_type, t.memo
       FROM task_instances ti
       JOIN tasks t ON t.id = ti.task_id
       WHERE ti.status = 'done' AND ti.instance_date BETWEEN ? AND ?
       ORDER BY t.category, t.title, ti.instance_date`
    )
    .all(startDate, endDate);

  const byCategory = new Map();
  for (const row of rows) {
    const categoryKey = row.category && row.category.trim() ? row.category.trim() : '미분류';
    if (!byCategory.has(categoryKey)) byCategory.set(categoryKey, new Map());
    const byTask = byCategory.get(categoryKey);
    if (!byTask.has(row.task_id)) {
      byTask.set(row.task_id, {
        title: row.title,
        repeatType: row.repeat_type,
        memo: row.memo,
        completedDates: []
      });
    }
    byTask.get(row.task_id).completedDates.push(row.instance_date);
  }

  const categories = [];
  for (const [category, byTask] of byCategory.entries()) {
    const tasks = Array.from(byTask.values()).map((t) => ({
      ...t,
      completedCount: t.completedDates.length
    }));
    const totalCompletions = tasks.reduce((sum, t) => sum + t.completedCount, 0);
    categories.push({ category, tasks, totalCompletions });
  }
  categories.sort((a, b) => b.totalCompletions - a.totalCompletions);

  const totalCompletions = categories.reduce((sum, c) => sum + c.totalCompletions, 0);
  const totalTasks = new Set(rows.map((r) => r.task_id)).size;

  return {
    startDate,
    endDate,
    totalCompletions,
    totalTasks,
    categories
  };
}

const REPEAT_LABEL = {
  daily: '데일리',
  weekly: '위클리',
  monthly: '먼슬리',
  yearly: '연간',
  once: '단발성'
};

function renderSummaryHtml(summary) {
  const rows = summary.categories
    .map((cat) => {
      const taskRows = cat.tasks
        .map(
          (t) => `
        <tr>
          <td>${escapeHtml(t.title)}</td>
          <td>${REPEAT_LABEL[t.repeatType] || t.repeatType}</td>
          <td style="text-align:right">${t.completedCount}회</td>
          <td>${escapeHtml(t.memo || '')}</td>
        </tr>`
        )
        .join('');
      return `
        <h3>${escapeHtml(cat.category)} <span class="muted">(총 ${cat.totalCompletions}회 완료)</span></h3>
        <table>
          <thead><tr><th>업무명</th><th>주기</th><th>완료 횟수</th><th>비고</th></tr></thead>
          <tbody>${taskRows}</tbody>
        </table>`;
    })
    .join('\n');

  return `<!doctype html>
  <html lang="ko">
  <head>
  <meta charset="utf-8" />
  <title>업무 수행 요약 (${summary.startDate} ~ ${summary.endDate})</title>
  <style>
    body { font-family: -apple-system, "Malgun Gothic", sans-serif; padding: 32px; color: #1a1a1a; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .period { color: #555; margin-bottom: 24px; }
    .stat-row { display: flex; gap: 24px; margin-bottom: 24px; }
    .stat { border: 1px solid #ddd; border-radius: 8px; padding: 12px 20px; }
    .stat .num { font-size: 22px; font-weight: 700; }
    .muted { color: #777; font-weight: 400; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; font-size: 13px; }
    th { background: #f5f5f5; text-align: left; }
  </style>
  </head>
  <body>
    <h1>업무 수행 요약 자료</h1>
    <div class="period">기간: ${summary.startDate} ~ ${summary.endDate}</div>
    <div class="stat-row">
      <div class="stat"><div class="num">${summary.totalTasks}</div><div>수행 업무 종류</div></div>
      <div class="stat"><div class="num">${summary.totalCompletions}</div><div>총 완료 건수</div></div>
    </div>
    ${rows || '<p>해당 기간에 완료된 업무가 없습니다.</p>'}
  </body>
  </html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

module.exports = { getCompletionSummary, renderSummaryHtml };
