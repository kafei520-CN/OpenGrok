import type { WorktreeApplyResult, WorktreeItem } from '../../core/types';
import { asNum, asObject, asPath, asString, unwrapArray, unwrapPayload } from '../../core/wire';

export function parseWorktreeList(raw: unknown): WorktreeItem[] {
  return unwrapArray(raw, ['worktrees', 'records'])
    .map(parseWorktree)
    .filter((row): row is WorktreeItem => Boolean(row));
}

export function parseWorktreeApply(raw: unknown): WorktreeApplyResult {
  const value = unwrapPayload(raw);
  const status = (asString(value['status']) ?? '').toLowerCase();
  const conflicts = Array.isArray(value['conflicts']) ? value['conflicts'].length : 0;
  if (status === 'conflicts' || conflicts > 0) {
    return { ok: false, conflicts, message: `${conflicts} conflict(s)` };
  }
  const files = Array.isArray(value['files']) ? value['files'].length : 0;
  return { ok: true, files, message: asString(value['gitRoot']) ?? asString(value['git_root']) };
}

function parseWorktree(item: unknown): WorktreeItem | undefined {
  const obj = asObject(item);
  const id = asString(obj['id']);
  const wtPath = asPath(obj['path']);
  if (!id && !wtPath) {
    return undefined;
  }
  const meta = asObject(obj['metadata']);
  return {
    id: id ?? wtPath ?? '',
    path: wtPath ?? '',
    repoName: asString(obj['repo_name']) ?? asString(obj['repoName']) ?? '',
    sourceRepo: asPath(obj['source_repo']) ?? asPath(obj['sourceRepo']) ?? '',
    kind: asString(obj['kind']) ?? 'session',
    status: (asString(obj['status']) ?? 'alive').toLowerCase() === 'dead' ? 'dead' : 'alive',
    sessionId: asString(obj['session_id']) ?? asString(obj['sessionId']),
    gitRef: asString(obj['git_ref']) ?? asString(obj['gitRef']),
    label: asString(meta['label']) ?? asString(obj['label']),
    createdAt: asNum(obj['created_at']) ?? asNum(obj['createdAt']),
  };
}
