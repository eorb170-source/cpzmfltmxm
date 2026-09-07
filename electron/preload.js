'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 업무(템플릿) 관리
  listTasks: (activeOnly = true) => ipcRenderer.invoke('tasks:list', activeOnly),
  createTask: (task) => ipcRenderer.invoke('tasks:create', task),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  archiveTask: (id) => ipcRenderer.invoke('tasks:archive', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),

  // 오늘의 체크리스트
  getTodayChecklist: () => ipcRenderer.invoke('instances:today'),
  toggleInstance: (instanceId, done) => ipcRenderer.invoke('instances:toggle', instanceId, done),

  // 이력
  getHistory: (filter) => ipcRenderer.invoke('instances:history', filter),

  // 연봉협상 자료
  getSummaryReport: (range) => ipcRenderer.invoke('report:summary', range),
  exportSummaryPdf: (range) => ipcRenderer.invoke('report:exportPdf', range),

  // 설정
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  // 자동 업데이트 상태 알림
  onUpdateStatus: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  }
});
