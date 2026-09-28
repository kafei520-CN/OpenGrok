/**
 * Turns a Chrome accessibility tree into the same nested control list Playwright shows a model.
 * The browser already computed each control's name. This only chooses which nodes are worth sending.
 */

import { formatControl, type SnapControl } from './browserSnap';

export interface AxTree {
  nodes: SnapControl[];
  lines: string[];
  note: string;
}

interface AxRaw {
  nodeId: string;
  role: string;
  name: string;
  ignored: boolean;
  childIds: string[];
  backend: number;
  url: string;
  value: string;
  focused: boolean;
  disabled: boolean;
  level: number;
}

const ACTION = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'switch',
  'spinbutton',
  'treeitem',
]);

const LANDMARK = new Set([
  'navigation',
  'search',
  'main',
  'banner',
  'contentinfo',
  'form',
  'dialog',
  'alert',
  'menu',
  'menubar',
  'toolbar',
]);

const SKIP = new Set(['none', 'generic', 'inlinetextbox', 'linebreak', 'statictext', 'presentation', 'text', 'ignored']);

/** Builds a nested snapshot. `refFor` keeps the same number for the same DOM node across looks. */
export function formatAxTree(raw: unknown, refFor: (backend: number) => string): AxTree {
  const parsed = parseAxNodes(raw);
  const byId = new Map(parsed.map((node) => [node.nodeId, node]));
  const claimed = new Set<string>();
  for (const node of parsed) {
    for (const child of node.childIds) {
      claimed.add(child);
    }
  }
  const roots = parsed.filter((node) => !claimed.has(node.nodeId));
  const lines: string[] = [];
  const nodes: SnapControl[] = [];
  const state = { refs: 0, contentLinks: 0, hiddenLinks: 0, headings: 0 };
  for (const root of roots) {
    walk(root, 0, '', byId, lines, nodes, state, refFor);
  }
  const note = state.hiddenLinks > 0
    ? `还有 ${state.hiddenLinks} 个内容链接。它们打开具体内容，不是页头功能。搜索用带「输入后按 Enter」的输入框。`
    : '';
  if (!lines.length) {
    lines.push('视口里没有可点控件。');
  }
  if (note) {
    lines.push(note);
  }
  return { nodes, lines, note };
}

function walk(
  node: AxRaw,
  depth: number,
  parentRole: string,
  byId: Map<string, AxRaw>,
  lines: string[],
  nodes: SnapControl[],
  state: { refs: number; contentLinks: number; hiddenLinks: number; headings: number },
  refFor: (backend: number) => string,
): void {
  const role = node.role;
  if (role === 'rootwebarea' || role === 'webarea') {
    for (const child of childrenOf(node, byId)) {
      walk(child, 0, parentRole, byId, lines, nodes, state, refFor);
    }
    return;
  }
  if (node.ignored || SKIP.has(role)) {
    for (const child of childrenOf(node, byId)) {
      walk(child, depth, parentRole, byId, lines, nodes, state, refFor);
    }
    return;
  }
  const landmark = LANDMARK.has(role);
  const actionable = ACTION.has(role);
  const heading = role === 'heading';
  if (!landmark && !actionable && !heading) {
    for (const child of childrenOf(node, byId)) {
      walk(child, depth, parentRole, byId, lines, nodes, state, refFor);
    }
    return;
  }
  if (depth > 8) {
    return;
  }
  if (role === 'link' && !inChrome(parentRole)) {
    if (state.contentLinks >= 8) {
      state.hiddenLinks += 1;
      return;
    }
    state.contentLinks += 1;
  }
  if (heading && state.headings >= 4) {
    return;
  }
  if (heading) {
    state.headings += 1;
  }
  const name = node.name.slice(0, 80);
  const hint = hintFor(role, name, parentRole, node.url);
  const keepUnnamed = role === 'textbox' || role === 'searchbox' || role === 'button' || role === 'checkbox' || role === 'radio';
  let ref = '';
  if ((actionable || heading) && state.refs < 70 && (name !== '' || keepUnnamed)) {
    state.refs += 1;
    ref = node.backend > 0 ? refFor(node.backend) : `e${state.refs}`;
  }
  const control: SnapControl = {
    ref,
    role,
    name,
    value: node.value.slice(0, 80),
    enabled: !node.disabled,
    focused: node.focused,
    level: node.level,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    hint,
    backend: node.backend > 0 ? node.backend : undefined,
  };
  if (ref) {
    nodes.push(control);
  }
  const pad = '  '.repeat(depth);
  if (ref) {
    lines.push(`${pad}${formatControl(control, '-').slice(2)}`);
  } else if (landmark) {
    lines.push(`${pad}- ${role}${name ? ` ${JSON.stringify(name)}` : ''}`);
  }
  const nextParent = landmark || heading ? role : parentRole;
  for (const child of childrenOf(node, byId)) {
    walk(child, depth + 1, nextParent, byId, lines, nodes, state, refFor);
  }
}

function childrenOf(node: AxRaw, byId: Map<string, AxRaw>): AxRaw[] {
  const out: AxRaw[] = [];
  for (const id of node.childIds) {
    const child = byId.get(id);
    if (child) {
      out.push(child);
    }
  }
  return out;
}

function inChrome(role: string): boolean {
  return role === 'banner' || role === 'navigation' || role === 'search' || role === 'toolbar' || role === 'menubar';
}

function hintFor(role: string, name: string, parentRole: string, url: string): string {
  if (role === 'searchbox' || ((role === 'textbox') && (parentRole === 'search' || /搜索|search/i.test(name)))) {
    return '输入后按 Enter 提交';
  }
  if (role === 'button' && (parentRole === 'search' || /搜索|search/i.test(name))) {
    return '提交搜索';
  }
  if (role === 'link' && url) {
    try {
      const path = new URL(url).pathname;
      return path && path !== '/' ? path.slice(0, 48) : '';
    } catch {
      return '';
    }
  }
  return '';
}

function parseAxNodes(raw: unknown): AxRaw[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)['nodes'])
      ? (asRecord(raw)['nodes'] as unknown[])
      : [];
  const out: AxRaw[] = [];
  for (const item of list) {
    const node = parseAxNode(item);
    if (node) {
      out.push(node);
    }
  }
  return out;
}

function parseAxNode(raw: unknown): AxRaw | undefined {
  const obj = asRecord(raw);
  const nodeId = text(obj['nodeId']);
  if (!nodeId) {
    return undefined;
  }
  const props = propertiesOf(obj['properties']);
  const childIds = Array.isArray(obj['childIds'])
    ? obj['childIds'].filter((id): id is string => typeof id === 'string')
    : [];
  return {
    nodeId,
    role: text(asRecord(obj['role'])['value']).toLowerCase(),
    name: text(asRecord(obj['name'])['value']).replace(/\s+/g, ' ').trim(),
    ignored: obj['ignored'] === true,
    childIds,
    backend: typeof obj['backendDOMNodeId'] === 'number' ? obj['backendDOMNodeId'] : 0,
    url: props['url'] ?? '',
    value: props['value'] || props['valuetext'] || '',
    focused: props['focused'] === 'true',
    disabled: props['disabled'] === 'true',
    level: Number(props['level'] || 0) || 0,
  };
}

function propertiesOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw) {
    const prop = asRecord(item);
    const name = text(prop['name']).toLowerCase();
    if (!name) {
      continue;
    }
    out[name] = text(asRecord(prop['value'])['value']);
  }
  return out;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function text(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return '';
}
