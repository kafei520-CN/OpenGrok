import * as path from 'node:path';
import { pathInsideAny } from '../../core/grokDirs';
import { tr } from '../../core/i18n/locale';
import { plat } from '../../core/platform';
import type { HostAction } from './slash';
import type { ChatMessage, ChatStatus, DrawerId, QueuedPrompt } from '../../core/types';

export interface SlashRuntime {
  status: ChatStatus;
  messages: ChatMessage[];
  queue: QueuedPrompt[];
  compactMode: boolean;
  timestamps: boolean;
  multiline: boolean;
  history?: string[];
  drawer?: DrawerId;
  drawerTab?: string;
  drawerBody?: string;
  agent?: {
    forkSession(params: {
      sourceSessionId: string;
      sourceCwd: string;
      newCwd: string;
      sessionKind?: string;
    }): Promise<string | undefined>;
    renameSession(title: string, resetToAuto?: boolean): Promise<void>;
    deleteSession(): Promise<void>;
    sessionInfo(): Promise<Record<string, unknown>>;
    usage(): Promise<Record<string, unknown>>;
    setPrivacyOptOut(optOut: boolean): Promise<void>;
    sendFeedback(text: string): Promise<void>;
    interject(text: string): Promise<void>;
    promptHistory(): Promise<string[]>;
    extDump(method: string, extra?: Record<string, unknown>): Promise<string>;
  };
  cwd(): string;
  emit(): void;
  note(text: string): void;
  newSession(): Promise<void>;
  resumePicker(): Promise<void>;
  openDashboard(): Promise<void>;
  openAgents(): void;
  login(): Promise<void>;
  logout(): Promise<void>;
  send(text: string): Promise<void>;
  compact(note?: string): Promise<void>;
  rewind(): Promise<void>;
  forkCurrent(): Promise<void>;
  renameListedSession(id?: string, title?: string, auto?: boolean): Promise<void>;
  deleteListedSession(id?: string): Promise<void>;
  copyLast(n?: number): void;
  exportChat(): Promise<void>;
  setMode(id: string): Promise<void>;
  setModel(id: string): Promise<void>;
  setEffort(level: string): Promise<void>;
  resolveModelId(name: string): string | undefined;
  sendAgentSlash(text: string): Promise<void>;
  openSettings(): void;
  openMcps(): void;
  openSkills(): void;
  openWorktrees(): void;
  openExt(tab?: string): void;
  openTasks(): Promise<void>;
  openMemory(): void;
  openPlan(): void;
  toggleUiFlag(flag: 'timestamps' | 'compactMode' | 'multiline'): void;
}

