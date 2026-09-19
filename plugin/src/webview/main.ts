import type { ChatState, StreamTail } from '../core/types';
import { applyEditStatsToMessages, type EditStatsItem } from '../edits/editStats';
import { resolveIncomingMessages } from '../chat/messageMerge';
import { mergeStreamTail } from '../chat/streamTail';
import { applyThemeTo } from '../settings/theme';
import { bindRender, isBooting, isDesktop, isRemoteWeb, normalizeState, persistUi, post, root, ui } from './app';
import { ensureOgPluginRoot, fireOgPatch, syncOgUiPlugins } from './ogPlugins';
import { patchRail } from './shell/rail';
import { patchDesktopDash } from './shell/dashboard';
import { closeDesktopReview, openDesktopReview, patchReviewStage, reviewOpen } from './shell/reviewStage';
import { patchSettingsStage } from './shell/settingsStage';
import { patchHeader, renderDrawer, renderLightbox } from './chrome';
import { mountComposer, patchComposer } from './chrome/composer';
import { removeSlot, replaceSlot } from './dom';
import { closeSettingsPicker, patchSettings, settingsBackMessage } from './settings';
import { bindFileDrop, syncDropHint } from './chrome/drop';
import { bindQuoteMenu } from './chrome/quoteMenu';
import { bindFileLinkMenu } from './chrome/fileLinkMenu';
import { patchBody, scrollTranscript, syncWorkClock } from './transcript';
import { chromeKeepers, overlayKind, syncSurface, syncThemeFontFace, syncWallpaper } from './chrome/wallpaper';
import { syncBorderGlow } from './chrome/borderGlow';
import { playNotify } from './chrome/notify';
import { hideRemoteOverlays, showRemoteDiff, showRemoteFile } from './shell/remoteOverlay';
import { reflowFloating } from './chrome/popover';
import {
  appendWorkspaceDiff,
  applyWorkspaceFile,
  applyWorkspaceGone,
  applyWorkspaceIndex,
  applyWorkspaceMoved,
  applyWorkspaceSave,
  hideWorkspace,
  openWorkspaceReview,
  patchWorkspace,
} from './shell/workspace';

bindRender(render);

type HostMsg = {
  type: string;
  state?: ChatState;
  files?: unknown;
  payload?: Parameters<typeof openWorkspaceReview>[0];
  locale?: string;
  messageId?: string;
  theme?: unknown;
  truncated?: boolean;
  messages?: ChatState['messages'];
  hydrate?: number;
  merge?: boolean;
  prepend?: boolean;
  reset?: boolean;
  done?: boolean;
  sessionId?: string;
  items?: EditStatsItem[];
  config?: {
    enabled?: boolean;
    size?: number;
    color?: string;
    shape?: string;
    eyeColor?: string;
    expression?: string;
    bubbles?: boolean;
  };
  tab?: string;
} & Partial<StreamTail>;

let hydrateGen = 0;
let skipHydrate = 0;

