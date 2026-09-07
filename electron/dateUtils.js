'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function nowTimeStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowIso() {
  return new Date().toISOString();
}

// 1 = Monday ... 7 = Sunday
function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function taskAppliesToDate(task, dateStr) {
  const config = JSON.parse(task.repeat_config || '{}');
  const { year, month, day } = parseDateStr(dateStr);

  switch (task.repeat_type) {
    case 'daily':
      return true;
    case 'weekly': {
      const weekdays = Array.isArray(config.weekdays) ? config.weekdays : [];
      return weekdays.includes(isoWeekday(dateStr));
    }
    case 'monthly': {
      const target = Math.min(Number(config.day) || 1, daysInMonth(year, month));
      return day === target;
    }
    case 'yearly': {
      const targetMonth = Number(config.month) || 1;
      const targetDay = Math.min(Number(config.day) || 1, daysInMonth(year, targetMonth));
      return month === targetMonth && day === targetDay;
    }
    case 'once':
      return config.date === dateStr;
    default:
      return false;
  }
}

// returns true if timeA ('HH:MM') <= timeB ('HH:MM')
function timeLte(timeA, timeB) {
  return timeA <= timeB;
}

function minutesBetween(isoA, isoB) {
  return Math.abs(new Date(isoB) - new Date(isoA)) / 60000;
}

module.exports = {
  pad,
  toDateStr,
  todayStr,
  nowTimeStr,
  nowIso,
  isoWeekday,
  daysInMonth,
  taskAppliesToDate,
  timeLte,
  minutesBetween
};