export async function runSlashAction(host: SlashRuntime, action: HostAction): Promise<void> {
  switch (action.kind) {
    case 'newSession':
      await host.newSession();
      return;
    case 'resume':
    case 'home':
      await host.resumePicker();
      return;
    case 'dashboard':
      await host.openDashboard();
      return;
    case 'agents':
      host.openAgents();
      return;
    case 'login':
      await host.login();
      return;
    case 'logout':
      await host.logout();
      return;
    case 'settings':
      host.openSettings();
      return;
    case 'docs':
      await openDocs(action.target);
      return;
    case 'copy':
      host.copyLast(action.n ?? 1);
      if (action.path) {
        await copyLastToPath(host, action.path);
      }
      return;
    case 'export':
      await host.exportChat();
      return;
    case 'quit':
      await plat().closeSidebar();
      return;
    case 'compact':
      await host.compact(action.note);
      return;
    case 'rewind':
      await host.rewind();
      return;
    case 'fork':
      await host.forkCurrent();
      return;
    case 'rename':
      await host.renameListedSession(undefined, action.title, action.auto);
      return;
    case 'delete':
      await host.deleteListedSession();
      return;
    case 'sessionInfo':
      await showJsonNote(host, 'Session', await host.agent?.sessionInfo());
      return;
    case 'usage':
      if (action.manage) {
        await plat().openExternal('https://console.x.ai');
        return;
      }
      await showJsonNote(host, 'Usage', await host.agent?.usage());
      return;
    case 'privacy': {
      const pick = await plat().pick('Privacy', [
        { label: 'Opt out of coding-data retention', value: 'out' },
        { label: 'Opt in', value: 'in' },
      ]);
      if (pick) {
        await host.agent?.setPrivacyOptOut(pick === 'out');
        host.note('Privacy setting updated.');
      }
      return;
    }
    case 'plan':
      if (host.status === 'streaming') {
        host.note(tr('busyLock'));
        return;
      }
      await host.setMode('plan');
      if (action.text) {
        await host.send(action.text);
      }
      return;
    case 'model':
      if (host.status === 'streaming') {
        host.note(tr('busyLock'));
        return;
      }
      if (action.name) {
        const id = host.resolveModelId(action.name);
        if (id) {
          await host.setModel(id);
        } else {
          host.note(`Unknown model: ${action.name}`);
        }
      }
      return;
    case 'effort':
      if (host.status === 'streaming') {
        host.note(tr('busyLock'));
        return;
      }
      if (action.level) {
        await host.setEffort(action.level);
      }
      return;
    case 'history':
      host.history = await host.agent?.promptHistory();
      host.drawer = 'history';
      host.emit();
      return;
    case 'feedback': {
      const text =
        action.text ?? (await plat().input('Feedback for Grok Build'));
      if (text) {
        await host.agent?.sendFeedback(text);
        host.note('Feedback sent.');
      }
      return;
    }
    case 'btw':
      if (action.text) {
        if (host.status === 'streaming') {
          try {
            await host.agent?.interject(action.text);
            host.note('Side question sent.');
          } catch {
            host.queue = [
              ...host.queue,
              { id: `user-queue-btw-${Date.now()}`, text: action.text, attachments: [] },
            ];
            host.emit();
          }
        } else {
          await host.send(action.text);
        }
      }
      return;
    case 'mcpSettings':
      host.openMcps();
      return;
    case 'worktrees':
      host.openWorktrees();
      return;
    case 'tasks':
      await host.openTasks();
      return;
    case 'memory':
      host.openMemory();
      return;
    case 'viewPlan':
      host.openPlan();
      return;
    case 'extensions':
      if (action.tab === 'skills') {
        host.openSkills();
        return;
      }
      host.openExt(action.tab);
      return;
    case 'editPrompt': {
      const filePath = path.join(host.cwd(), '.grok-prompt.md');
      await plat().writeFile(filePath, Buffer.from(''));
      await plat().openFile(filePath, false);
      host.note('Edit the prompt in the editor, then send it from the sidebar.');
      return;
    }
    case 'toggle':
      host.toggleUiFlag(action.flag);
      host.note(`${action.flag}: ${host[action.flag] ? 'on' : 'off'}`);
      return;
    case 'tutorial':
      host.note(
        [
          'Type a task and press Enter.',
          '`/` opens every CLI slash command.',
          '`@` attaches a workspace file.',
          '`Ctrl+Alt+G` attaches the selection.',
          '`/plan` enters plan mode. `/always-approve` skips prompts.',
          '`/resume` lists previous sessions. `/rewind` undoes turns.',
        ].join('\n'),
      );
      return;
    case 'changelog':
      await plat().openExternal('https://x.ai/build/changelog');
      return;
    case 'alwaysApprove':
      await host.sendAgentSlash('/always-approve');
      return;
    case 'pass':
    default:
      return;
  }
}

async function openDocs(target?: string): Promise<void> {
  if (!target || target === 'web') {
    await plat().openExternal('https://docs.x.ai/build/overview');
    return;
  }
  await plat().openExternal(
    `https://docs.x.ai/build/overview?q=${encodeURIComponent(target)}`,
  );
}

async function showJsonNote(
  host: SlashRuntime,
  title: string,
  value: Record<string, unknown> | undefined,
): Promise<void> {
  const text = value ? JSON.stringify(value, null, 2) : `${title}: (empty)`;
  host.note(`**${title}**\n\n\`\`\`json\n${text}\n\`\`\``);
}

async function copyLastToPath(host: SlashRuntime, rawPath: string): Promise<void> {
  const last = host.messages.filter((m) => m.role === 'assistant').at(-1);
  if (!last) {
    return;
  }
  const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(host.cwd(), rawPath);
  const roots = plat().workspaceFolders();
  const allowed = roots.length ? roots : [host.cwd()];
  if (!pathInsideAny(allowed, filePath, plat().os())) {
    host.note(tr('copyOutsideWorkspace'));
    return;
  }
  await plat().writeFile(filePath, Buffer.from(last.text, 'utf8'));
}

