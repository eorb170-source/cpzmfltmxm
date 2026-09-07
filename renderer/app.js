'use strict';

const REPEAT_LABEL = {
  daily: '데일리',
  weekly: '위클리',
  monthly: '먼슬리',
  yearly: '연간',
  once: '단발성'
};

const STATUS_LABEL = {
  pending: '대기',
  done: '완료',
  missed: '미완료(경과)'
};

const WEEKDAY_LABEL = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };

function $(selector) {
  return document.querySelector(selector);
}
function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- 탭 전환 ----------
function setupTabs() {
  $all('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach((b) => b.classList.remove('active'));
      $all('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'tasks') loadTasks();
      if (btn.dataset.tab === 'today') loadToday();
    });
  });
}

// ---------- 오늘의 체크리스트 ----------
async function loadToday() {
  $('#today-date').textContent = todayIso();
  const items = await window.api.getTodayChecklist();
  const container = $('#today-groups');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="muted">오늘 예정된 업무가 없습니다.</p>';
    return;
  }

  const groups = new Map();
  for (const item of items) {
    const key = REPEAT_LABEL[item.repeat_type] || item.repeat_type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const order = ['데일리', '위클리', '먼슬리', '연간', '단발성'];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => order.indexOf(a) - order.indexOf(b));

  for (const key of sortedKeys) {
    const groupEl = document.createElement('div');
    groupEl.className = 'category-group';
    groupEl.innerHTML = `<div class="category-group-title">${key}</div>`;
    for (const item of groups.get(key)) {
      const row = document.createElement('div');
      row.className = `checklist-item ${item.status}`;
      const statusBadge = item.status !== 'pending'
        ? `<span class="badge ${item.status}">${STATUS_LABEL[item.status]}</span>`
        : '';
      row.innerHTML = `
        <input type="checkbox" ${item.status === 'done' ? 'checked' : ''} data-instance-id="${item.instance_id}" />
        <span class="item-title">${escapeHtml(item.title)}</span>
        ${item.category ? `<span class="badge">${escapeHtml(item.category)}</span>` : ''}
        ${statusBadge}
        <span class="item-meta">${item.due_time ? '예정 ' + item.due_time : ''}</span>
      `;
      const checkbox = row.querySelector('input[type=checkbox]');
      checkbox.addEventListener('change', async () => {
        await window.api.toggleInstance(item.instance_id, checkbox.checked);
        loadToday();
      });
      groupEl.appendChild(row);
    }
    container.appendChild(groupEl);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------- 업무 관리 ----------
async function loadTasks() {
  const tasks = await window.api.listTasks(false);
  const tbody = $('#tasks-tbody');
  tbody.innerHTML = '';
  for (const task of tasks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.category || '-')}</td>
      <td>${describeRepeat(task)}</td>
      <td>${task.due_time || '-'}</td>
      <td>${task.reminder_enabled ? '사용' : '사용 안함'}</td>
      <td>${task.active ? '활성' : '보관됨'}</td>
      <td>
        <button data-action="edit" data-id="${task.id}">수정</button>
        <button data-action="${task.active ? 'archive' : 'delete'}" data-id="${task.id}">${task.active ? '보관' : '삭제'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('button[data-action=edit]').forEach((btn) => {
    btn.addEventListener('click', () => openTaskModal(Number(btn.dataset.id), tasks));
  });
  tbody.querySelectorAll('button[data-action=archive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.archiveTask(Number(btn.dataset.id));
      loadTasks();
    });
  });
  tbody.querySelectorAll('button[data-action=delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('이 업무를 완전히 삭제하시겠습니까? 관련 이력도 함께 삭제됩니다.')) {
        await window.api.deleteTask(Number(btn.dataset.id));
        loadTasks();
      }
    });
  });
}

