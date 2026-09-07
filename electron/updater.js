'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4시간마다 재확인
const INSTALL_DELAY_MS = 5000; // 다운로드 완료 후 자동 재시작까지 대기 시간

let manualCheck = null;

function sendStatus(mainWindow, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', payload);
  }
}

function setup(mainWindow) {
  // 패키징(설치)된 앱에서만 동작합니다. `npm start`로 켠 개발 모드에서는
  // 업데이트 서버(GitHub Releases)에 올라간 버전이 없어 의미가 없으므로 건너뜁니다.
  if (!app.isPackaged) {
    console.log('[updater] 개발 모드에서는 자동 업데이트를 건너뜁니다.');
    manualCheck = () => {
      sendStatus(mainWindow, {
        state: 'error',
        message: '개발 모드(npm start)에서는 업데이트 확인을 할 수 없습니다. 설치된 프로그램에서만 동작합니다.'
      });
    };
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendStatus(mainWindow, { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus(mainWindow, { state: 'downloading', version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendStatus(mainWindow, { state: 'up-to-date', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus(mainWindow, { state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] 업데이트 확인 중 오류:', err);
    sendStatus(mainWindow, { state: 'error', message: err.message });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus(mainWindow, { state: 'ready', version: info.version, delayMs: INSTALL_DELAY_MS });
    // 사용자가 건너뛸 수 없도록, 안내 후 일정 시간 뒤 자동으로 종료 및 설치합니다.
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, INSTALL_DELAY_MS);
  });

  const checkNow = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] 업데이트 확인 실패(오프라인일 수 있음):', err.message);
    });
  };
  manualCheck = checkNow;

  checkNow();
  setInterval(checkNow, CHECK_INTERVAL_MS);
}

function checkForUpdateNow() {
  if (manualCheck) manualCheck();
}

module.exports = { setup, checkForUpdateNow };
