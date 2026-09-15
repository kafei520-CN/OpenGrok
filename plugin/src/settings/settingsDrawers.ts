import {
  listApiEndpoints,
  removeApiEndpoint,
  saveApiEndpoint,
  setApiEndpointEnabled,
  toggleApiEndpoint,
  validateBaseUrl,
} from '../models/apiEndpoints';
import { API_MUTATION_GUARD_MS } from '../core/constants';
import {
  deleteAgent as removeAgentFile,
  importAgentFiles,
  listAgents,
  toggleAgent as toggleAgentFile,
} from '../hosts/agents/agentsHost';
import type { GrokAgent } from '../agent/agent';
import { tr } from '../core/i18n/locale';
import { logWarn } from '../core/logger';
import { parseMcpList } from '../hosts/mcp/mcpHost';
import { listMemoryFiles, latestPlan } from '../hosts/memory/memoryHost';
import { plat } from '../core/platform';
import {
  deletePersona as removePersonaFile,
  importPersonaFiles,
  listPersonas,
  togglePersona as togglePersonaFile,
} from '../hosts/personas/personasHost';
import { rosterFromHistory } from '../models/roster';
import {
  deleteRule as removeRuleFile,
  importRuleFiles,
  listRules,
  toggleRule as toggleRuleFile,
} from '../hosts/rules/rulesHost';
import { normalizeSetting, writeGrokSetting } from './settings';
import {
  deleteSkill as removeSkillDir,
  importSkillFolders,
  importSkillZips,
  listSkills,
  toggleSkill as toggleSkillDir,
} from '../hosts/skills/skillsHost';
import { mergeModelCatalog } from '../session/sessionUpdates';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LETTER_SPACING,
  FONT_EXTS,
  isFontFile,
  lockContrastEnabled,
  normalizeTheme,
} from './theme';
import {
  isWallpaperFile,
  WALLPAPER_IMAGE_EXTS,
  WALLPAPER_VIDEO_EXTS,
  withFontUrl,
  withWallpaperUrl,
} from './wallpaper';
import type {
  AgentDefItem,
  ApiEndpoint,
  ChatMessage,
  ChatState,
  ChatStatus,
  DrawerId,
  GrokSettings,
  HookItem,
  MarketplacePlugin,
  MemoryFile,
  McpItem,
  PersonaItem,
  PluginItem,
  RosterEntry,
  RuleItem,
  SessionRow,
  SettingsPage,
  SkillItem,
  SubagentLive,
  TaskItem,
  ThemeColors,
  ThemePatch,
  WorkflowItem,
  WorktreeItem,
} from '../core/types';

export interface SettingsHost {
  settingsOpen: boolean;
  settingsPage: SettingsPage;
  apiEditId?: string;
  drawer?: DrawerId;
  drawerBody?: string;
  rules: RuleItem[];
  skills: SkillItem[];
  apis: ApiEndpoint[];
  apisLoaded?: boolean;
  mcps: McpItem[];
  agents: AgentDefItem[];
  personas: PersonaItem[];
  roster: RosterEntry[];
  subagents: SubagentLive[];
  agentProfile?: string;
  worktrees: WorktreeItem[];
  plugins: PluginItem[];
  hooks: HookItem[];
  marketplace: MarketplacePlugin[];
  workflows: WorkflowItem[];
  tasks: TaskItem[];
  memoryFiles: MemoryFile[];
  extTab: 'plugins' | 'marketplace' | 'hooks' | 'workflows';
  theme: ThemeColors;
  compactMode: boolean;
  timestamps: boolean;
  multiline: boolean;
  sessions?: SessionRow[];
  currentSessionId?: string;
  messages: ChatMessage[];
  status: ChatStatus;
  models?: ChatState['models'];
  agent?: GrokAgent;
  dashSeq: number;
  dashTimer?: ReturnType<typeof setTimeout>;
  taskSeq: number;
  taskTimer?: ReturnType<typeof setTimeout>;
  modelsReloadSeq: number;
  lastApiMutation?: { id: string; at: number };
  emit(): void;
  refreshBilling(): void;
  refreshHeatmap(): void;
  fail(message: string, error?: unknown): void;
  loadSession(sessionId: string, sessionCwd?: string): Promise<void>;
  send(text: string): Promise<void>;
  sendAgentSlash(text: string): Promise<void>;
  setModel(modelId: string): Promise<void>;
  cancelTurn(): void;
  refreshSessionsSilent(): Promise<void>;
  respawnAgent(): void;
}

export function closeDrawer(host: SettingsHost): void {
  host.drawer = undefined;
  host.drawerBody = undefined;
  stopDashboardPoll(host);
  stopTaskPoll(host);
  host.emit();
}

export async function openDashboard(host: SettingsHost): Promise<void> {
  host.settingsOpen = false;
  host.drawer = 'dashboard';
  host.emit();
  await refreshDashboardInner(host);
}

