import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { buildFileDiff, type FileDiff } from './diff';
import { logError } from '../core/logger';
import { tr } from '../core/i18n/locale';
import { plat } from '../core/platform';
import {
  deleteStoredTurns,
  editTurnIndex,
  findTurn,
  readStoredTurns,
  removeTurn,
  storedFileMatches,
  trimTurns,
  upsertTurn,
  writeStoredTurns,
  type StoredFileDiff,
  type StoredTurnDiff,
} from '../session/sessionDiffs';
import {
  MAX_SNAPSHOT_CHARS,
  addSnapshot,
  alreadyCaptured,
  isProbablyText,
  normalizeFsPath,
  pickBeforeAfter,
  planRevert,
  sameText,
  type FileSnapshot,
} from '../session/snapshots';
import type { ChatMessage } from '../core/types';

const execFileAsync = promisify(execFile);

export class EditJournal {
  private readonly snapshots = new Map<string, FileSnapshot[]>();
  private readonly remembering = new Map<string, Promise<void>>();
  private turns: StoredTurnDiff[] = [];
  private loadedFor?: string;
  private hydrateJob?: Promise<void>;

  constructor(
    private readonly host: {
      messages: () => ChatMessage[];
      replaying: () => boolean;
      cwd: () => string;
      sessionId: () => string | undefined;
      displayPath: (filePath: string) => string;
      emit: () => void;
    },
  ) {}

  clear(): void {
    this.snapshots.clear();
    this.turns = [];
    this.loadedFor = undefined;
  }

