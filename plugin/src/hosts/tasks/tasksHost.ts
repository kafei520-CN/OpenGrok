import type { TaskItem } from '../../core/types';
import { asNum, asObject, asString, unwrapArray } from '../../core/wire';

export function parseTaskList(raw: unknown): TaskItem[] {
  return unwrapArray(raw, ['tasks'])
    .map((item) => {
      const obj = asObject(item);
      const id = asString(obj['task_id']) ?? asString(obj['taskId']);
      if (!id) {
        return undefined;
      }
      const command =
        asString(obj['display_command']) ??
        asString(obj['displayCommand']) ??
        asString(obj['command']) ??
        id;
      const completed = Boolean(obj['completed']);
      return {
        id,
        command,
        cwd: asString(obj['cwd']) ?? '',
        kind: asString(obj['kind']) ?? 'bash',
        completed,
        exitCode: asNum(obj['exit_code']) ?? asNum(obj['exitCode']),
        truncated: Boolean(obj['truncated']),
      } satisfies TaskItem;
    })
    .filter((row): row is TaskItem => Boolean(row));
}