export function refreshDashboard(host: SettingsHost): void {
  if (host.drawer !== 'dashboard') {
    return;
  }
  void refreshDashboardInner(host);
}

export function stopRosterSession(host: SettingsHost, sessionId: string): void {
  if (sessionId === host.currentSessionId) {
    host.cancelTurn();
    refreshDashboard(host);
    return;
  }
  host.agent?.cancelSession(sessionId);
  refreshDashboard(host);
}

export async function cancelSubagent(host: SettingsHost, subagentId: string): Promise<void> {
  try {
    await host.agent?.cancelSubagent(subagentId);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
  refreshDashboard(host);
}

export async function dashboardDispatch(
  host: SettingsHost,
  text: string,
  sessionId?: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  if (sessionId && sessionId !== host.currentSessionId) {
    const row = host.roster.find((item) => item.id === sessionId);
    await host.loadSession(sessionId, row?.cwd);
  } else {
    closeDrawer(host);
  }
  await host.send(trimmed);
}

export function stopDashboardPoll(host: SettingsHost): void {
  host.dashSeq += 1;
  if (host.dashTimer) {
    clearTimeout(host.dashTimer);
    host.dashTimer = undefined;
  }
}

export async function refreshDashboardInner(host: SettingsHost): Promise<void> {
  const seq = ++host.dashSeq;
  if (host.dashTimer) {
    clearTimeout(host.dashTimer);
    host.dashTimer = undefined;
  }
  try {
    try {
      host.roster = (await host.agent?.listRoster()) ?? [];
    } catch (error) {
      logWarn(`roster: ${error instanceof Error ? error.message : error}`);
      host.roster = [];
    }
    if (!host.roster.length) {
      if (!host.sessions?.length) {
        await host.refreshSessionsSilent();
      }
      host.roster = rosterFromHistory(
        host.sessions ?? [],
        host.currentSessionId,
        host.status === 'streaming',
      );
    }
    const sid = host.currentSessionId ?? host.agent?.sessionId;
    try {
      host.subagents = sid ? ((await host.agent?.listRunningSubagents(sid)) ?? []) : [];
    } catch (error) {
      logWarn(`subagents: ${error instanceof Error ? error.message : error}`);
      host.subagents = [];
    }
    if (seq === host.dashSeq) {
      host.emit();
    }
  } catch (error) {
    logWarn(`dashboard: ${error instanceof Error ? error.message : error}`);
  }
  if (host.drawer === 'dashboard' && seq === host.dashSeq) {
    host.dashTimer = setTimeout(() => {
      if (host.drawer === 'dashboard') {
        void refreshDashboardInner(host);
      }
    }, 2500);
  }
}

export function openSettings(host: SettingsHost): void {
  host.drawer = undefined;
  stopDashboardPoll(host);
  host.settingsOpen = true;
  host.settingsPage = 'main';
  host.refreshBilling();
  host.refreshHeatmap();
  host.emit();
  void refreshRules(host);
  void refreshSkills(host);
  void refreshApis(host);
  void refreshMcpsInner(host);
  void refreshAgents(host);
  void refreshPersonas(host);
}

export function closeSettings(host: SettingsHost): void {
  host.settingsOpen = false;
  host.settingsPage = 'main';
  host.apiEditId = undefined;
  host.emit();
}

function openSettingsPage(host: SettingsHost, page: SettingsPage, refresh?: () => void): void {
  host.settingsOpen = true;
  host.settingsPage = page;
  host.emit();
  refresh?.();
}

export function openRules(host: SettingsHost): void {
  openSettingsPage(host, 'rules', () => void refreshRules(host));
}

export function closeRules(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export async function importRules(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('settingsRulesImport'),
    filters: { Markdown: ['md'], Text: ['txt'] },
  });
  if (!picked?.length) {
    return;
  }
  const n = await importRuleFiles(picked);
  await refreshRules(host);
  plat().info(tr('settingsRulesImported', { n }));
}

export async function toggleRule(host: SettingsHost, id: string): Promise<void> {
  await toggleRuleFile(id);
  await refreshRules(host);
}

export async function deleteRule(host: SettingsHost, id: string): Promise<void> {
  const row = host.rules.find((item) => item.id === id);
  const ok = await plat().confirm(
    tr('settingsRulesDeleteConfirm', { name: row?.name ?? id }),
    tr('settingsRulesDelete'),
  );
  if (!ok) {
    return;
  }
  await removeRuleFile(id);
  await refreshRules(host);
}

export function openRule(id: string): void {
  void plat().openFile(id, false);
}

export async function refreshRules(host: SettingsHost): Promise<void> {
  try {
    host.rules = await listRules();
    host.emit();
  } catch (error) {
    logWarn(`rules list: ${error instanceof Error ? error.message : error}`);
  }
}

