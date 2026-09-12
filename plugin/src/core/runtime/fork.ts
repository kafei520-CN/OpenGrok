import * as path from 'node:path';
import { asObject, asString } from '../wire';

export interface ForkParams {
  sourceSessionId: string;
  sourceCwd: string;
  newCwd: string;
  sessionKind?: string;
  sourceWorkspaceDir?: string;
  newSessionId?: string;
}

/** Wire body for `x.ai/session/fork`. */
export function forkSessionPayload(params: ForkParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sourceSessionId: params.sourceSessionId,
    sourceCwd: params.sourceCwd,
    newCwd: params.newCwd,
    sessionKind: params.sessionKind ?? 'fork',
  };
  if (params.newSessionId) {
    payload.newSessionId = params.newSessionId;
  }
  if (params.sourceWorkspaceDir) {
    payload.sourceWorkspaceDir = params.sourceWorkspaceDir;
  }
  return payload;
}

export function parseForkNewSessionId(raw: unknown): string | undefined {
  const value = unwrapResult(raw);
  return (
    asString(value['newSessionId']) ??
    asString(value['new_session_id']) ??
    asString(value['sessionId']) ??
    asString(value['session_id'])
  );
}

export function worktreeResumePayload(
  sessionId: string,
  sourceCwd: string,
): Record<string, unknown> {
  return {
    sessionId,
    sourceCwd,
    copyMode: 'dirty',
  };
}

export function parseWorktreeResume(
  raw: unknown,
): { sessionId: string; cwd: string } | undefined {
  const value = unwrapResult(raw);
  const sessionId =
    asString(value['sessionId']) ??
    asString(value['session_id']) ??
    asString(value['newSessionId']);
  if (!sessionId) {
    return undefined;
  }
  const cwd =
    asString(value['effectiveCwd']) ??
    asString(value['effective_cwd']) ??
    asString(value['worktreePath']) ??
    asString(value['worktree_path']) ??
    '';
  return { sessionId, cwd };
}

/** Ancestor `.git` paths to probe, cwd first. */
export function gitProbePaths(cwd: string): string[] {
  const paths: string[] = [];
  let dir = path.resolve(cwd);
  for (let i = 0; i < 12; i += 1) {
    paths.push(path.join(dir, '.git'));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return paths;
}

function unwrapResult(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw);
  const inner = obj['result'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return asObject(inner);
  }
  return obj;
}