function describeRepeat(task) {
  const label = REPEAT_LABEL[task.repeat_type] || task.repeat_type;
  const config = JSON.parse(task.repeat_config || '{}');
  if (task.repeat_type === 'weekly' && Array.isArray(config.weekdays)) {
    return `${label} (${config.weekdays.map((d) => WEEKDAY_LABEL[d]).join(',')})`;
  }
  if (task.repeat_type === 'monthly' && config.day) {
    return `${label} (매월 ${config.day}일)`;
  }
  if (task.repeat_type === 'yearly' && config.month && config.day) {
    return `${label} (${config.month}월 ${config.day}일)`;
  }
  if (task.repeat_type === 'once' && config.date) {
    return `${label} (${config.date})`;
  }
  return label;
}

function setRepeatConfigVisibility(type) {
  $all('.repeat-config').forEach((el) => el.classList.add('hidden'));
  const map = {
    weekly: '#repeat-config-weekly',
    monthly: '#repeat-config-monthly',
    yearly: '#repeat-config-yearly',
    once: '#repeat-config-once'
  };
  if (map[type]) $(map[type]).classList.remove('hidden');
}

function resetTaskForm() {
  $('#task-form').reset();
  $('#task-id').value = '';
  $('#task-modal-title').textContent = '새 업무 추가';
  setRepeatConfigVisibility('daily');
  $all('.weekday-picker input').forEach((cb) => (cb.checked = false));
}

function openTaskModal(taskId, taskList) {
  resetTaskForm();
  if (taskId) {
    const task = taskList.find((t) => t.id === taskId);
    if (!task) return;
    $('#task-modal-title').textContent = '업무 수정';
    $('#task-id').value = task.id;
    $('#task-title').value = task.title;
    $('#task-category').value = task.category || '';
    $('#task-repeat-type').value = task.repeat_type;
    $('#task-due-time').value = task.due_time || '';
    $('#task-reminder-enabled').checked = !!task.reminder_enabled;
    $('#task-reminder-interval').value = task.reminder_interval_minutes;
    $('#task-memo').value = task.memo || '';

    const config = JSON.parse(task.repeat_config || '{}');
    setRepeatConfigVisibility(task.repeat_type);
    if (task.repeat_type === 'weekly' && Array.isArray(config.weekdays)) {
      $all('.weekday-picker input').forEach((cb) => {
        cb.checked = config.weekdays.includes(Number(cb.value));
      });
    } else if (task.repeat_type === 'monthly') {
      $('#repeat-monthly-day').value = config.day || 1;
    } else if (task.repeat_type === 'yearly') {
      $('#repeat-yearly-month').value = config.month || 1;
      $('#repeat-yearly-day').value = config.day || 1;
    } else if (task.repeat_type === 'once') {
      $('#repeat-once-date').value = config.date || '';
    }
  }
  $('#task-modal').classList.remove('hidden');
}

function closeTaskModal() {
  $('#task-modal').classList.add('hidden');
}

function collectRepeatConfig(type) {
  if (type === 'weekly') {
    const weekdays = $all('.weekday-picker input:checked').map((cb) => Number(cb.value));
    return { weekdays };
  }
  if (type === 'monthly') {
    return { day: Number($('#repeat-monthly-day').value) || 1 };
  }
  if (type === 'yearly') {
    return { month: Number($('#repeat-yearly-month').value) || 1, day: Number($('#repeat-yearly-day').value) || 1 };
  }
  if (type === 'once') {
    return { date: $('#repeat-once-date').value || todayIso() };
  }
  return {};
}

function setupTaskForm() {
  $('#btn-new-task').addEventListener('click', () => openTaskModal(null, []));
  $('#btn-task-cancel').addEventListener('click', closeTaskModal);
  $('#task-repeat-type').addEventListener('change', (e) => setRepeatConfigVisibility(e.target.value));

  $('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const repeatType = $('#task-repeat-type').value;
    const payload = {
      title: $('#task-title').value,
      category: $('#task-category').value,
      repeat_type: repeatType,
      repeat_config: collectRepeatConfig(repeatType),
      due_time: $('#task-due-time').value || null,
      reminder_enabled: $('#task-reminder-enabled').checked,
      reminder_interval_minutes: Number($('#task-reminder-interval').value) || 30,
      memo: $('#task-memo').value,
      active: 1
    };

    try {
      const id = $('#task-id').value;
      if (id) {
        await window.api.updateTask(Number(id), payload);
      } else {
        await window.api.createTask(payload);
      }
      closeTaskModal();
      loadTasks();
      loadToday();
    } catch (err) {
      alert(err.message || '저장 중 오류가 발생했습니다.');
    }
  });
}

