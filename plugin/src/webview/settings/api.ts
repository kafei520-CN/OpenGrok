import { formatContextWindow, parseContextWindow } from '../../context/contextWindow';
import type { ApiBackend, ApiEndpoint } from '../../core/types';
import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function apisNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsApis');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = ui.state.apis?.length ?? 0;
  hint.textContent = n > 0 ? tr('settingsApisCount', { n }) : tr('settingsApisHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openApis' }));
  return row;
}

export function mountApisBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn primary';
  add.textContent = tr('settingsApisAdd');
  add.addEventListener('click', () => post({ type: 'openApiForm' }));
  actions.append(add);
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsApisHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const apis = ui.state.apis ?? [];
  if (apis.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsApisEmpty');
    card.append(empty);
  } else {
    for (const item of apis) {
      card.append(endpointRow(item));
    }
  }
  body.append(actions, hint, card);
  return body;
}

export function mountApiFormBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  body.append(endpointForm());
  return body;
}

function editingId(): string | undefined {
  return ui.state.apiEditId;
}

function endpointForm(): HTMLElement {
  const currentId = editingId();
  const wrap = document.createElement('div');
  wrap.className = 'settings-card api-form';
  const title = document.createElement('div');
  title.className = 'settings-label';
  title.dataset.apiTitle = '1';
  title.textContent = currentId ? tr('settingsApisEdit') : tr('settingsApisAdd');
  const name = field(tr('settingsApisName'), 'text', 'api-name');
  const model = field(tr('settingsApisModel'), 'text', 'api-model');
  const url = field(tr('settingsApisUrl'), 'text', 'api-url');
  const urlInput = url.querySelector('input') as HTMLInputElement;
  urlInput.placeholder = 'https://api.example.com/v1';
  const urlHint = document.createElement('div');
  urlHint.className = 'settings-hint';
  const urlPreview = document.createElement('div');
  urlPreview.className = 'settings-hint';
  const urlWarn = document.createElement('div');
  urlWarn.className = 'settings-hint warn';
  urlWarn.hidden = true;
  url.append(urlHint, urlPreview, urlWarn);
  const windowRow = field(tr('settingsApisWindow'), 'text', 'api-window');
  windowRow.querySelector('input')!.placeholder = '128k';
  const windowHint = document.createElement('div');
  windowHint.className = 'settings-hint';
  windowHint.textContent = tr('settingsApisWindowHint');
  const windowWarn = document.createElement('div');
  windowWarn.className = 'settings-hint warn';
  windowWarn.hidden = true;
  windowRow.append(windowHint, windowWarn);
  const key = field(tr('settingsApisKey'), 'password', 'api-key');
  key.querySelector('input')!.placeholder = currentId ? tr('settingsApisKeyKeep') : '';
  const proto = document.createElement('div');
  proto.className = 'settings-row stack';
  const protoLabel = document.createElement('div');
  protoLabel.className = 'settings-label';
  protoLabel.textContent = tr('settingsApisProtocol');
  const seg = document.createElement('div');
  seg.className = 'seg settings-seg';
  seg.dataset.apiBackend = 'chat_completions';
  const backends: Array<[ApiBackend, string]> = [
    ['chat_completions', tr('settingsApisChat')],
    ['responses', tr('settingsApisResponses')],
    ['messages', tr('settingsApisMessages')],
  ];
  const refreshUrlHelp = () => {
    const backend = (seg.dataset.apiBackend as ApiBackend) || 'chat_completions';
    const value = urlInput.value.trim();
    urlHint.textContent =
      backend === 'messages' ? tr('settingsApisUrlHintMessages') : tr('settingsApisUrlHint');
    const preview = requestPreview(value, backend);
    urlPreview.textContent = preview ? tr('settingsApisUrlPreview', { url: preview }) : '';
    const warn = backend === 'messages' && Boolean(value) && messagesBareHost(value);
    urlWarn.textContent = warn ? tr('settingsApisMessagesUrlWarn') : '';
    urlWarn.hidden = !warn;
  };
  for (const [id, label] of backends) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = id;
    btn.textContent = label;
    if (id === 'chat_completions') {
      btn.classList.add('on');
    }
    btn.addEventListener('click', () => {
      seg.dataset.apiBackend = id;
      for (const child of [...seg.children]) {
        child.classList.toggle('on', (child as HTMLElement).dataset.id === id);
      }
      refreshUrlHelp();
    });
    seg.append(btn);
  }
  proto.append(protoLabel, seg);
  urlInput.addEventListener('input', refreshUrlHelp);
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn primary';
  save.textContent = tr('settingsApisSave');
  save.addEventListener('click', () => {
    const nameVal = (name.querySelector('input') as HTMLInputElement).value.trim();
    const modelVal = (model.querySelector('input') as HTMLInputElement).value.trim();
    const urlVal = (url.querySelector('input') as HTMLInputElement).value.trim();
    const keyVal = (key.querySelector('input') as HTMLInputElement).value;
    const windowVal = (windowRow.querySelector('input') as HTMLInputElement).value;
    if (!nameVal || !modelVal || !urlVal) {
      return;
    }
    let contextWindow: number | undefined;
    try {
      contextWindow = parseContextWindow(windowVal);
      windowWarn.hidden = true;
    } catch {
      windowWarn.textContent = tr('settingsApisWindowInvalid');
      windowWarn.hidden = false;
      return;
    }
    const id = editingId();
    post({
      type: 'saveApi',
      ...(id ? { id } : {}),
      name: nameVal,
      model: modelVal,
      baseUrl: urlVal,
      backend: (seg.dataset.apiBackend as ApiBackend) || 'chat_completions',
      apiKey: keyVal.trim() ? keyVal : undefined,
      contextWindow,
    });
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = tr('settingsApisCancel');
  cancel.addEventListener('click', () => post({ type: 'closeApiForm' }));
  actions.append(save, cancel);
  wrap.append(title, name, model, proto, url, windowRow, key, actions);
  if (currentId) {
    const current = (ui.state.apis ?? []).find((item) => item.id === currentId);
    if (current) {
      (name.querySelector('input') as HTMLInputElement).value = current.name;
      (model.querySelector('input') as HTMLInputElement).value = current.model;
      (url.querySelector('input') as HTMLInputElement).value = current.baseUrl;
      (windowRow.querySelector('input') as HTMLInputElement).value = formatContextWindow(
        current.contextWindow,
      );
      seg.dataset.apiBackend = current.backend;
      for (const child of [...seg.children]) {
        child.classList.toggle('on', (child as HTMLElement).dataset.id === current.backend);
      }
    }
  }
  refreshUrlHelp();
  return wrap;
}

function requestPreview(raw: string, backend: ApiBackend): string {
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    return '';
  }
  const path =
    backend === 'messages'
      ? 'messages'
      : backend === 'responses'
        ? 'responses'
        : 'chat/completions';
  return `${base}/${path}`;
}