function onHostMessage(data: HostMsg | null | undefined): void {
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.type === 'wake') {
    post({ type: 'alive' });
    return;
  }
  if (data.type === 'ogPlugin') {
    document.dispatchEvent(new CustomEvent('og:host', { detail: (data as { payload?: unknown }).payload }));
    return;
  }
  if (data.type === 'pet' && data.config && typeof data.config === 'object') {
    const config = data.config as {
      enabled?: boolean;
      size?: number;
      color?: string;
      shape?: string;
      eyeColor?: string;
      expression?: string;
      bubbles?: boolean;
    };
    const enabled = config.enabled === true;
    const color = config.color ?? ui.pet.color;
    const size = typeof config.size === 'number' ? config.size : ui.pet.size;
    ui.pet = {
      enabled,
      size,
      color,
      shape: config.shape ?? ui.pet.shape,
      eyeColor: config.eyeColor ?? ui.pet.eyeColor,
      expression: config.expression ?? ui.pet.expression,
      bubbles: config.bubbles !== false,
    };
    const chromeChanged = true;
    if (chromeChanged) {
      render();
    }
    return;
  }
  if (data.type === 'openDesk' && data.tab) {
    ui.deskTab = data.tab as typeof ui.deskTab;
    post({ type: 'openSettings' });
    return;
  }
  if (data.type === 'state' && data.state) {
    const incoming = normalizeState(data.state);
    if (incoming.currentSessionId !== ui.state.currentSessionId) {
      hydrateGen = typeof data.hydrate === 'number' ? data.hydrate : hydrateGen + 1;
      skipHydrate = 0;
    } else if (typeof data.hydrate === 'number') {
      hydrateGen = data.hydrate;
    }
    if (incoming.restoringSession && incoming.messages.length === 0 && ui.state.messages.length > 0) {
      incoming.messages = ui.state.messages;
      incoming.mergeTranscript = true;
    }
    const resolved = resolveIncomingMessages(ui.state.messages, incoming.messages, {
      merge: data.merge || incoming.mergeTranscript,
      mergeTranscript: incoming.mergeTranscript,
      hydrate: data.hydrate,
    });
    incoming.messages = resolved.messages;
    if (resolved.skipHydrate !== undefined) {
      skipHydrate = resolved.skipHydrate;
    }
    if (!incoming.restoringSession && resolved.live) {
      incoming.restoringSession = false;
    }
    if (incoming.currentSessionId !== ui.state.currentSessionId) {
      ui.chosenModelId = undefined;
      ui.chosenEffort = undefined;
      ui.stickToBottom = true;
    }
    if (ui.review) {
      incoming.settingsOpen = false;
    }
    if (
      ui.chosenModelId &&
      incoming.models?.available.some((model) => model.id === ui.chosenModelId)
    ) {
      incoming.models = {
        ...incoming.models,
        currentId: ui.chosenModelId,
        available: incoming.models.available.map((model) =>
          model.id === ui.chosenModelId && ui.chosenEffort
            ? { ...model, currentEffort: ui.chosenEffort }
            : model,
        ),
      };
    }
    ui.state = incoming;
    persistUi();
    const cue = ui.state.notify;
    if (cue && ui.state.settings?.notifySound !== false) {
      playNotify(cue);
    }
    render();
    return;
  }
  if (data.type === 'messages') {
    if (data.sessionId && ui.state.currentSessionId && data.sessionId !== ui.state.currentSessionId) {
      return;
    }
    if (typeof data.hydrate === 'number' && data.hydrate !== hydrateGen) {
      return;
    }
    if (typeof data.hydrate === 'number' && data.hydrate === skipHydrate && data.prepend) {
      if (data.done) {
        ui.state.restoringSession = false;
        render();
        if (ui.stickToBottom) {
          scrollTranscript(true);
        }
      }
      return;
    }
    const batch = Array.isArray(data.messages) ? data.messages : [];
    if (data.reset) {
      ui.state.messages = batch;
    } else if (data.prepend) {
      ui.state.messages = batch.concat(ui.state.messages);
    } else {
      ui.state.messages = ui.state.messages.concat(batch);
    }
    if (typeof data.hydrate === 'number' && !data.done) {
      if (ui.state.messages.length === 0) {
        ui.state.restoringSession = true;
      }
      return;
    }
    ui.state.restoringSession = false;
    render();
    if (ui.stickToBottom) {
      scrollTranscript(true);
    }
    return;
  }
  if (data.type === 'tail' && data.message) {
    applyTail(data as StreamTail);
    return;
  }
  if (isDesktop() && (data.type === 'workspaceDiff' || data.type === 'diff')) {
    const payload =
      data.type === 'diff' && data.payload && typeof data.payload === 'object'
        ? data.payload
        : {
            locale: typeof data.locale === 'string' ? data.locale : undefined,
            files: Array.isArray(data.files) ? data.files : undefined,
            messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
            theme: data.theme,
          };
    openDesktopReview(payload);
    return;
  }
  if (!isDesktop() && data.type === 'workspaceDiff') {
    openWorkspaceReview({
      locale: typeof data.locale === 'string' ? data.locale : undefined,
      files: Array.isArray(data.files) ? data.files : undefined,
      messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      theme: data.theme,
    });
    return;
  }
  if (!isDesktop() && data.type === 'diff' && data.payload && typeof data.payload === 'object') {
    openWorkspaceReview(data.payload as Parameters<typeof openWorkspaceReview>[0]);
    return;
  }
  if (data.type === 'editStats' && Array.isArray(data.items)) {
    const next = applyEditStatsToMessages(ui.state.messages, data.items);
    if (next !== ui.state.messages) {
      ui.state = { ...ui.state, messages: next };
      persistUi();
      render();
    }
    return;
  }
  if (!isRemoteWeb()) {
    return;
  }
  if (data.type === 'diff' && 'payload' in data) {
    showRemoteDiff((data as { payload: Parameters<typeof showRemoteDiff>[0] }).payload);
    return;
  }
  if (data.type === 'diffMore' && Array.isArray((data as { files?: unknown[] }).files)) {
    appendWorkspaceDiff((data as { files: unknown[] }).files);
    return;
  }
  if (data.type === 'filePreview') {
    showRemoteFile(data as Parameters<typeof showRemoteFile>[0]);
    return;
  }
  if (data.type === 'workspaceIndex') {
    applyWorkspaceIndex(data as Parameters<typeof applyWorkspaceIndex>[0]);
    return;
  }
  if (data.type === 'workspaceFile') {
    applyWorkspaceFile(data as Parameters<typeof applyWorkspaceFile>[0]);
    return;
  }
  if (data.type === 'workspaceSaveResult') {
    applyWorkspaceSave(data as Parameters<typeof applyWorkspaceSave>[0]);
    return;
  }
  if (data.type === 'workspaceMoved') {
    applyWorkspaceMoved(data as Parameters<typeof applyWorkspaceMoved>[0]);
    return;
  }
  if (data.type === 'workspaceGone') {
    applyWorkspaceGone(data as Parameters<typeof applyWorkspaceGone>[0]);
  }
}

