import { parseSessionUpdate } from './agent';
import { handleTerminalMethod, isTerminalMethod } from './acpTerminal';
import { readWorkspaceFile, writeWorkspaceFile } from './clientHandlers';
import { handleMcpSdkCall } from '../core/runtime/imageTool';
import { logInfo } from '../core/logger';
import { RpcError } from './rpc';
import type { PermissionOption, SessionUpdate } from '../core/types';
import { asObject, asString } from '../core/wire';

export const METHOD_NOT_FOUND = -32601;

export interface IncomingHost {
  applyIncomingUpdate(update: SessionUpdate, isReplay: boolean, sessionId?: string): void;
  requestToolPermission(params: unknown): Promise<unknown>;
  journal: { remember(filePath: string): Promise<void> };
  rememberWorkspaceImage?(filePath: string, data: string): void;
  applyModelsUpdate?(params: unknown): void;
  refreshMcps?(): void;
  refreshDashboard?(): void;
  askUserQuestion?(params: unknown): Promise<unknown>;
  reviewPlan?(params: unknown): Promise<unknown>;
  allowsFileWrites?(): boolean;
}

export async function handleIncoming(
  controller: IncomingHost,
  method: string,
  params: unknown,
  id: number | string,
): Promise<unknown> {
  const name = method.startsWith('_') ? method.slice(1) : method;
  if (name === 'session/update' || name === 'x.ai/session_notification' || name === 'x.ai/session/update') {
    const parsed = parseSessionUpdate(params);
    controller.applyIncomingUpdate(parsed.update, parsed.isReplay, parsed.sessionId);
    return {};
  }
  if (name === 'x.ai/models/update') {
    controller.applyModelsUpdate?.(params);
    return {};
  }
  if (name === 'x.ai/mcp/servers_updated' || name === 'x.ai/mcp/tools_changed' || name === 'x.ai/mcp/server_status') {
    controller.refreshMcps?.();
    return {};
  }
  if (name === 'x.ai/sessions/changed') {
    controller.refreshDashboard?.();
    return {};
  }
  if (name === 'session/request_permission') {
    return controller.requestToolPermission(params);
  }
  if (name === 'x.ai/ask_user_question') {
    if (!controller.askUserQuestion) {
      throw new RpcError(`Method not found: ${method}`, METHOD_NOT_FOUND);
    }
    return controller.askUserQuestion(params);
  }
  if (name === 'x.ai/exit_plan_mode') {
    if (!controller.reviewPlan) {
      throw new RpcError(`Method not found: ${method}`, METHOD_NOT_FOUND);
    }
    return controller.reviewPlan(params);
  }
  if (name === 'x.ai/mcp/sdk_call') {
    return handleMcpSdkCall(params, (filePath, data) => {
      controller.rememberWorkspaceImage?.(filePath, data);
    });
  }
  if (name === 'x.ai/mcp/elicit') {
    // Headless Cancel: keep the turn alive instead of Method not found.
    return { outcome: 'cancel' };
  }
  if (name === 'x.ai/mcp/elicit_complete') {
    return {};
  }
  if (name === 'fs/read_text_file') {
    const result = await readWorkspaceFile(params);
    const filePath = asString(asObject(params)['path']);
    if (filePath && result._meta?.encoding === 'base64') {
      controller.rememberWorkspaceImage?.(filePath, result.content);
    }
    return result;
  }
  if (name === 'fs/write_text_file') {
    if (controller.allowsFileWrites && !controller.allowsFileWrites()) {
      throw new Error('Ask mode is read-only. Switch to Agent mode to edit files.');
    }
    const filePath = asString(asObject(params)['path']);
    if (filePath) {
      await controller.journal.remember(filePath);
    }
    return writeWorkspaceFile(params);
  }
  if (isTerminalMethod(name)) {
    return handleTerminalMethod(name, params);
  }
  if (id === '') {
    logInfo(`unhandled ACP notification ${method}`);
    return {};
  }
  logInfo(`unhandled ACP client method ${method}`);
  throw new RpcError(`Method not found: ${method}`, METHOD_NOT_FOUND);
}

export function parsePermissionOptions(params: unknown): {
  title: string;
  details?: string;
  toolKind?: string;
  options: PermissionOption[];
} {
  const obj = asObject(params);
  const toolCall = asObject(obj['toolCall']);
  const options = Array.isArray(obj['options'])
    ? (obj['options'] as Record<string, unknown>[])
        .map((option) => ({
          optionId:
            asString(option['optionId']) ?? asString(option['option_id']) ?? '',
          name: asString(option['name']) ?? 'Allow',
          kind: asString(option['kind']) ?? 'allow_once',
        }))
        .filter((option) => option.optionId)
    : [];
  return {
    title:
      asString(toolCall['title']) ?? asString(toolCall['kind']) ?? 'Grok wants to run a tool',
    details: describeToolInput(toolCall['rawInput']),
    toolKind: asString(toolCall['kind']),
    options,
  };
}

function describeToolInput(raw: unknown): string | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw === 'string') {
    return raw;
  }
  const obj = asObject(raw);
  return (
    asString(obj['command']) ??
    asString(obj['path']) ??
    asString(obj['query']) ??
    JSON.stringify(raw)
  );
}
