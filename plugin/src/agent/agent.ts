import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  CLIENT_IDENTIFIER,
  EXT,
  PROTOCOL_VERSION,
  RELOAD_MODELS_TIMEOUT_MS,
} from '../core/constants';
import { logError, logInfo, logWarn } from '../core/logger';
import { JsonRpcConnection, RpcError } from './rpc';
import {
  forkSessionPayload,
  parseForkNewSessionId,
  parseWorktreeResume,
  worktreeResumePayload,
  type ForkParams,
} from '../core/runtime/fork';
import {
  parseActionOutcome,
  parseHookList,
  parseMarketplaceList,
  parsePluginList,
  parseWorkflowList,
} from '../hosts/extensions/extensionsHost';
import { parseRosterList, parseSubagentList } from '../models/roster';
import { parseTaskList } from '../hosts/tasks/tasksHost';
import { parseWorktreeApply, parseWorktreeList } from '../hosts/worktrees/worktreeHost';
import { parseSessionRow, sessionHasHistory } from '../session/sessionRow';
import { parseAccountInfo } from '../core/account';
import { asErrorText, asNum, asObject, asString, timesFromMeta } from '../core/wire';
import type {
  AccountInfo,
  AuthMethodWire,
  AuthUrlMode,
  ContentBlock,
  InitializeResult,
  RosterEntry,
  SessionNewResult,
  SessionRow,
  SessionUpdate,
  HookItem,
  MarketplacePlugin,
  PluginItem,
  SlashCommandInfo,
  SubagentLive,
  TaskItem,
  WorkflowItem,
  WorktreeApplyResult,
  WorktreeItem,
} from '../core/types';
import type { AuthMethodInfo } from '../billing/authMethods';

export interface AgentOptions {
  cliPath: string;
  cwd: string;
  extensionVersion: string;
  startupHints?: { skipGitStatus: boolean; skipProjectLayout: boolean };
}

export type IncomingHandler = (
  method: string,
  params: unknown,
  id: number | string,
) => Promise<unknown> | unknown;

export type AgentLostHandler = (error: Error) => void;

export class GrokAgent {
  private child: ChildProcessWithoutNullStreams;
  readonly rpc: JsonRpcConnection;
  initializeResult?: InitializeResult;
  sessionId?: string;
  private extensionVersion = '0.0.0';
  private startupHints?: AgentOptions['startupHints'];

  private constructor(
    child: ChildProcessWithoutNullStreams,
    rpc: JsonRpcConnection,
  ) {
    this.child = child;
    this.rpc = rpc;
  }

  static spawn(
    options: AgentOptions,
    onIncoming: IncomingHandler,
    onLost?: AgentLostHandler,
  ): GrokAgent {
    const args = ['agent', 'stdio'];
    logInfo(`spawning ${options.cliPath} ${args.join(' ')} (cwd=${options.cwd})`);
    const child = spawn(options.cliPath, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GROK_NO_AUTO_UPDATE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const rpc = new JsonRpcConnection(child.stdin);
    const agent = new GrokAgent(child, rpc);
    agent.extensionVersion = options.extensionVersion;
    agent.startupHints = options.startupHints;

    let ended = false;
    const lost = (error: Error) => {
      if (ended) {
        return;
      }
      ended = true;
      rpc.close(error);
      onLost?.(error);
    };

    rpc.on('log', (message: string) => logWarn(message));
    rpc.on('overflow', (error: Error) => {
      logError('ACP stdout overflow', error);
      lost(error);
      if (!child.killed) {
        child.kill();
      }
    });
    child.stdout.on('data', (chunk: Buffer) => {
      setImmediate(() => rpc.feed(chunk));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd();
      if (text) {
        logWarn(`agent stderr: ${text}`);
      }
    });
    child.on('error', (error) => {
      logError('failed to spawn grok agent', error);
      lost(error);
    });
    child.on('exit', (code, signal) => {
      logInfo(`agent exited code=${code} signal=${signal ?? ''}`);
      lost(new Error(`grok agent exited (${code ?? signal})`));
    });

    rpc.on('request', (method: string, params: unknown, id: number | string) => {
      Promise.resolve(onIncoming(method, params, id))
        .then((result) => rpc.respond(id, result ?? {}))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const code = error instanceof RpcError ? error.code ?? -32000 : -32000;
          logError(`client method ${method} failed`, error);
          rpc.respondError(id, message, code);
        });
    });
    rpc.on('notification', (method: string, params: unknown) => {
      void onIncoming(method, params, /* id */ '');
    });