window.addEventListener('message', (event: MessageEvent<HostMsg>) => {
  onHostMessage(event.data);
});
(window as unknown as { __grokDeliver?: (data: unknown) => void }).__grokDeliver = (data) => {
  onHostMessage(data as HostMsg);
};

let tailPaint = 0;

function applyTail(tail: StreamTail): void {
  if (tail.queue !== undefined) {
    ui.state.queue = tail.queue;
  }
  const messages = ui.state.messages;
  const incoming = tail.message;
  const at = messages.findIndex((item) => item.id === incoming.id);
  if (at < 0) {
    patchComposer();
    return;
  }
  messages[at] = mergeStreamTail(messages[at], tail);
  ui.state.status = tail.status;
  ui.state.context = tail.context;
  ui.state.queue = tail.queue;
  if (document.getElementById('transcript') && document.getElementById('grok-body')) {
    root.dataset.status = ui.state.status;
    scheduleTailPaint();
    return;
  }
  render();
}

function scheduleTailPaint(): void {
  if (tailPaint) {
    return;
  }
  tailPaint = requestAnimationFrame(() => {
    tailPaint = 0;
    patchBody(root);
    patchComposer();
    fireOgPatch();
  });
}

function render(): void {
  try {
    document.documentElement.lang = ui.state.locale === 'zh-CN' ? 'zh-CN' : 'en';
    applyThemeTo(
      document.documentElement.style,
      ui.state.theme,
      isRemoteWeb() || isDesktop() ? ui.state.hostChrome : undefined,
    );
    syncDesktopChrome();
    syncThemeFontFace(document, ui.state.theme?.fontUrl);
    syncSurface(
      root,
      ui.state.theme,
      overlayKind({
        settingsOpen: isDesktop() ? false : ui.state.settingsOpen,
        settingsPage: ui.state.settingsPage,
        drawer:
          isDesktop() && (ui.state.settingsOpen || ui.state.drawer === 'dashboard')
            ? undefined
            : ui.state.drawer,
      }),
    );
    root.dataset.status = ui.state.status;
    root.classList.toggle('compact', Boolean(ui.state.compactMode));
    root.classList.toggle('focused', ui.composerFocused);
    if (!isBooting() && !document.getElementById('grok-header')) {
      const keep = chromeKeepers();
      root.replaceChildren();
      for (const node of keep) {
        root.append(node);
      }
    }
    if (isDesktop()) {
      patchRail(root);
    }
    const settingsOn = isDesktop() && Boolean(ui.state.settingsOpen) && !ui.review;
    const reviewing = reviewOpen();
    root.classList.toggle('og-settings-on', settingsOn);
    if (!settingsOn || isDesktop()) {
      patchHeader(root);
    }
    if (!settingsOn && !reviewing) {
      patchBody(root);
    }
    const booting = isBooting();
    if (!settingsOn && !reviewing && !booting && !document.getElementById('composer-wrap')) {
      mountComposer(root);
    }
    if (!settingsOn && !reviewing) {
      patchComposer();
      syncDropHint();
    }
    const header = document.getElementById('grok-header');
    if (header) {
      header.hidden = settingsOn && !isDesktop();
    }
    const body = document.getElementById('grok-body');
    if (body) {
      body.hidden = settingsOn || reviewing;
    }
    const composer = document.getElementById('composer-wrap');
    if (composer) {
      composer.hidden = settingsOn || reviewing || booting;
    }
    const workspaceOn =
      !isDesktop() &&
      ui.remoteView === 'workspace' &&
      !booting &&
      !ui.state.settingsOpen &&
      (isRemoteWeb() || ui.wsListed);
    root.classList.toggle('ws-on', workspaceOn);
    if (workspaceOn) {
      patchWorkspace(root);
    } else {
      hideWorkspace();
    }
    const deskDash = isDesktop() && ui.state.drawer === 'dashboard' && !settingsOn && !reviewing;
    root.classList.toggle('og-dash-on', deskDash);
    patchDesktopDash(root, settingsOn || reviewing);
    if (ui.state.drawer && !settingsOn && !deskDash) {
      replaceSlot('grok-drawer', renderDrawer(), root);
    } else {
      removeSlot('grok-drawer');
    }
    if (isDesktop()) {
      patchSettingsStage(root);
      patchReviewStage(root);
    } else {
      patchSettings(root);
    }
    if (ui.lightboxSrc) {
      replaceSlot('grok-lightbox', renderLightbox(), root);
    } else {
      removeSlot('grok-lightbox');
    }
    syncWallpaper(root, ui.state.theme);
    syncBorderGlow(root);
    scrollTranscript();
    syncWorkClock();
    reflowFloating();
    ensureOgPluginRoot();
    syncOgUiPlugins(ui.state.ogPlugins);
    fireOgPatch();
  } catch (error) {
    root.textContent = `Grok UI error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function boot(): void {
  (window as unknown as { __grokPrime?: () => void }).__grokPrime?.();
  ensureOgPluginRoot();
  bindQuoteMenu();
  bindFileLinkMenu();
  post({ type: 'ready' });
  post({ type: 'alive' });
  if (!isRemoteWeb()) {
    window.setInterval(() => post({ type: 'alive' }), 15_000);
  }
  document.addEventListener('keydown', (event) => {
    if (isDesktop() && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        post({ type: 'closeSettings' });
        post({ type: 'closeDrawer' });
        closeDesktopReview();
        ui.wantFocus = true;
        post({ type: 'newSession' });
        return;
      }
      if (key === ',') {
        event.preventDefault();
        ui.review = undefined;
        if (ui.state.settingsOpen) {
          post({ type: 'closeSettings' });
        } else {
          ui.deskTab = 'account';
          post({ type: 'openSettings' });
        }
        return;
      }
      if (key === 'l') {
        event.preventDefault();
        ui.wantFocus = true;
        render();
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#og-rail .og-search, #og-rail .og-set-search')?.focus();
        return;
      }
    }
    if (event.key !== 'Escape') {
      return;
    }
    if (closeDesktopReview()) {
      event.preventDefault();
      return;
    }
    if (hideRemoteOverlays()) {
      event.preventDefault();
      return;
    }
    if (ui.lightboxSrc) {
      event.preventDefault();
      ui.lightboxSrc = undefined;
      render();
      return;
    }
    if (ui.moreOpen || ui.picker || ui.menu) {
      event.preventDefault();
      ui.moreOpen = false;
      ui.picker = undefined;
      ui.menu = undefined;
      render();
      return;
    }
    if (ui.state.settingsOpen) {
      event.preventDefault();
      post(isDesktop() ? { type: 'closeSettings' } : settingsBackMessage(ui.state.settingsPage ?? 'main'));
      return;
    }
    if (ui.state.drawer) {
      event.preventDefault();
      post({ type: 'closeDrawer' });
    }
  });
  document.addEventListener('click', (event) => {
    const filePath = filePathFromEvent(event);
    if (filePath) {
      event.preventDefault();
      post({ type: 'openFile', path: filePath });
      return;
    }
    const href = hrefFromEvent(event);
    if (href) {
      event.preventDefault();
      post({ type: 'openUrl', url: href });
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.picker, .picker-menu, .more-menu, .menu')
    ) {
      return;
    }
    closeSettingsPicker();
    if (ui.moreOpen || ui.picker) {
      ui.moreOpen = false;
      ui.picker = undefined;
      render();
    }
  });
  bindFileDrop();
  render();
}

function syncDesktopChrome(): void {
  if (!isDesktop()) {
    return;
  }
  const style = document.documentElement.style;
  const background = style.getPropertyValue('--bg').trim();
  const foreground = style.getPropertyValue('--fg').trim();
  if (!/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(foreground)) {
    return;
  }
  const host = (
    window as unknown as {
      opengrok?: {
        setChrome?: (chrome: {
          background: string;
          foreground: string;
          surface?: 'glass' | 'solid' | 'endfield';
        }) => void;
      };
    }
  ).opengrok;
  const raw = document.getElementById('app')?.dataset.surface;
  const surface = raw === 'solid' || raw === 'endfield' || raw === 'glass' ? raw : 'glass';
  host?.setChrome?.({ background, foreground, surface });
}

function filePathFromEvent(event: MouseEvent): string | undefined {
  const target = event.target;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const link = target.closest('.md-file');
  if (!(link instanceof HTMLElement)) {
    return undefined;
  }
  const path = link.dataset.path?.trim();
  return path || undefined;
}

function hrefFromEvent(event: MouseEvent): string | undefined {
  const target = event.target;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const link = target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) {
    return undefined;
  }
  const href = link.getAttribute('href') ?? '';
  if (/^https?:/i.test(href) || href.toLowerCase().startsWith('mailto:')) {
    return href;
  }
  return undefined;
}

try {
  boot();
} catch (error) {
  root.textContent = `Grok failed to start: ${error instanceof Error ? error.message : String(error)}`;
}
