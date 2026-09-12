import { mergeContext, parseContextInfo } from './context';
import { logWarn } from '../core/logger';
import type { ContextUsage, SessionUpdate } from '../core/types';

export class ContextMeter {
  usage?: ContextUsage;

  constructor(
    private readonly host: {
      replaying: () => boolean;
      fetchInfo: () => Promise<unknown>;
      emit: () => void;
    },
  ) {}

  applyUpdate(update: SessionUpdate): boolean {
    if (update.sessionUpdate !== 'usage_update' && update.sessionUpdate !== 'session_info_update') {
      return false;
    }
    const parsed = parseContextInfo({
      used: update.used,
      size: update.size,
      total: update.total,
    });
    if (parsed) {
      this.usage = mergeContext(this.usage, parsed);
    }
    return update.sessionUpdate === 'usage_update';
  }

  async refresh(): Promise<void> {
    if (this.host.replaying()) {
      return;
    }
    try {
      const parsed = parseContextInfo(await this.host.fetchInfo());
      if (parsed) {
        this.usage = mergeContext(this.usage, parsed);
        this.host.emit();
      }
    } catch (error) {
      logWarn(`session info: ${error instanceof Error ? error.message : error}`);
    }
  }
}