    return agent;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async initialize(): Promise<InitializeResult> {
    const result = (await this.rpc.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'grok-vscode',
        version: this.extensionVersion,
      },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      _meta: {
        clientType: 'extension',
        clientIdentifier: CLIENT_IDENTIFIER,
        clientVersion: this.extensionVersion,
        ...(this.startupHints ? { startupHints: this.startupHints } : {}),
      },
    })) as InitializeResult;
    this.initializeResult = result;
    return result;
  }

  authMethods(): AuthMethodInfo[] {
    const raw = this.initializeResult?.authMethods ?? [];
    return raw.map(normalizeAuthMethod).filter((m): m is AuthMethodInfo => Boolean(m));
  }

  defaultAuthMethodId(): string | undefined {
    const meta = this.initializeResult?._meta;
    return asString(meta?.['defaultAuthMethodId']);
  }

  agentVersion(): string | undefined {
    return asString(this.initializeResult?._meta?.['agentVersion']);
  }

  async authenticate(
    methodId: string,
    meta?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.rpc.request('authenticate', {
      methodId,
      _meta: meta,
    });
  }

  async extMethod(
    method: string,
    params: unknown = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    const rpcMethod = method.startsWith('_') ? method : `_${method}`;
    return this.rpc.request(rpcMethod, params ?? {}, timeoutMs);
  }

  async getAuthUrl(): Promise<{ url?: string; mode?: AuthUrlMode }> {
    const raw = await this.extMethod(EXT.authGetUrl, {});
    const value = unwrapExt(raw);
    const url = asString(value['auth_url']);
    const mode = asString(value['mode']) as AuthUrlMode | undefined;
    return { url, mode };
  }

  async submitAuthCode(code: string): Promise<void> {
    await this.extMethod(EXT.authSubmitCode, { code });
  }

  async cancelAuth(requestSeq?: number): Promise<void> {
    await this.extMethod(EXT.authCancel, { request_seq: requestSeq });
  }

  async logout(): Promise<void> {
    await this.extMethod(EXT.authLogout, {});
  }

  async authInfo(): Promise<AccountInfo> {
    const raw = await this.extMethod(EXT.authInfo, {});
    return parseAccountInfo(unwrapExt(raw));
  }

  async setApiKey(key: string): Promise<void> {
    await this.extMethod(EXT.setApiKey, { key });
  }

  async newSession(
    cwd: string,
    extraMeta?: Record<string, unknown>,
  ): Promise<SessionNewResult> {
    const meta = { ...extraMeta };
    const authMethodId = asString(meta['authMethodId']);
    const params: Record<string, unknown> = {
      cwd,
      mcpServers: [],
      _meta: meta,
    };
    if (authMethodId) {
      params.authMethodId = authMethodId;
    }
    const result = (await this.rpc.request('session/new', params)) as SessionNewResult;
    this.sessionId = result.sessionId;
    return result;
  }

  async prompt(
    blocks: ContentBlock[],
    extraMeta?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    const id = sessionId ?? this.sessionId;
    if (!id) {
      throw new Error('No active session');
    }
    const params: Record<string, unknown> = {
      sessionId: id,
      prompt: blocks,
    };
    if (extraMeta && Object.keys(extraMeta).length > 0) {
      params._meta = extraMeta;
    }
    return this.rpc.request('session/prompt', params);
  }

  cancelTurn(): void {
    this.cancelSession(this.sessionId);
  }

  cancelSession(sessionId?: string): void {
    if (!sessionId) {
      return;
    }
    this.rpc.notify('session/cancel', {
      sessionId,
      _meta: { cancelTrigger: 'stop_click', cancelSubagents: true },
    });
  }

  clearSession(): void {
    this.sessionId = undefined;
  }

  async setModel(modelId: string, meta?: Record<string, unknown>): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    await this.rpc.request('session/set_model', {
      sessionId: this.sessionId,
      modelId,
      _meta: meta,
    });
  }

  async listModels(): Promise<Record<string, unknown>> {
    return unwrapExt(await this.extMethod(EXT.modelsList, {}));
  }

  async reloadModels(): Promise<void> {
    await this.extMethod(EXT.modelsReload, {}, RELOAD_MODELS_TIMEOUT_MS);
  }

  async listMcps(cache = false): Promise<unknown> {
    return this.extMethod(
      EXT.mcpList,
      this.sessionId ? { sessionId: this.sessionId, cache } : { cache },
    );
  }

  async toggleMcp(serverName: string, enabled: boolean): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }
    await this.extMethod(EXT.mcpToggle, {
      sessionId: this.sessionId,
      session_id: this.sessionId,
      serverName,
      server_name: serverName,
      enabled,
    });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    await this.rpc.request('session/set_mode', {
      sessionId: this.sessionId,
      modeId,
    });
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    extraMeta?: Record<string, unknown>,
  ): Promise<SessionNewResult> {
    const result = (await this.rpc.request('session/load', {
      sessionId,
      cwd,
      mcpServers: [],
      _meta: extraMeta,
    })) as SessionNewResult;
    this.sessionId = result.sessionId ?? sessionId;
    return result;
  }

  async compact(note?: string): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    await this.extMethod(EXT.compact, {
      sessionId: this.sessionId,
      userContext: note,
    });
  }

  async listRecentSessions(limit = 40): Promise<SessionRow[]> {
    const raw = await this.extMethod(EXT.sessionRecent, { limit });
    const value = unwrapExt(raw);
    const list = Array.isArray(value)
      ? value
      : Array.isArray(value['session_summaries'])
        ? (value['session_summaries'] as unknown[])
        : Array.isArray(value['sessions'])
          ? (value['sessions'] as unknown[])
          : [];
    return list
      .map(parseSessionRow)
      .filter((row): row is SessionRow => Boolean(row) && sessionHasHistory(row));
  }

  async sessionInfo(): Promise<Record<string, unknown>> {
    const raw = await this.extMethod(EXT.sessionInfo, {
      sessionId: this.sessionId,
    });
    return unwrapExt(raw);
  }

  async renameSession(title: string, resetToAuto = false, sessionId?: string): Promise<void> {
    const id = sessionId ?? this.sessionId;
    if (!id) {
      return;
    }
    await this.extMethod(EXT.sessionRename, {
      sessionId: id,
      title,
      resetToAuto,
    });
  }

  async deleteSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.sessionId;
    if (!id) {
      return;
    }
    await this.extMethod(EXT.sessionDelete, { sessionId: id });
  }

  async forkSession(params: ForkParams): Promise<string | undefined> {
    const raw = await this.extMethod(EXT.sessionFork, forkSessionPayload(params));
    return parseForkNewSessionId(raw) ?? parseForkNewSessionId(unwrapExt(raw));
  }

  async resumeInWorktree(
    sessionId: string,
    sourceCwd: string,
  ): Promise<{ sessionId: string; cwd: string } | undefined> {
    const raw = await this.extMethod(
      EXT.worktreeResume,
      worktreeResumePayload(sessionId, sourceCwd),
    );
    return parseWorktreeResume(raw) ?? parseWorktreeResume(unwrapExt(raw));
  }

  async listRoster(): Promise<RosterEntry[]> {
    const raw = await this.extMethod(EXT.sessionsRoster, {});
    const rows = parseRosterList(raw);
    return rows.length ? rows : parseRosterList(unwrapExt(raw));
  }

  async listRunningSubagents(sessionId?: string): Promise<SubagentLive[]> {
    const id = sessionId ?? this.sessionId;
    if (!id) {
      return [];
    }
    const raw = await this.extMethod(EXT.subagentList, { sessionId: id });
    const rows = parseSubagentList(raw);
    return rows.length ? rows : parseSubagentList(unwrapExt(raw));
  }

  async cancelSubagent(subagentId: string): Promise<void> {
    await this.extMethod(EXT.subagentCancel, { subagentId });
  }

  async listWorktrees(): Promise<WorktreeItem[]> {
    const raw = await this.extMethod(EXT.worktreeList, {
      include_all: true,
      includeAll: true,
      type: [],
    });
    return parseWorktreeList(raw);
  }

  async applyWorktree(
    sessionId: string,
    worktreePath: string,
    mode: 'merge' | 'overwrite',
  ): Promise<WorktreeApplyResult> {
    const raw = await this.extMethod(EXT.worktreeApply, {
      sessionId,
      worktreePath,
      mode,
    });
    return parseWorktreeApply(raw);
  }

  async removeWorktree(idOrPath: string): Promise<void> {
    await this.extMethod(EXT.worktreeRemove, { idOrPath, id_or_path: idOrPath });
  }

  async listPlugins(): Promise<PluginItem[]> {
    const raw = await this.extMethod(EXT.pluginsList, this.sessionPayload());
    return parsePluginList(raw);
  }

  async pluginAction(action: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
    const raw = await this.extMethod(EXT.pluginsAction, {
      ...this.sessionPayload(),
      action,
    });
    return parseActionOutcome(raw);
  }

  async listHooks(): Promise<HookItem[]> {
    const raw = await this.extMethod(EXT.hooksList, this.sessionPayload());
    return parseHookList(raw);
  }

  async hookAction(action: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
    const raw = await this.extMethod(EXT.hooksAction, {
      ...this.sessionPayload(),
      action,
    });
    return parseActionOutcome(raw);
  }

  async listMarketplace(): Promise<MarketplacePlugin[]> {
    const raw = await this.extMethod(EXT.marketplaceList, {});
    return parseMarketplaceList(raw);
  }

  async marketplaceAction(action: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
    const raw = await this.extMethod(EXT.marketplaceAction, {
      ...this.sessionPayload(),
      action,
    });
    return parseActionOutcome(raw);
  }

  async listWorkflows(): Promise<WorkflowItem[]> {
    const raw = await this.extMethod(EXT.workflowsList, this.sessionPayload());
    return parseWorkflowList(raw);
  }

  async listTasks(): Promise<TaskItem[]> {
    if (!this.sessionId) {
      return [];
    }
    const raw = await this.extMethod(EXT.taskList, this.sessionPayload());
    return parseTaskList(raw);
  }

  async killTask(taskId: string): Promise<void> {
    await this.extMethod(EXT.taskKill, { ...this.sessionPayload(), taskId, task_id: taskId });
  }

  async flushMemory(): Promise<void> {
    await this.extMethod(EXT.memoryFlush, this.sessionPayload());
  }

  private sessionPayload(): Record<string, unknown> {
    return this.sessionId ? { sessionId: this.sessionId, session_id: this.sessionId } : {};
  }

  async usage(): Promise<Record<string, unknown>> {
    const raw = await this.extMethod(EXT.sessionUsage, {
      sessionId: this.sessionId,
    });
    return unwrapExt(raw);
  }

  async billing(): Promise<Record<string, unknown>> {
    const raw = await this.extMethod(EXT.billing, {});
    return unwrapExt(raw);
  }

  async rewindPoints(): Promise<Array<{ index: number; preview?: string }>> {
    if (!this.sessionId) {
      return [];
    }
    const raw = await this.extMethod(EXT.rewindPoints, { sessionId: this.sessionId });
    const value = unwrapExt(raw);
    const points = value['rewind_points'] ?? value['rewindPoints'] ?? value;
    if (!Array.isArray(points)) {
      return [];
    }
    return points.map((item, i) => {
      const obj = asObject(item);
      return {
        index:
          typeof obj['prompt_index'] === 'number'
            ? obj['prompt_index']
            : typeof obj['index'] === 'number'
              ? obj['index']
              : i,
        preview:
          asString(obj['preview']) ??
          asString(obj['text']) ??
          asString(obj['prompt']) ??
          `Turn ${i + 1}`,
      };
    });
  }

  async rewindTo(index: number): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    await this.extMethod(EXT.rewindExecute, {
      sessionId: this.sessionId,
      targetPromptIndex: index,
    });
  }

  async commandsList(): Promise<SlashCommandInfo[]> {
    try {
      const raw = await this.extMethod(EXT.commandsList, {
        sessionId: this.sessionId,
      });
      const value = unwrapExt(raw);
      const list =
        (value['availableCommands'] as unknown[]) ??
        (value['commands'] as unknown[]) ??
        (Array.isArray(value) ? value : []);
      if (!Array.isArray(list)) {
        return this.availableCommands();
      }
      return list
        .map(parseCommand)
        .filter((cmd): cmd is SlashCommandInfo => Boolean(cmd?.name));
    } catch {
      return this.availableCommands();
    }
  }

  availableCommands(): SlashCommandInfo[] {
    const raw = this.initializeResult?._meta?.['availableCommands'];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map(parseCommand)
      .filter((cmd): cmd is SlashCommandInfo => Boolean(cmd?.name));
  }

  async promptHistory(): Promise<string[]> {
    const raw = await this.extMethod(EXT.promptHistory, {
      sessionId: this.sessionId,
      cwd: undefined,
    });
    const value = unwrapExt(raw);
    const list =
      (value['prompts'] as unknown[]) ??
      (value['history'] as unknown[]) ??
      (Array.isArray(value) ? value : []);
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((item) =>
        typeof item === 'string' ? item : asString(asObject(item)['text']) ?? '',
      )
      .filter(Boolean);
  }

  async extDump(method: string, extra?: Record<string, unknown>): Promise<string> {
    const raw = await this.extMethod(method, {
      sessionId: this.sessionId,
      ...extra,
    });
    return JSON.stringify(unwrapExt(raw), null, 2);
  }

  async interject(
    text: string,
    images?: Array<{ mimeType: string; data: string }>,
  ): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const content: Array<Record<string, string>> = [];
    if (text.trim()) {
      content.push({ type: 'text', text });
    }
    for (const image of images ?? []) {
      content.push({ type: 'image', mimeType: image.mimeType, data: image.data });
    }
    await this.extMethod(EXT.interject, {
      sessionId: this.sessionId,
      text,
      ...(content.length ? { content } : {}),
    });
  }

  async sendFeedback(text: string): Promise<void> {
    await this.extMethod(EXT.feedback, {
      session_id: this.sessionId,
      feedback_text: text,
    });
  }

  async setPrivacyOptOut(optOut: boolean): Promise<void> {
    await this.extMethod(EXT.privacySet, { optOut });
  }

  dispose(): void {
    this.rpc.close();
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}