// ---------- 이력 ----------
async function loadHistory() {
  const filter = {
    start: $('#history-start').value || undefined,
    end: $('#history-end').value || undefined,
    status: $('#history-status').value || undefined
  };
  const rows = await window.api.getHistory(filter);
  const tbody = $('#history-tbody');
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.instance_date}</td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.category || '-')}</td>
      <td>${REPEAT_LABEL[row.repeat_type] || row.repeat_type}</td>
      <td>${STATUS_LABEL[row.status] || row.status}</td>
      <td>${row.completed_at ? new Date(row.completed_at).toLocaleString() : '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

function setupHistory() {
  $('#btn-history-search').addEventListener('click', loadHistory);
}

// ---------- 연봉협상 자료 ----------
function renderReport(summary) {
  const container = $('#report-result');
  if (summary.categories.length === 0) {
    container.innerHTML = '<p class="muted">해당 기간에 완료된 업무가 없습니다.</p>';
    return;
  }
  const statsHtml = `
    <div class="report-stats">
      <div class="report-stat"><div class="num">${summary.totalTasks}</div><div class="muted">수행 업무 종류</div></div>
      <div class="report-stat"><div class="num">${summary.totalCompletions}</div><div class="muted">총 완료 건수</div></div>
    </div>`;
  const tablesHtml = summary.categories
    .map((cat) => {
      const rows = cat.tasks
        .map(
          (t) => `<tr>
            <td>${escapeHtml(t.title)}</td>
            <td>${REPEAT_LABEL[t.repeatType] || t.repeatType}</td>
            <td>${t.completedCount}회</td>
            <td>${escapeHtml(t.memo || '')}</td>
          </tr>`
        )
        .join('');
      return `
        <h3>${escapeHtml(cat.category)} <span class="muted">(총 ${cat.totalCompletions}회)</span></h3>
        <table>
          <thead><tr><th>업무명</th><th>주기</th><th>완료 횟수</th><th>비고</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');
  container.innerHTML = statsHtml + tablesHtml;
}

function setupReport() {
  const start = todayIso();
  $('#report-start').value = start;
  $('#report-end').value = start;

  $('#btn-report-generate').addEventListener('click', async () => {
    const range = { start: $('#report-start').value, end: $('#report-end').value };
    const summary = await window.api.getSummaryReport(range);
    renderReport(summary);
  });

  $('#btn-report-pdf').addEventListener('click', async () => {
    const range = { start: $('#report-start').value, end: $('#report-end').value };
    const result = await window.api.exportSummaryPdf(range);
    if (result.saved) {
      alert(`PDF로 저장되었습니다:\n${result.filePath}`);
    }
  });
}

// ---------- 설정 ----------
async function loadSettings() {
  const settings = await window.api.getSettings();
  $('#setting-notifications').checked = settings.notifications_enabled === '1';
  $('#setting-interval').value = settings.default_reminder_interval || 30;
}

function setupSettings() {
  $('#btn-settings-save').addEventListener('click', async () => {
    await window.api.updateSettings({
      notifications_enabled: $('#setting-notifications').checked ? '1' : '0',
      default_reminder_interval: Number($('#setting-interval').value) || 30
    });
    alert('설정이 저장되었습니다.');
  });
}

// ---------- 초기화 ----------
function init() {
  setupTabs();
  setupTaskForm();
  setupHistory();
  setupReport();
  setupSettings();
  loadToday();
  loadSettings();

  const start = todayIso();
  $('#history-start').value = start;
  $('#history-end').value = start;

  // 오늘의 체크리스트는 알림/자정 갱신을 반영하기 위해 주기적으로 새로고침
  setInterval(() => {
    if ($('#tab-today').classList.contains('active')) loadToday();
  }, 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
