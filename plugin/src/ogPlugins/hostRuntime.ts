import { createRequire } from 'node:module';
import { logWarn } from '../core/logger';
import type { GrokController } from '../chat/controller';
import type { OgDispatchMessage, OgDispatchNext, OgDispatchWrap, OgHostPlugin, OgPluginInfo } from './types';

const wraps: OgDispatchWrap[] = [];
let postUi: ((payload: unknown) => void) | undefined;

export function resetOgHostPlugins(): void {
  wraps.length = 0;
}

export function bindOgPostToUi(fn: (payload: unknown) => void): void {
  postUi = fn;
}

function registerWrap(wrap: OgDispatchWrap): void {
  wraps.push(wrap);
}

function loadHostFn(file: string): OgHostPlugin | undefined {
  try {
    const req = createRequire(file);
    const resolved = req.resolve(file);
    delete req.cache[resolved];
    const mod = req(file) as { default?: OgHostPlugin } | OgHostPlugin;
    const fn = typeof mod === 'function' ? mod : mod?.default;
    return typeof fn === 'function' ? fn : undefined;
  } catch (error) {
    logWarn(`opengrok plugin host: ${file}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

export async function loadOgHostPlugins(
  controller: GrokController,
  plugins: OgPluginInfo[],
): Promise<void> {
  resetOgHostPlugins();
  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.hostPath) {
      continue;
    }
    const fn = loadHostFn(plugin.hostPath);
    if (!fn) {
      continue;
    }
    try {
      await fn({
        id: plugin.id,
        dir: plugin.dir,
        onDispatch: registerWrap,
        postToUi: (payload) => postUi?.(payload),
        controller,
      });
    } catch (error) {
      logWarn(`opengrok plugin ${plugin.id}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

export async function dispatchOgPlugins(
  message: OgDispatchMessage,
  core: OgDispatchNext,
): Promise<void> {
  if (!wraps.length) {
    await core(message);
    return;
  }
  let index = 0;
  const next: OgDispatchNext = async (msg) => {
    const wrap = wraps[index];
    index += 1;
    if (!wrap) {
      await core(msg);
      return;
    }
    await wrap(msg, next);
  };
  await next(message);
}