export function parseSessionUpdate(params: unknown): {
  sessionId?: string;
  isReplay: boolean;
  update: SessionUpdate;
} {
  const obj = asObject(params);
  const update = asObject(obj['update']);
  const fields = asObject(update['fields']);
  const meta = asObject(obj['_meta'] ?? obj['meta']);
  const updateMeta = asObject(update['_meta'] ?? update['meta']);
  const noticeTimes = timesFromMeta(meta);
  const updateTimes = timesFromMeta(updateMeta);
  return {
    sessionId:
      asString(obj['sessionId']) ??
      asString(obj['session_id']) ??
      asString(update['sessionId']) ??
      asString(update['session_id']) ??
      asString(meta['sessionId']) ??
      asString(meta['session_id']),
    isReplay:
      meta['isReplay'] === true ||
      updateMeta['isReplay'] === true ||
      meta['is_replay'] === true,
    update: {
      sessionUpdate: asString(update['sessionUpdate'])?.toLowerCase(),
      content: update['content'] as SessionUpdate['content'],
      toolCallId: asString(update['toolCallId']) ?? asString(update['tool_call_id']),
      title: asString(update['title']),
      kind: asString(update['kind']),
      status: asString(update['status']),
      type: asString(update['type']),
      attempt: asNum(update['attempt']),
      maxRetries: asNum(update['maxRetries']) ?? asNum(update['max_retries']),
      attempts: asNum(update['attempts']),
      reason: asErrorText(update['reason']),
      errorType: asString(update['errorType']) ?? asString(update['error_type']),
      message: asErrorText(update['message']),
      error: asErrorText(update['error']),
      isRateLimited: update['isRateLimited'] === true || update['is_rate_limited'] === true,
      rawInput:
        update['rawInput'] ??
        update['raw_input'] ??
        fields['rawInput'] ??
        fields['raw_input'],
      rawOutput:
        update['rawOutput'] ??
        update['raw_output'] ??
        fields['rawOutput'] ??
        fields['raw_output'],
      locations: (update['locations'] ?? fields['locations']) as SessionUpdate['locations'],
      currentModelId: asString(update['currentModelId']),
      currentModeId:
        asString(update['currentModeId']) ?? asString(update['modeId']),
      modeId: asString(update['modeId']),
      availableCommands: Array.isArray(update['availableCommands'])
        ? (update['availableCommands'] as SlashCommandInfo[])
        : undefined,
      used: asNum(update['used']),
      size: asNum(update['size']),
      total: asNum(update['total']),
      turnStartMs: updateTimes.turnStartMs ?? noticeTimes.turnStartMs,
      streamStartMs: updateTimes.streamStartMs ?? noticeTimes.streamStartMs,
      agentTimestampMs: updateTimes.agentTimestampMs ?? noticeTimes.agentTimestampMs,
      entries:
        update['entries'] ??
        update['todos'] ??
        asObject(update['plan'])['entries'],
      objective: asString(update['objective']),
    },
  };
}

