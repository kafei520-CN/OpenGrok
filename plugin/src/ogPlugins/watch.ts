import { existsSync, watch, type FSWatcher } from 'node:fs';

export function watchOgPluginDirs(dirs: string[], onChange: () => void): { close(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, 250);
  };
  const watchers: FSWatcher[] = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) {
      continue;
    }
    try {
      watchers.push(
        watch(dir, { recursive: true }, (_event, filename) => {
          const name = String(filename ?? '');
          if (name.endsWith('~') || name.endsWith('.swp') || name.startsWith('.#')) {
            return;
          }
          kick();
        }),
      );
    } catch {
      /* directory may not be watchable */
    }
  }
  return {
    close() {
      if (timer) {
        clearTimeout(timer);
      }
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