export function openSkills(host: SettingsHost): void {
  openSettingsPage(host, 'skills', () => void refreshSkills(host));
}

export function closeSkills(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export async function importSkillZip(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('settingsSkillsImportZip'),
    filters: { Zip: ['zip'] },
  });
  if (!picked?.length) {
    return;
  }
  const n = await importSkillZips(picked);
  await refreshSkills(host);
  plat().info(tr('settingsSkillsImported', { n }));
}

export async function importSkillFolder(host: SettingsHost): Promise<void> {
  const picked = await plat().openFolders({ title: tr('settingsSkillsImportFolder') });
  if (!picked?.length) {
    return;
  }
  const n = await importSkillFolders(picked);
  await refreshSkills(host);
  plat().info(tr('settingsSkillsImported', { n }));
}

export async function toggleSkill(host: SettingsHost, id: string): Promise<void> {
  await toggleSkillDir(id);
  await refreshSkills(host);
}

export async function deleteSkill(host: SettingsHost, id: string): Promise<void> {
  const row = host.skills.find((item) => item.id === id);
  const ok = await plat().confirm(
    tr('settingsSkillsDeleteConfirm', { name: row?.name ?? id }),
    tr('settingsSkillsDelete'),
  );
  if (!ok) {
    return;
  }
  await removeSkillDir(id);
  await refreshSkills(host);
}

export function openSkill(host: SettingsHost, id: string): void {
  const row = host.skills.find((item) => item.id === id);
  void plat().openFile(row?.skillFile ?? id, false);
}

export async function refreshSkills(host: SettingsHost): Promise<void> {
  try {
    host.skills = await listSkills();
    host.emit();
  } catch (error) {
    logWarn(`skills list: ${error instanceof Error ? error.message : error}`);
  }
}

export function openApis(host: SettingsHost): void {
  host.apiEditId = undefined;
  openSettingsPage(host, 'apis', () => void refreshApis(host));
}

export function closeApis(host: SettingsHost): void {
  host.apiEditId = undefined;
  host.settingsPage = 'main';
  host.emit();
}

export function openApiForm(host: SettingsHost, id?: string): void {
  host.settingsOpen = true;
  host.apiEditId = id?.trim() || undefined;
  host.settingsPage = 'api-form';
  host.emit();
}

export function closeApiForm(host: SettingsHost): void {
  host.apiEditId = undefined;
  openSettingsPage(host, 'apis', () => void refreshApis(host));
}

export function openTheme(host: SettingsHost): void {
  openSettingsPage(host, 'theme');
}

export function closeTheme(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export function openRemote(host: SettingsHost): void {
  openSettingsPage(host, 'remote');
}

export function closeRemote(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export function openThemePreview(host: SettingsHost): void {
  if (!host.theme.wallpaper) {
    return;
  }
  openSettingsPage(host, 'theme-preview');
}

export function closeThemePreview(host: SettingsHost): void {
  openSettingsPage(host, 'theme');
}

export function openMcps(host: SettingsHost): void {
  openSettingsPage(host, 'mcps', () => void refreshMcpsInner(host));
}

export function closeMcps(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export function openAgents(host: SettingsHost): void {
  host.drawer = undefined;
  stopDashboardPoll(host);
  host.settingsOpen = true;
  host.settingsPage = 'agents';
  host.emit();
  void refreshAgents(host);
  void refreshPersonas(host);
}

export function closeAgents(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export async function importAgents(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('settingsAgentsImport'),
    filters: { Markdown: ['md'], Text: ['txt'] },
  });
  if (!picked?.length) {
    return;
  }
  const n = await importAgentFiles(picked);
  await refreshAgents(host);
  plat().info(tr('settingsAgentsImported', { n }));
}

export async function toggleAgent(host: SettingsHost, id: string): Promise<void> {
  const row = host.agents.find((item) => item.id === id);
  if (!row?.filePath) {
    return;
  }
  await toggleAgentFile(row.filePath);
  await refreshAgents(host);
}

export async function deleteAgent(host: SettingsHost, id: string): Promise<void> {
  const row = host.agents.find((item) => item.id === id);
  if (!row?.filePath) {
    return;
  }
  const ok = await plat().confirm(
    tr('settingsAgentsDeleteConfirm', { name: row.name }),
    tr('settingsRulesDelete'),
  );
  if (!ok) {
    return;
  }
  await removeAgentFile(row.filePath);
  if (host.agentProfile === row.name) {
    await setAgentProfile(host, '');
  }
  await refreshAgents(host);
}

export function openAgent(host: SettingsHost, id: string): void {
  const row = host.agents.find((item) => item.id === id);
  if (row?.filePath) {
    void plat().openFile(row.filePath, false);
  }
}

export async function setAgentProfile(host: SettingsHost, name: string): Promise<void> {
  const next = name.trim() && name !== 'grok-build' ? name.trim() : undefined;
  host.agentProfile = next;
  await plat().setState('ui.agentProfile', next ?? '');
  host.emit();
  plat().info(tr('settingsAgentsApplied', { name: next ?? 'grok-build' }));
}

export async function importPersonas(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('settingsPersonasImport'),
    filters: { TOML: ['toml'] },
  });
  if (!picked?.length) {
    return;
  }
  const n = await importPersonaFiles(picked);
  await refreshPersonas(host);
  plat().info(tr('settingsPersonasImported', { n }));
}