export function textFromContent(content: SessionUpdate['content']): string {
  if (!content) {
    return '';
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map((block) => block.text ?? '').join('');
}

export function imagesFromContent(
  content: SessionUpdate['content'],
): Array<{ mimeType: string; data?: string; uri?: string }> {
  if (!content) {
    return [];
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter((block) => block.type === 'image' || Boolean(block.data) || Boolean(block.mimeType))
    .filter((block) => block.type === 'image' || (block.mimeType?.startsWith('image/') ?? false))
    .map((block) => ({
      mimeType: block.mimeType ?? 'image/png',
      data: block.data,
      uri: block.uri,
    }));
}

function normalizeAuthMethod(raw: AuthMethodWire): AuthMethodInfo | undefined {
  const record = raw as unknown as Record<string, unknown>;
  const nested = asObject(record['agent'] ?? record);
  const id = raw.id ?? asString(nested['id']) ?? asString(record['methodId']);
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: raw.name ?? asString(nested['name']) ?? id,
    description: raw.description ?? asString(nested['description']),
    meta: raw._meta ?? raw.meta ?? asObject(nested['_meta'] ?? nested['meta']),
  };
}

function unwrapExt(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    return { sessions: raw };
  }
  const obj = asObject(raw);
  const inner = obj['result'];
  if (Array.isArray(inner)) {
    return { sessions: inner };
  }
  if (inner && typeof inner === 'object') {
    return asObject(inner);
  }
  return obj;
}

function parseCommand(item: unknown): SlashCommandInfo | undefined {
  const obj = asObject(item);
  const name = asString(obj['name']);
  if (!name) {
    return undefined;
  }
  const input = asObject(obj['input']);
  return {
    name,
    description: asString(obj['description']) ?? name,
    hint: asString(obj['hint']) ?? asString(input['hint']),
  };
}