  resolvePath(filePath: string): string | undefined {
    if (!filePath) {
      return undefined;
    }
    if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
      return filePath;
    }
    const folder = plat().workspaceFolders()[0];
    if (folder) {
      return path.join(folder, filePath);
    }
    return filePath;
  }

  assistant(messageId?: string): ChatMessage | undefined {
    const messages = this.host.messages();
    if (messageId) {
      return messages.find((item) => item.id === messageId && item.role === 'assistant');
    }
    return (
      [...messages]
        .reverse()
        .find((item) => item.role === 'assistant' && (item.edits?.length ?? 0) > 0) ??
      messages.filter((item) => item.role === 'assistant').at(-1)
    );
  }

  async remember(filePath: string): Promise<void> {
    const last = this.host.messages().at(-1);
    const assistant =
      last?.role === 'assistant'
        ? last
        : this.host.messages().filter((item) => item.role === 'assistant').at(-1);
    if (!assistant || this.host.replaying()) {
      return;
    }
    const abs = this.resolvePath(filePath);
    if (!abs) {
      return;
    }
    const key = `${assistant.id}:${normalizeFsPath(abs)}`;
    const inflight = this.remembering.get(key);
    if (inflight) {
      await inflight;
      return;
    }
    const current = this.snapshots.get(assistant.id) ?? [];
    if (alreadyCaptured(current, abs)) {
      return;
    }
    const work = this.captureFromDisk(assistant.id, abs);
    this.remembering.set(key, work);
    try {
      await work;
    } finally {
      this.remembering.delete(key);
    }
  }

  private async captureFromDisk(messageId: string, abs: string): Promise<void> {
    const current = this.snapshots.get(messageId) ?? [];
    if (alreadyCaptured(current, abs)) {
      return;
    }
    let snap: FileSnapshot;
    try {
      const bytes = await plat().readFile(abs);
      if (!isProbablyText(bytes) || bytes.byteLength > MAX_SNAPSHOT_CHARS) {
        snap = {
          absPath: abs,
          displayPath: this.host.displayPath(abs),
          existed: true,
          source: 'disk',
        };
      } else {
        snap = {
          absPath: abs,
          displayPath: this.host.displayPath(abs),
          existed: true,
          previous: Buffer.from(bytes).toString('utf8'),
          source: 'disk',
        };
      }
    } catch {
      snap = {
        absPath: abs,
        displayPath: this.host.displayPath(abs),
        existed: false,
        previous: '',
        source: 'disk',
      };
    }
    this.snapshots.set(messageId, addSnapshot(this.snapshots.get(messageId) ?? [], snap));
  }

  capturePrevious(filePath: string, previous: string): void {
    const last = this.host.messages().at(-1);
    const assistant =
      last?.role === 'assistant'
        ? last
        : this.host.messages().filter((item) => item.role === 'assistant').at(-1);
    if (!assistant) {
      return;
    }
    const abs = this.resolvePath(filePath);
    if (!abs) {
      return;
    }
    const current = this.snapshots.get(assistant.id) ?? [];
    if (alreadyCaptured(current, abs)) {
      return;
    }
    this.snapshots.set(
      assistant.id,
      addSnapshot(current, {
        absPath: abs,
        displayPath: this.host.displayPath(abs),
        existed: previous.length > 0,
        previous,
        source: 'tool',
      }),
    );
  }

  async hydrateFromGit(): Promise<void> {
    if (!this.hydrateJob) {
      this.hydrateJob = this.hydrateTurns().finally(() => {
        this.hydrateJob = undefined;
      });
    }
    await this.hydrateJob;
  }

  private async hydrateTurns(): Promise<void> {
    await this.ensureLoaded();
    const assistants = this.host
      .messages()
      .filter((message) => message.role === 'assistant' && (message.edits?.length ?? 0) > 0);
    let dirty = false;
    for (let ordinal = 0; ordinal < assistants.length; ordinal += 1) {
      const message = assistants[ordinal];
      if (!message) {
        continue;
      }
      const stored = findTurn(this.turns, ordinal);
      if (stored) {
        this.installTurnSnapshots(message, stored);
        continue;
      }
      const files: StoredFileDiff[] = [];
      for (const edit of message.edits ?? []) {
        const abs = this.resolvePath(edit.path);
        if (!abs) {
          continue;
        }
        const current = this.snapshots.get(message.id) ?? [];
        const previous = await this.readGitHead(abs);
        if (
          previous !== undefined &&
          !current.some(
            (item) =>
              normalizeFsPath(item.absPath) === normalizeFsPath(abs) && item.source === 'git',
          )
        ) {
          this.snapshots.set(
            message.id,
            addSnapshot(current, {
              absPath: abs,
              displayPath: this.host.displayPath(abs),
              existed: true,
              previous,
              source: 'git',
            }),
          );
        }
        const after = (await this.readCurrentText(abs)) ?? '';
        if (previous === undefined && after === '') {
          continue;
        }
        const before = previous ?? '';
        if (sameText(before, after)) {
          continue;
        }
        if (before.length > MAX_SNAPSHOT_CHARS || after.length > MAX_SNAPSHOT_CHARS) {
          continue;
        }
        files.push({
          path: this.host.displayPath(abs),
          absPath: abs,
          before,
          after,
        });
      }
      if (files.length === 0) {
        continue;
      }
      this.turns = upsertTurn(this.turns, ordinal, files);
      const next = findTurn(this.turns, ordinal);
      if (next) {
        this.installTurnSnapshots(message, next);
      }
      dirty = true;
    }
    if (dirty) {
      await this.flushTurns();
    }
  }

  async revert(
    messageId?: string,
    opts?: { silent?: boolean },
  ): Promise<'empty' | 'cancelled' | { restored: number; failed: number }> {
    const assistant = this.assistant(messageId);
    if (assistant && (this.snapshots.get(assistant.id) ?? []).length === 0) {
      await this.hydrateFromGit();
    }
    const snaps = assistant ? (this.snapshots.get(assistant.id) ?? []) : [];
    const plans = planRevert(snaps);
    if (plans.length === 0) {
      if (!opts?.silent) {
        plat().info(tr('revertNone'));
      }
      return 'empty';
    }
    if (!opts?.silent) {
      const ok = await plat().confirm(tr('revertConfirm', { n: plans.length }), tr('revertAction'));
      if (!ok) {
        return 'cancelled';
      }
    }
    const outcomes: Array<{ absPath: string; ok: boolean }> = [];
    for (const plan of plans) {
      try {
        if (plan.action === 'restore') {
          await this.restoreFile(plan.absPath, plan.previous);
          outcomes.push({ absPath: plan.absPath, ok: true });
        } else if (plan.action === 'delete') {
          await plat().deleteFile(plan.absPath, true);
          outcomes.push({ absPath: plan.absPath, ok: true });
        } else {
          outcomes.push({ absPath: plan.absPath, ok: false });
        }
      } catch (error) {
        outcomes.push({ absPath: plan.absPath, ok: false });
        logError(`revert ${plan.absPath}`, error);
      }
    }
    const restored = outcomes.filter((item) => item.ok).length;
    const failed = outcomes.filter((item) => !item.ok).length;
    if (assistant) {
      const ordinal = editTurnIndex(this.host.messages(), assistant.id);
      const failedPaths = new Set(
        outcomes.filter((item) => !item.ok).map((item) => normalizeFsPath(item.absPath)),
      );
      if (failedPaths.size > 0) {
        this.snapshots.set(
          assistant.id,
          snaps.filter((snap) => failedPaths.has(normalizeFsPath(snap.absPath))),
        );
        assistant.edits = (assistant.edits ?? []).filter((edit) => {
          const abs = this.resolvePath(edit.path) ?? edit.path;
          return failedPaths.has(normalizeFsPath(abs));
        });
        const turn = findTurn(this.turns, ordinal);
        if (turn) {
          this.turns = upsertTurn(
            this.turns,
            ordinal,
            turn.files.filter((file) => failedPaths.has(normalizeFsPath(file.absPath))),
          );
          void this.flushTurns();
        }
      } else {
        this.snapshots.delete(assistant.id);
        assistant.edits = undefined;
        if (ordinal >= 0) {
          this.turns = removeTurn(this.turns, ordinal);
          void this.flushTurns();
        }
      }
      this.host.emit();
    }
    if (!opts?.silent) {
      if (failed > 0) {
        plat().warn(tr('revertFailed', { n: failed }));
      } else {
        plat().info(tr('revertDone', { n: restored }));
      }
    }
    return { restored, failed };
  }

  async diffs(messageId?: string, onlyPath?: string): Promise<FileDiff[]> {
    await this.ensureLoaded();
    const assistant = this.assistant(messageId);
    if (assistant && !this.hasDiskSnapshot(assistant.id)) {
      const ordinal = editTurnIndex(this.host.messages(), assistant.id);
      let stored = findTurn(this.turns, ordinal);
      if (!stored && !assistant.streaming) {
        await this.hydrateFromGit();
        stored = findTurn(this.turns, ordinal);
      }
      if (stored) {
        return this.diffsFromStored(stored, onlyPath);
      }
    }
    const edits = assistant?.edits ?? [];
    const paths = onlyPath ? [onlyPath] : edits.map((edit) => edit.path);
    const files: FileDiff[] = [];
    const captured: StoredFileDiff[] = [];
    const seen = new Set<string>();
    for (const filePath of paths) {
      const pair = await this.readBeforeAfter(assistant, filePath);
      if (!pair) {
        continue;
      }
      const key = normalizeFsPath(pair.absPath);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const file = buildFileDiff({
        path: this.host.displayPath(pair.absPath),
        absPath: pair.absPath,
        before: pair.before,
        after: pair.after,
      });
      if (file.added === 0 && file.removed === 0 && !file.created && !file.deleted) {
        continue;
      }
      files.push(file);
      captured.push({
        path: file.path,
        absPath: file.absPath,
        before: pair.before,
        after: pair.after,
      });
    }
    if (assistant && !onlyPath && captured.length > 0 && this.hasDiskSnapshot(assistant.id)) {
      const ordinal = editTurnIndex(this.host.messages(), assistant.id);
      this.turns = upsertTurn(this.turns, ordinal, captured);
      void this.flushTurns();
    }
    return files;
  }

  async dropSession(sessionId: string): Promise<void> {
    if (this.loadedFor === sessionId) {
      this.turns = [];
      this.loadedFor = undefined;
    }
    await deleteStoredTurns(sessionId);
  }

  trimStoredTurns(): void {
    const count = this.host
      .messages()
      .filter((item) => item.role === 'assistant' && (item.edits?.length ?? 0) > 0).length;
    const next = trimTurns(this.turns, count);
    if (next === this.turns) {
      return;
    }
    this.turns = next;
    void this.flushTurns();
  }

  hasDiskSnapshot(messageId: string): boolean {
    return (this.snapshots.get(messageId) ?? []).some(
      (item) => item.source === 'disk' || item.source === undefined,
    );
  }

  private async readBeforeAfter(
    assistant: ChatMessage | undefined,
    filePath: string,
  ): Promise<{ absPath: string; before: string; after: string } | undefined> {
    const abs = this.resolvePath(filePath);
    if (!abs) {
      return undefined;
    }
    const pool = assistant
      ? (this.snapshots.get(assistant.id) ?? [])
      : [...this.snapshots.values()].flat();
    const snapshots = pool.filter(
      (item) => normalizeFsPath(item.absPath) === normalizeFsPath(abs),
    );
    const edit = assistant?.edits?.find(
      (item) => normalizeFsPath(this.resolvePath(item.path) ?? item.path) === normalizeFsPath(abs),
    );
    const afterDisk = (await this.readCurrentText(abs)) ?? '';
    const pair = pickBeforeAfter({
      snapshots,
      previous: edit?.previous,
      next: edit?.next,
      afterDisk,
    });
    if (!pair) {
      return undefined;
    }
    return { absPath: abs, before: pair.before, after: pair.after };
  }

  private async readCurrentText(abs: string): Promise<string | undefined> {
    const open = plat().openText?.(abs) ?? (await plat().readOpenText?.(abs));
    if (open !== undefined) {
      return open;
    }
    try {
      const bytes = await plat().readFile(abs);
      if (!isProbablyText(bytes)) {
        return undefined;
      }
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async readGitHead(absPath: string): Promise<string | undefined> {
    const folders = plat().workspaceFolders();
    const cwd =
      folders.find((folder) => isInside(folder, absPath)) ?? this.host.cwd();
    const rel = path.relative(cwd, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) {
      return undefined;
    }
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${rel}`], {
        cwd,
        windowsHide: true,
        maxBuffer: MAX_SNAPSHOT_CHARS,
      });
      return stdout;
    } catch {
      return undefined;
    }
  }

  private diffsFromStored(stored: StoredTurnDiff, onlyPath?: string): FileDiff[] {
    const files: FileDiff[] = [];
    const seen = new Set<string>();
    for (const item of stored.files) {
      if (onlyPath && !storedFileMatches(item, onlyPath)) {
        continue;
      }
      const key = normalizeFsPath(item.absPath || item.path);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const file = buildFileDiff({
        path: item.path,
        absPath: item.absPath,
        before: item.before,
        after: item.after,
      });
      if (file.added === 0 && file.removed === 0 && !file.created && !file.deleted) {
        continue;
      }
      files.push(file);
    }
    return files;
  }

  private installTurnSnapshots(assistant: ChatMessage, turn: StoredTurnDiff): void {
    let current = this.snapshots.get(assistant.id) ?? [];
    for (const file of turn.files) {
      current = addSnapshot(current, {
        absPath: file.absPath,
        displayPath: file.path,
        existed: file.before.length > 0,
        previous: file.before,
        source: 'session',
      });
    }
    this.snapshots.set(assistant.id, current);
  }

  private async ensureLoaded(): Promise<void> {
    const sessionId = this.host.sessionId();
    if (!sessionId) {
      this.loadedFor = undefined;
      this.turns = [];
      return;
    }
    if (this.loadedFor === sessionId) {
      return;
    }
    this.loadedFor = sessionId;
    this.turns = await readStoredTurns(sessionId);
  }

  private async flushTurns(): Promise<void> {
    const sessionId = this.host.sessionId();
    if (!sessionId) {
      return;
    }
    await writeStoredTurns(sessionId, this.turns);
  }

  private async restoreFile(absPath: string, previous: string): Promise<void> {
    const applied = await plat().applyText?.(absPath, previous);
    if (applied) {
      return;
    }
    await plat().writeFile(absPath, Buffer.from(previous, 'utf8'));
  }
}

function isInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