export async function togglePersona(host: SettingsHost, id: string): Promise<void> {
  const row = host.personas.find((item) => item.id === id);
  if (!row) {
    return;
  }
  await togglePersonaFile(row.filePath);
  await refreshPersonas(host);
}

export async function deletePersona(host: SettingsHost, id: string): Promise<void> {
  const row = host.personas.find((item) => item.id === id);
  if (!row) {
    return;
  }
  const ok = await plat().confirm(
    tr('settingsPersonasDeleteConfirm', { name: row.name }),
    tr('settingsRulesDelete'),
  );
  if (!ok) {
    return;
  }
  await removePersonaFile(row.filePath);
  await refreshPersonas(host);
}

export function openPersona(host: SettingsHost, id: string): void {
  const row = host.personas.find((item) => item.id === id);
  if (row) {
    void plat().openFile(row.filePath, false);
  }
}

export async function refreshAgents(host: SettingsHost): Promise<void> {
  try {
    host.agents = await listAgents();
    host.emit();
  } catch (error) {
    logWarn(`agents list: ${error instanceof Error ? error.message : error}`);
  }
}

export async function refreshPersonas(host: SettingsHost): Promise<void> {
  try {
    host.personas = await listPersonas();
    host.emit();
  } catch (error) {
    logWarn(`personas list: ${error instanceof Error ? error.message : error}`);
  }
}

export function openWorktrees(host: SettingsHost): void {
  host.drawer = undefined;
  stopDashboardPoll(host);
  host.settingsOpen = true;
  host.settingsPage = 'worktrees';
  host.emit();
  void refreshWorktrees(host);
}

