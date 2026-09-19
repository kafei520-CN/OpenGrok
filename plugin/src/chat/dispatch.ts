import { plat } from '../core/platform';
import { dispatchOgPlugins } from '../ogPlugins/hostRuntime';
import type { GrokController } from './controller';
import type { WebviewToHost } from '../core/types';

export async function dispatchUi(
  controller: GrokController,
  message: WebviewToHost | { type: string; [key: string]: unknown },
): Promise<void> {
  await dispatchOgPlugins(message, async (msg) => {
    await dispatchUiCore(controller, msg as WebviewToHost);
  });
}

async function dispatchUiCore(controller: GrokController, message: WebviewToHost): Promise<void> {
  switch (message.type) {
    case 'ready':
      void controller.start();
      return;
    case 'alive':
      return;
    case 'login':
      await controller.login();
      return;
    case 'skipLogin':
      await controller.skipLogin();
      return;
    case 'useApiLogin':
      await controller.useApiLogin();
      return;
    case 'openLoginUrl':
      await controller.openLoginUrl();
      return;
    case 'submitAuthCode':
      await controller.submitAuthCode(message.code);
      return;
    case 'cancelLogin':
      await controller.cancelLogin();
      return;
    case 'setApiKey':
      await controller.setApiKey(message.key);
      return;
    case 'logout':
      await controller.logout();
      return;
    case 'send':
      await controller.send(message.text);
      return;
    case 'dropQueue':
      controller.dropQueue(message.index);
      return;
    case 'sendNow':
      await controller.sendNow(message.index);
      return;
    case 'openCron':
      controller.openCron();
      return;
    case 'closeCron':
      controller.closeCron();
      return;
    case 'addCronJob':
      controller.addCronJob({
        title: message.title,
        prompt: message.prompt,
        kind: message.kind,
        at: message.at ?? '',
        weekday: message.weekday ?? 1,
        everyMs: message.everyMs ?? 60 * 60_000,
      });
      return;
    case 'patchCronJob':
      controller.patchCronJob(message.id, { enabled: message.enabled });
      return;
    case 'deleteCronJob':
      controller.deleteCronJob(message.id);
      return;
    case 'runCronJob':
      await controller.runCronJob(message.id);
      return;
    case 'cancel':
      controller.cancelTurn();
      return;
    case 'pauseGoal':
      await controller.pauseGoal();
      return;
    case 'resumeGoal':
      await controller.resumeGoal();
      return;
    case 'clearGoal':
      await controller.clearGoal();
      return;
    case 'editGoal':
      await controller.editGoal(message.text);
      return;
    case 'goalStatus':
      await controller.send('/goal status', { hidden: true });
      return;
    case 'newSession':
      await controller.newSession();
      return;
    case 'restart':
      await controller.restart();
      return;
    case 'choosePermission':
      await controller.choosePermission(message.optionId);
      return;
    case 'cancelPermission':
      controller.cancelPermission();
      return;
    case 'answerAsk':
      controller.answerAsk(
        message.choiceIds ?? (message.choiceId ? [message.choiceId] : []),
        message.notes,
      );
      return;
    case 'cancelAsk':
      controller.cancelAsk();
      return;
    case 'removeAttachment':
      controller.removeAttachment(message.id);
      return;
    case 'openFile':
      await controller.previewFileOnRemote(message.path);
      try {
        await plat().openFile(message.path, true);
      } catch {
        /* Browser overlay already has the file; the IDE may not. */
      }
      return;
    case 'openUrl': {
      if (!/^https?:/i.test(message.url) && !message.url.toLowerCase().startsWith('mailto:')) {
        return;
      }
      await plat().openExternal(message.url);
      return;
    }
    case 'setModel':
      await controller.setModel(message.modelId);
      return;
    case 'setMode':
      await controller.setMode(message.modeId);
      return;
    case 'setEffort':
      await controller.setEffort(message.level);
      return;
    case 'installCli':
      await controller.installCli();
      return;
    case 'openDrawer':
      if (message.drawer === 'sessions') {
        await controller.resumePicker();
      } else if (message.drawer === 'dashboard') {
        await controller.openDashboard();
      } else if (message.drawer === 'tasks') {
        await controller.openTasks();
      } else if (message.drawer === 'plan') {
        controller.openPlan();
      } else if (message.drawer === 'history') {
        await controller.send('/history');
      } else {
        await controller.send(`/${message.tab ?? 'mcps'}`);
      }
      return;
    case 'closeDrawer':
      controller.closeDrawer();
      return;
    case 'loadSession':
      void controller.loadSession(message.sessionId, message.cwd);
      return;
    case 'renameSession':
      await controller.renameListedSession(message.sessionId);
      return;
    case 'deleteSession':
      await controller.deleteListedSession(message.sessionId);
      return;
    case 'rewindTo':
      await controller.rewindTo(message.index);
      return;
    case 'rewindTurn':
      await controller.rewindTurn(message.messageId);
      return;
    case 'searchFiles':
      await controller.searchFiles(message.query);
      return;
    case 'pickFile':
      controller.pickFile(message.path);
      return;
    case 'copyLast':
      controller.copyLast();
      return;
    case 'copyText':
      await plat().clipboardWrite(message.text);
      return;
    case 'exportChat':
      await controller.exportChat();
      return;
    case 'attach':
      await controller.attachFromUi();
      return;
    case 'pickProject':
      return;
    case 'pickSessionProject':
      await controller.pickSessionProject();
      return;
    case 'openSettings':
      controller.openSettings();
      return;
    case 'refreshBilling':
      controller.refreshBilling();
      return;
    case 'closeSettings':
      controller.closeSettings();
      return;
    case 'openRules':
      controller.openRules();
      return;
    case 'closeRules':
      controller.closeRules();
      return;
    case 'importRules':
      await controller.importRules();
      return;
    case 'toggleRule':
      await controller.toggleRule(message.id);
      return;
    case 'deleteRule':
      await controller.deleteRule(message.id);
      return;
    case 'openRule':
      controller.openRule(message.id);
      return;
    case 'openSkills':
      controller.openSkills();
      return;
    case 'closeSkills':
      controller.closeSkills();
      return;
    case 'importSkillZip':
      await controller.importSkillZip();
      return;
    case 'importSkillFolder':
      await controller.importSkillFolder();
      return;
    case 'toggleSkill':
      await controller.toggleSkill(message.id);
      return;
    case 'deleteSkill':
      await controller.deleteSkill(message.id);
      return;
    case 'openSkill':
      controller.openSkill(message.id);
      return;
    case 'openApis':
      controller.openApis();
      return;
    case 'closeApis':
      controller.closeApis();
      return;
    case 'openApiForm':
      controller.openApiForm(message.id);
      return;
    case 'closeApiForm':
      controller.closeApiForm();
      return;
    case 'openTheme':
      controller.openTheme();
      return;
    case 'closeTheme':
      controller.closeTheme();
      return;
    case 'openRemote':
      controller.openRemote();
      return;
    case 'closeRemote':
      controller.closeRemote();
      return;
    case 'startRemote':
      await controller.startRemoteAccess(message.port, {
        local: message.local,
        public: message.public,
        host: message.host,
        user: message.user,
        sshPort: message.sshPort,
        forwardPort: message.forwardPort,
        publicUrl: message.publicUrl,
      });
      return;
    case 'stopRemote':
      await controller.stopRemoteAccess();
      return;
    case 'rotateRemoteCode':
      controller.rotateRemoteCode();
      return;
    case 'setRemoteAuth':
      controller.setRemoteAuth({ mode: message.mode, secret: message.secret });
      return;
    case 'setRemotePublicUrl':
      await controller.setRemotePublicUrl(message.url);
      return;
    case 'setRemoteRelay':
      controller.setRemoteRelay({
        kind: message.kind,
        host: message.host,
        port: message.port,
        key: message.key,
      });
      return;
    case 'setRemoteTunnel':
      await controller.setRemoteTunnel({
        host: message.host,
        user: message.user,
        sshPort: message.sshPort,
        forwardPort: message.forwardPort,
        publicUrl: message.publicUrl,
      });
      return;
    case 'setTheme':
      controller.setTheme(message.primary, message.secondary, message.background, {
        wallpaper: message.wallpaper,
        wallpaperOpacity: message.wallpaperOpacity,
        wallpaperScale: message.wallpaperScale,
        wallpaperX: message.wallpaperX,
        wallpaperY: message.wallpaperY,
        surface: message.surface,
        glassOpacity: message.glassOpacity,
        glassBlur: message.glassBlur,
        chromeBlur: message.chromeBlur,
        chromeGlass: message.chromeGlass,
        chromeGlassOpacity: message.chromeGlassOpacity,
        fontPath: message.fontPath,
        fontSize: message.fontSize,
        letterSpacing: message.letterSpacing,
        fontColor: message.fontColor,
        lockContrast: message.lockContrast,
      });
      return;
    case 'pickThemeWallpaper':
      await controller.pickThemeWallpaper();
      return;
    case 'pickThemeFont':
      await controller.pickThemeFont();
      return;
    case 'openThemePreview':
      controller.openThemePreview();
      return;
    case 'closeThemePreview':
      controller.closeThemePreview();
      return;
    case 'openMcps':
      controller.openMcps();
      return;
    case 'closeMcps':
      controller.closeMcps();
      return;
    case 'toggleMcp':
      await controller.toggleMcp(message.id);
      return;
    case 'openAgents':
      controller.openAgents();
      return;
    case 'closeAgents':
      controller.closeAgents();
      return;
    case 'importAgents':
      await controller.importAgents();
      return;
    case 'toggleAgent':
      await controller.toggleAgent(message.id);
      return;
    case 'deleteAgent':
      await controller.deleteAgent(message.id);
      return;
    case 'openAgent':
      controller.openAgent(message.id);
      return;
    case 'setAgentProfile':
      await controller.setAgentProfile(message.name);
      return;
    case 'importPersonas':
      await controller.importPersonas();
      return;
    case 'togglePersona':
      await controller.togglePersona(message.id);
      return;
    case 'deletePersona':
      await controller.deletePersona(message.id);
      return;
    case 'openPersona':
      controller.openPersona(message.id);
      return;
    case 'openWorktrees':
      controller.openWorktrees();
      return;
    case 'closeWorktrees':
      controller.closeWorktrees();
      return;
    case 'applyWorktree':
      await controller.applyWorktree(message.id);
      return;
    case 'removeWorktree':
      await controller.removeWorktree(message.id);
      return;
    case 'openExt':
      controller.openExt();
      return;
    case 'closeExt':
      controller.closeExt();
      return;
    case 'openOgPlugins':
      controller.openOgPlugins();
      return;
    case 'toggleOgPlugin':
      await controller.toggleOgPlugin(message.id);
      return;
    case 'openOgPluginsDir':
      await controller.openOgPluginsDir();
      return;
    case 'reloadOgPlugins':
      await controller.reloadOgPlugins();
      return;
    case 'setExtTab':
      controller.setExtTab(message.tab);
      return;
    case 'togglePlugin':
      await controller.togglePlugin(message.id);
      return;
    case 'uninstallPlugin':
      await controller.uninstallPlugin(message.id);
      return;
    case 'toggleHook':
      await controller.toggleHook(message.id);
      return;
    case 'installMarketplace':
      await controller.installMarketplace(message.id);
      return;
    case 'refreshMarketplace':
      await controller.refreshMarketplace();
      return;
    case 'runWorkflow':
      await controller.runWorkflow(message.name);
      return;
    case 'killTask':
      await controller.killTask(message.taskId);
      return;
    case 'openMemory':
      controller.openMemory();
      return;
    case 'closeMemory':
      controller.closeMemory();
      return;
    case 'openMemoryFile':
      controller.openMemoryFile(message.id);
      return;
    case 'flushMemory':
      await controller.flushMemory();
      return;
    case 'switchRosterSession':
      void controller.loadSession(message.sessionId, message.cwd);
      return;
    case 'stopRosterSession':
      controller.stopRosterSession(message.sessionId);
      return;
    case 'cancelSubagent':
      await controller.cancelSubagent(message.subagentId);
      return;
    case 'dashboardDispatch':
      await controller.dashboardDispatch(message.text, message.sessionId);
      return;
    case 'saveApi':
      await controller.saveApi(message);
      return;
    case 'deleteApi':
      await controller.deleteApi(message.id);
      return;
    case 'toggleApi':
      await controller.toggleApi(message.id);
      return;
    case 'updateSetting':
      await controller.updateSetting(message.key, message.value);
      return;
    case 'toggleFlag':
      controller.toggleUiFlag(message.flag);
      return;
    case 'runSlash':
      await controller.send(`/${message.command}`);
      return;
    case 'pasteClipboard':
      await controller.pasteClipboard(message);
      return;
    case 'quoteSelection':
      controller.quoteText(message.text);
      return;
    case 'undoEdits':
      await controller.undoEdits(message.messageId);
      return;
    case 'reviewEdits':
      await controller.reviewEdits(message.messageId, message.path);
      return;
    case 'editUserPrompt':
      await controller.editUserPrompt(message.messageId, message.text);
      return;
    case 'openEdit':
      controller.openEdit(message.path, message.messageId);
      return;
    case 'setRemoteView':
      if (message.view === 'workspace') {
        await controller.listWorkspace();
      }
      return;
    case 'listWorkspace':
      await controller.listWorkspace(message.dir);
      return;
    case 'openWorkspaceFile':
      await controller.openWorkspaceFile(message.path);
      return;
    case 'saveWorkspaceFile':
      await controller.saveWorkspaceFile(message.path, message.hash, message.text);
      return;
    case 'mutateWorkspace':
      await controller.mutateWorkspace(message);
      return;
    default:
      return;
  }
}
