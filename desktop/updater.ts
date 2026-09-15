import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateState = {
  kind: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev';
  version?: string;
  current?: string;
  percent?: number;
  message?: string;
  auto: boolean;
  packaged: boolean;
};

type Host = {
  getWindow: () => BrowserWindow | undefined;
  prepareQuit: () => void;
  getAuto: () => boolean;
  setAuto: (on: boolean) => void;
  packaged: () => boolean;
  version: () => string;
};

let host: Host | undefined;
let last: UpdateState = {
  kind: 'idle',
  auto: true,
  packaged: false,
};

function emit(patch: Partial<UpdateState>): void {
  last = {
    ...last,
    ...patch,
    auto: host?.getAuto() ?? last.auto,
    packaged: host?.packaged() ?? last.packaged,
    current: host?.version() ?? last.current,
  };
  host?.getWindow()?.webContents.send('grok-update', last);
}

function packaged(): boolean {
  return host?.packaged() ?? false;
}

export function updateSnapshot(): UpdateState {
  return { ...last, auto: host?.getAuto() ?? last.auto, packaged: packaged() };
}

export function attachUpdater(next: Host): void {
  host = next;
  last.packaged = next.packaged();
  last.auto = next.getAuto();
  last.current = next.version();

  autoUpdater.autoDownload = next.getAuto();
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    emit({ kind: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    emit({ kind: 'available', version: info.version });
    if (host?.getAuto()) {
      void autoUpdater.downloadUpdate();
    }
  });
  autoUpdater.on('update-not-available', () => {
    emit({ kind: 'none' });
  });
  autoUpdater.on('download-progress', (progress) => {
    emit({ kind: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emit({ kind: 'ready', version: info.version });
    try {
      const { Notification } = require('electron') as typeof import('electron');
      if (Notification.isSupported()) {
        new Notification({
          title: 'OpenGrok',
          body: `版本 ${info.version} 已下载，重启后安装。`,
        }).show();
      }
    } catch {
      /* optional */
    }
  });
  autoUpdater.on('error', (error) => {
    emit({ kind: 'error', message: error?.message || String(error) });
  });

  if (packaged() && next.getAuto()) {
    setTimeout(() => {
      void checkForUpdates();
    }, 8000);
  }
}

export async function checkForUpdates(): Promise<UpdateState> {
  last.packaged = packaged();
  last.auto = host?.getAuto() ?? last.auto;
  if (!packaged()) {
    emit({ kind: 'dev' });
    return updateSnapshot();
  }
  try {
    emit({ kind: 'checking' });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    emit({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  return updateSnapshot();
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!packaged()) {
    emit({ kind: 'dev' });
    return updateSnapshot();
  }
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    emit({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  return updateSnapshot();
}

export function installUpdate(): void {
  host?.prepareQuit();
  autoUpdater.quitAndInstall(false, true);
}

export function setAutoUpdate(on: boolean): UpdateState {
  host?.setAuto(on);
  autoUpdater.autoDownload = on;
  emit({ auto: on });
  return updateSnapshot();
}