export function closeWorktrees(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export async function applyWorktree(host: SettingsHost, id: string): Promise<void> {
  const agent = host.agent;
  if (!agent) {
    return;
  }
  if (!host.worktrees.length) {
    await refreshWorktrees(host);
  }
  const wt =
    host.worktrees.find((item) => item.id === id || item.path === id) ??
    host.worktrees.find((item) => item.sessionId === id);
  const roster = host.roster.find((item) => item.id === id || item.cwd === id);
  const wtPath = wt?.path || roster?.cwd || id;
  const sessionId = wt?.sessionId ?? roster?.id ?? host.currentSessionId;
  if (!sessionId || !wtPath) {
    plat().warn(tr('settingsWorktreesNeedSession'));
    return;
  }
  const mode = await plat().pick(tr('settingsWorktreesApply'), [
    { label: tr('settingsWorktreesMerge'), description: tr('settingsWorktreesMergeHint'), value: 'merge' as const },
    {
      label: tr('settingsWorktreesOverwrite'),
      description: tr('settingsWorktreesOverwriteHint'),
      value: 'overwrite' as const,
    },
  ]);
  if (!mode) {
    return;
  }
  try {
    const result = await agent.applyWorktree(sessionId, wtPath, mode);
    if (result.ok) {
      plat().info(tr('settingsWorktreesApplyOk', { n: result.files ?? 0 }));
    } else {
      plat().warn(tr('settingsWorktreesApplyConflict', { n: result.conflicts ?? 0 }));
    }
    await refreshWorktrees(host);
  } catch (error) {
    host.fail('Worktree apply failed', error);
  }
}

export async function removeWorktree(host: SettingsHost, id: string): Promise<void> {
  const row = host.worktrees.find((item) => item.id === id);
  const ok = await plat().confirm(
    tr('settingsWorktreesRemoveConfirm', { name: row?.label ?? row?.path ?? id }),
    tr('settingsWorktreesRemove'),
  );
  if (!ok) {
    return;
  }
  try {
    await host.agent?.removeWorktree(row?.path ?? row?.id ?? id);
    plat().info(tr('settingsWorktreesRemoved'));
    await refreshWorktrees(host);
  } catch (error) {
    host.fail('Worktree remove failed', error);
  }
}

export async function refreshWorktrees(host: SettingsHost): Promise<void> {
  try {
    host.worktrees = (await host.agent?.listWorktrees()) ?? [];
    host.emit();
  } catch (error) {
    logWarn(`worktrees: ${error instanceof Error ? error.message : error}`);
    host.worktrees = [];
    host.emit();
  }
}

export function openExt(host: SettingsHost, tab?: string): void {
  host.drawer = undefined;
  stopDashboardPoll(host);
  host.settingsOpen = true;
  host.settingsPage = 'extensions';
  if (tab === 'marketplace' || tab === 'hooks' || tab === 'workflows' || tab === 'plugins') {
    host.extTab = tab;
  }
  host.emit();
  void refreshExt(host);
}

export function closeExt(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export function setExtTab(
  host: SettingsHost,
  tab: 'plugins' | 'marketplace' | 'hooks' | 'workflows',
): void {
  host.extTab = tab;
  host.emit();
  void refreshExt(host);
}

export async function togglePlugin(host: SettingsHost, id: string): Promise<void> {
  const row = host.plugins.find((item) => item.id === id);
  if (!row) {
    return;
  }
  const action = row.enabled
    ? { type: 'disable', pluginId: row.id }
    : { type: 'enable', pluginId: row.id };
  await runPluginAction(host, action);
}

export async function uninstallPlugin(host: SettingsHost, id: string): Promise<void> {
  const row = host.plugins.find((item) => item.id === id);
  if (!row) {
    return;
  }
  const ok = await plat().confirm(tr('settingsPluginsDeleteConfirm', { name: row.name }), tr('settingsRulesDelete'));
  if (!ok) {
    return;
  }
  await runPluginAction(host, { type: 'uninstall', pluginId: row.id, confirmed: true });
}

export async function toggleHook(host: SettingsHost, id: string): Promise<void> {
  const row = host.hooks.find((item) => item.id === id);
  if (!row) {
    return;
  }
  const action = row.enabled
    ? { type: 'disable', hookName: row.name }
    : { type: 'enable', hookName: row.name };
  try {
    const result = await host.agent?.hookAction(action);
    if (result && !result.ok) {
      plat().warn(result.message);
    }
    await refreshExt(host);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function installMarketplace(host: SettingsHost, id: string): Promise<void> {
  const row = host.marketplace.find((item) => item.id === id);
  if (!row) {
    return;
  }
  try {
    const result = await host.agent?.marketplaceAction({
      type: 'install',
      sourceUrlOrPath: row.sourceUrl,
      pluginRelativePath: row.relativePath,
    });
    plat().info(result?.message ?? tr('settingsMarketplaceInstalled'));
    await refreshExt(host);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function refreshMarketplace(host: SettingsHost): Promise<void> {
  try {
    await host.agent?.marketplaceAction({ type: 'refresh' });
  } catch (error) {
    logWarn(`marketplace refresh: ${error instanceof Error ? error.message : error}`);
  }
  await refreshExt(host);
}

export async function runWorkflow(host: SettingsHost, name: string): Promise<void> {
  closeSettings(host);
  await host.sendAgentSlash(`/workflow ${name}`);
}

async function runPluginAction(host: SettingsHost, action: Record<string, unknown>): Promise<void> {
  try {
    const result = await host.agent?.pluginAction(action);
    if (result && !result.ok) {
      plat().warn(result.message);
    } else if (result?.message) {
      plat().info(result.message);
    }
    await refreshExt(host);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function refreshExt(host: SettingsHost): Promise<void> {
  const tab = host.extTab;
  try {
    if (tab === 'plugins') {
      host.plugins = (await host.agent?.listPlugins()) ?? [];
    } else if (tab === 'hooks') {
      host.hooks = (await host.agent?.listHooks()) ?? [];
    } else if (tab === 'marketplace') {
      host.marketplace = (await host.agent?.listMarketplace()) ?? [];
    } else {
      host.workflows = (await host.agent?.listWorkflows()) ?? [];
    }
    host.emit();
  } catch (error) {
    logWarn(`extensions ${tab}: ${error instanceof Error ? error.message : error}`);
  }
}

export async function openTasks(host: SettingsHost): Promise<void> {
  host.settingsOpen = false;
  host.drawer = 'tasks';
  host.emit();
  await refreshTasksInner(host);
}

export async function killTask(host: SettingsHost, taskId: string): Promise<void> {
  try {
    await host.agent?.killTask(taskId);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
  await refreshTasksInner(host);
}

export function stopTaskPoll(host: SettingsHost): void {
  host.taskSeq += 1;
  if (host.taskTimer) {
    clearTimeout(host.taskTimer);
    host.taskTimer = undefined;
  }
}

export async function refreshTasksInner(host: SettingsHost): Promise<void> {
  const seq = ++host.taskSeq;
  if (host.taskTimer) {
    clearTimeout(host.taskTimer);
    host.taskTimer = undefined;
  }
  try {
    host.tasks = (await host.agent?.listTasks()) ?? [];
    const sid = host.currentSessionId ?? host.agent?.sessionId;
    host.subagents = sid ? ((await host.agent?.listRunningSubagents(sid)) ?? []) : [];
    if (seq === host.taskSeq) {
      host.emit();
    }
  } catch (error) {
    logWarn(`tasks: ${error instanceof Error ? error.message : error}`);
  }
  if (host.drawer === 'tasks' && seq === host.taskSeq) {
    host.taskTimer = setTimeout(() => {
      if (host.drawer === 'tasks') {
        void refreshTasksInner(host);
      }
    }, 2500);
  }
}

export function openMemory(host: SettingsHost): void {
  host.drawer = undefined;
  stopDashboardPoll(host);
  stopTaskPoll(host);
  host.settingsOpen = true;
  host.settingsPage = 'memory';
  host.emit();
  void refreshMemory(host);
}

export function closeMemory(host: SettingsHost): void {
  host.settingsPage = 'main';
  host.emit();
}

export function openMemoryFile(host: SettingsHost, id: string): void {
  const row = host.memoryFiles.find((item) => item.id === id);
  void plat().openFile(row?.filePath ?? id, false);
}

export async function flushMemory(host: SettingsHost): Promise<void> {
  if (!host.agent?.sessionId) {
    plat().warn(tr('settingsMemoryNeedSession'));
    return;
  }
  try {
    await host.agent.flushMemory();
    plat().info(tr('settingsMemoryFlushed'));
    await refreshMemory(host);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function refreshMemory(host: SettingsHost): Promise<void> {
  try {
    host.memoryFiles = await listMemoryFiles();
    host.emit();
  } catch (error) {
    logWarn(`memory: ${error instanceof Error ? error.message : error}`);
  }
}

export function openPlan(host: SettingsHost): void {
  const plan = latestPlan(host.messages);
  if (!plan) {
    plat().warn(tr('planEmpty'));
    return;
  }
  host.settingsOpen = false;
  host.drawer = 'plan';
  host.drawerBody = plan;
  host.emit();
}

export function refreshMcps(host: SettingsHost): void {
  if (!host.settingsOpen) {
    return;
  }
  void refreshMcpsInner(host);
}

export async function toggleMcp(host: SettingsHost, id: string): Promise<void> {
  const row = host.mcps.find((item) => item.id === id);
  if (!row) {
    return;
  }
  if (!host.agent?.sessionId) {
    plat().warn(tr('settingsMcpsNeedSession'));
    return;
  }
  try {
    await host.agent.toggleMcp(row.id, !row.enabled);
    await refreshMcpsInner(host);
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function refreshMcpsInner(host: SettingsHost): Promise<void> {
  if (!host.agent) {
    host.mcps = [];
    host.emit();
    return;
  }
  try {
    const raw = await host.agent.listMcps(false);
    host.mcps = parseMcpList(raw);
    host.emit();
  } catch (error) {
    logWarn(`mcp list: ${error instanceof Error ? error.message : error}`);
  }
}

export function themeForUi(theme: ThemeColors): ThemeColors {
  return withFontUrl(withWallpaperUrl(theme, plat()), plat());
}

export function setTheme(
  host: SettingsHost,
  primary: string,
  secondary: string,
  background?: string,
  patch?: ThemePatch,
): void {
  const next = normalizeTheme({
    ...host.theme,
    primary,
    secondary,
    background: background || undefined,
    wallpaper: patch?.wallpaper === '' ? undefined : (patch?.wallpaper ?? host.theme.wallpaper),
    wallpaperOpacity: patch?.wallpaperOpacity ?? host.theme.wallpaperOpacity,
    wallpaperScale: patch && 'wallpaperScale' in patch ? patch.wallpaperScale : host.theme.wallpaperScale,
    wallpaperX: patch && 'wallpaperX' in patch ? patch.wallpaperX : host.theme.wallpaperX,
    wallpaperY: patch && 'wallpaperY' in patch ? patch.wallpaperY : host.theme.wallpaperY,
    surface: patch?.surface === '' ? undefined : (patch?.surface ?? host.theme.surface),
    glassOpacity: patch?.glassOpacity ?? host.theme.glassOpacity,
    glassBlur: patch?.glassBlur ?? host.theme.glassBlur,
    chromeBlur: patch?.chromeBlur ?? host.theme.chromeBlur,
    chromeGlass: patch?.chromeGlass ?? host.theme.chromeGlass,
    chromeGlassOpacity: patch?.chromeGlassOpacity ?? host.theme.chromeGlassOpacity,
    fontPath: patch && 'fontPath' in patch ? patch.fontPath || undefined : host.theme.fontPath,
    fontSize: patch && 'fontSize' in patch ? patch.fontSize : host.theme.fontSize,
    letterSpacing: patch && 'letterSpacing' in patch ? patch.letterSpacing : host.theme.letterSpacing,
    fontColor: patch && 'fontColor' in patch ? patch.fontColor || undefined : host.theme.fontColor,
    lockContrast: patch && 'lockContrast' in patch ? patch.lockContrast : host.theme.lockContrast,
  });
  if (
    next.primary === host.theme.primary &&
    next.secondary === host.theme.secondary &&
    (next.background ?? '') === (host.theme.background ?? '') &&
    (next.wallpaper ?? '') === (host.theme.wallpaper ?? '') &&
    (next.wallpaperOpacity ?? 0) === (host.theme.wallpaperOpacity ?? 0) &&
    (next.wallpaperPath ?? '') === (host.theme.wallpaperPath ?? '') &&
    (next.wallpaperScale ?? 0) === (host.theme.wallpaperScale ?? 0) &&
    (next.wallpaperX ?? 0) === (host.theme.wallpaperX ?? 0) &&
    (next.wallpaperY ?? 0) === (host.theme.wallpaperY ?? 0) &&
    (next.surface ?? '') === (host.theme.surface ?? '') &&
    (next.glassOpacity ?? 0) === (host.theme.glassOpacity ?? 0) &&
    (next.glassBlur ?? 0) === (host.theme.glassBlur ?? 0) &&
    (next.chromeBlur ?? 0) === (host.theme.chromeBlur ?? 0) &&
    Boolean(next.chromeGlass) === Boolean(host.theme.chromeGlass) &&
    (next.chromeGlassOpacity ?? 0) === (host.theme.chromeGlassOpacity ?? 0) &&
    (next.fontPath ?? '') === (host.theme.fontPath ?? '') &&
    (next.fontSize ?? DEFAULT_FONT_SIZE) === (host.theme.fontSize ?? DEFAULT_FONT_SIZE) &&
    (next.letterSpacing ?? DEFAULT_LETTER_SPACING) ===
      (host.theme.letterSpacing ?? DEFAULT_LETTER_SPACING) &&
    (next.fontColor ?? '') === (host.theme.fontColor ?? '') &&
    lockContrastEnabled(next) === lockContrastEnabled(host.theme)
  ) {
    return;
  }
  host.theme = next;
  void plat().setState('ui.theme', next);
  host.emit();
}

export async function pickThemeWallpaper(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('themeWallpaperPick'),
    filters: {
      [tr('themeWallpaperPick')]: [...WALLPAPER_IMAGE_EXTS, ...WALLPAPER_VIDEO_EXTS],
      [tr('themeWallpaperImages')]: [...WALLPAPER_IMAGE_EXTS],
      [tr('themeWallpaperVideos')]: [...WALLPAPER_VIDEO_EXTS],
    },
  });
  const src = picked?.[0];
  if (!src) {
    return;
  }
  if (!isWallpaperFile(src)) {
    logWarn(`wallpaper type: ${path.extname(src)}`);
    return;
  }
  try {
    const ext = path.extname(src).toLowerCase() || '.png';
    const dest = path.join(plat().homeDir(), '.grok', `theme-wallpaper-${Date.now()}${ext}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    const prev = host.theme.wallpaperPath;
    if (prev && path.resolve(prev) !== path.resolve(dest) && path.basename(prev).startsWith('theme-wallpaper')) {
      void fs.unlink(prev).catch(() => undefined);
    }
    host.theme = normalizeTheme({
      ...host.theme,
      wallpaper: 'custom',
      wallpaperPath: dest,
    });
    void plat().setState('ui.theme', host.theme);
    host.emit();
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function pickThemeFont(host: SettingsHost): Promise<void> {
  const picked = await plat().openFiles({
    title: tr('themeFontPick'),
    filters: {
      [tr('themeFontPick')]: [...FONT_EXTS],
    },
  });
  const src = picked?.[0];
  if (!src) {
    return;
  }
  if (!isFontFile(src)) {
    logWarn(`font type: ${path.extname(src)}`);
    return;
  }
  try {
    const ext = path.extname(src).toLowerCase() || '.ttf';
    const dest = path.join(plat().homeDir(), '.grok', `theme-font-${Date.now()}${ext}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    const prev = host.theme.fontPath;
    if (prev && path.resolve(prev) !== path.resolve(dest) && path.basename(prev).startsWith('theme-font')) {
      void fs.unlink(prev).catch(() => undefined);
    }
    host.theme = normalizeTheme({
      ...host.theme,
      fontPath: dest,
    });
    void plat().setState('ui.theme', host.theme);
    host.emit();
  } catch (error) {
    plat().warn(error instanceof Error ? error.message : String(error));
  }
}

export async function saveApi(
  host: SettingsHost,
  input: {
    id?: string;
    name: string;
    model: string;
    baseUrl: string;
    backend: ApiEndpoint['backend'];
    apiKey?: string;
    contextWindow?: number;
  },
): Promise<void> {
  try {
    validateBaseUrl(input.baseUrl);
  } catch {
    plat().warn(tr('settingsApisUrlInvalid'));
    return;
  }
  try {
    const saved = await saveApiEndpoint({
      ...input,
      id: input.id?.trim() || undefined,
    });
    markApiMutation(host, saved);
    host.apiEditId = undefined;
    host.settingsPage = 'apis';
    await refreshApis(host);
    void reloadModelCatalog(host, saved.enabled ? saved.id : undefined);
    plat().info(tr('settingsApisSaved'));
  } catch (error) {
    logWarn(`api save: ${error instanceof Error ? error.message : error}`);
    plat().warn(tr('settingsApisUrlInvalid'));
  }
}

export async function deleteApi(host: SettingsHost, id: string): Promise<void> {
  const row = host.apis.find((item) => item.id === id);
  if (row?.builtin) {
    return;
  }
  const ok = await plat().confirm(
    tr('settingsApisDeleteConfirm', { name: row?.name ?? id }),
    tr('settingsApisDelete'),
  );
  if (!ok) {
    return;
  }
  await removeApiEndpoint(id);
  clearApiMutation(host, id);
  await refreshApis(host);
  void reloadModelCatalog(host);
}

export async function toggleApi(host: SettingsHost, id: string): Promise<void> {
  try {
    const saved = await toggleApiEndpoint(id);
    if (saved.builtin) {
      await refreshApis(host);
      if (!saved.enabled && host.models?.currentId === id) {
        const next = host.models.available.find((model) => model.id !== id);
        if (next) {
          await host.setModel(next.id);
        }
      }
      host.emit();
      return;
    }
    if (saved.enabled) {
      markApiMutation(host, saved);
    } else {
      clearApiMutation(host, id);
    }
    await refreshApis(host);
    void reloadModelCatalog(host, saved.enabled ? saved.id : undefined);
  } catch (error) {
    logWarn(`api toggle: ${error instanceof Error ? error.message : error}`);
  }
}

export async function quarantineRecentApi(host: SettingsHost): Promise<boolean> {
  const stamp = host.lastApiMutation;
  if (!stamp || Date.now() - stamp.at > API_MUTATION_GUARD_MS) {
    return false;
  }
  host.lastApiMutation = undefined;
  const row = host.apis.find((item) => item.id === stamp.id);
  if (!row?.enabled) {
    return false;
  }
  try {
    await setApiEndpointEnabled(stamp.id, false);
    await refreshApis(host);
    plat().warn(tr('settingsApisQuarantined', { name: row.name }));
    return true;
  } catch (error) {
    logWarn(`api quarantine: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

export async function refreshApis(host: SettingsHost): Promise<void> {
  try {
    host.apis = await listApiEndpoints(host.models?.available ?? []);
    host.apisLoaded = true;
    host.emit();
  } catch (error) {
    logWarn(`api list: ${error instanceof Error ? error.message : error}`);
  }
}

export async function reloadModelCatalog(host: SettingsHost, expectId?: string): Promise<void> {
  const agent = host.agent;
  if (!agent) {
    return;
  }
  const seq = ++host.modelsReloadSeq;
  try {
    await agent.reloadModels();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`reload models: ${message}`);
    await recoverFailedReload(host, expectId);
    return;
  }
  for (let i = 0; i < 8; i += 1) {
    if (seq !== host.modelsReloadSeq) {
      return;
    }
    try {
      const next = mergeModelCatalog(host.models, await agent.listModels());
      if (next) {
        host.models = next;
        host.emit();
        if (!expectId || next.available.some((model) => model.id === expectId)) {
          return;
        }
      }
    } catch (error) {
      logWarn(`models list: ${error instanceof Error ? error.message : error}`);
      return;
    }
    await sleep(300);
  }
}

async function recoverFailedReload(host: SettingsHost, expectId?: string): Promise<void> {
  const id = expectId ?? host.lastApiMutation?.id;
  const row = id ? host.apis.find((item) => item.id === id) : undefined;
  if (row?.enabled && id) {
    try {
      await setApiEndpointEnabled(id, false);
      host.lastApiMutation = undefined;
      await refreshApis(host);
    } catch (error) {
      logWarn(`api disable after reload: ${error instanceof Error ? error.message : error}`);
    }
  }
  plat().warn(tr('settingsApisReloadFailed'));
  if (host.agent) {
    host.respawnAgent();
  }
}

function markApiMutation(host: SettingsHost, saved: ApiEndpoint): void {
  if (!saved.enabled) {
    return;
  }
  host.lastApiMutation = { id: saved.id, at: Date.now() };
}

function clearApiMutation(host: SettingsHost, id: string): void {
  if (host.lastApiMutation?.id === id) {
    host.lastApiMutation = undefined;
  }
}

export async function updateSetting(
  host: SettingsHost,
  key: keyof GrokSettings,
  value: string | boolean,
): Promise<void> {
  const next = normalizeSetting(key, value);
  if (next === undefined) {
    return;
  }
  await writeGrokSetting(key, next);
  host.emit();
}

export function toggleUiFlag(host: SettingsHost, flag: 'compactMode' | 'timestamps' | 'multiline'): void {
  host[flag] = !host[flag];
  void plat().setState(`ui.${flag}`, host[flag]);
  host.emit();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
