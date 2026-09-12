import { plat } from './platform';

export function logInfo(message: string): void {
  try {
    plat().log('info', message);
  } catch {
    console.log(`[info] ${message}`);
  }
}

export function logWarn(message: string): void {
  try {
    plat().log('warn', message);
  } catch {
    console.warn(`[warn] ${message}`);
  }
}

export function logError(message: string, error?: unknown): void {
  try {
    plat().log('error', message, error);
  } catch {
    console.error(`[error] ${message}`, error);
  }
}

export function showLog(): void {
  try {
    plat().showLog();
  } catch {
    /* no platform yet */
  }
}