function messagesBareHost(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return (parsed.pathname.replace(/\/+$/, '') || '/') === '/';
  } catch {
    return false;
  }
}

function endpointRow(item: ApiEndpoint): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement(item.builtin ? 'div' : 'button');
  if (copy instanceof HTMLButtonElement) {
    copy.type = 'button';
  }
  copy.className = item.builtin ? 'settings-copy' : 'settings-copy rule-open';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const proto =
    item.backend === 'messages'
      ? tr('settingsApisMessages')
      : item.backend === 'responses'
        ? tr('settingsApisResponses')
        : tr('settingsApisChat');
  const state = item.enabled ? tr('settingsApisOn') : tr('settingsApisOff');
  const windowHint = item.contextWindow ? ` · ${formatContextWindow(item.contextWindow)}` : '';
  hint.textContent = item.builtin
    ? `${tr('settingsApisOfficial')} · ${state}`
    : `${state} · ${proto} · ${item.model} · ${item.baseUrl}${windowHint}${item.hasKey ? ` · ${tr('settingsApisHasKey')}` : ''}`;
  copy.append(name, hint);
  if (!item.builtin) {
    copy.addEventListener('click', () => post({ type: 'openApiForm', id: item.id }));
  }
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = item.enabled ? 'switch on' : 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', item.enabled ? 'true' : 'false');
  toggle.title = item.enabled ? tr('settingsApisOn') : tr('settingsApisOff');
  const knob = document.createElement('span');
  knob.className = 'knob';
  toggle.append(knob);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'toggleApi', id: item.id });
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn';
  del.textContent = tr('settingsApisDelete');
  del.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'deleteApi', id: item.id });
  });
  tools.append(toggle);
  if (!item.builtin) {
    tools.append(del);
  }
  row.append(copy, tools);
  return row;
}

function field(label: string, type: string, id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row stack';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'settings-field';
  input.dataset.apiField = id;
  row.append(name, input);
  return row;
}
