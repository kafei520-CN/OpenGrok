/**
 * Side-browser page structure: stable refs, a diff the model can act on,
 * and the decision of when a screenshot is still required.
 */

export interface SnapControl {
  ref: string;
  role: string;
  name: string;
  value: string;
  enabled: boolean;
  focused: boolean;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hint: string;
  backend?: number;
}

export interface PagePicture {
  url: string;
  nodes: SnapControl[];
  rows: string[];
  canvas: boolean;
  flashes: string[];
  truncated: boolean;
  note: string;
}

export interface SnapView {
  mode: 'full' | 'diff';
  lines: string[];
  changed: SnapControl[];
}

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Turns the guest snapshot into a picture. Drops malformed controls. */
export function parsePicture(url: string, raw: unknown): PagePicture {
  const obj = asRecord(raw);
  const nodes: SnapControl[] = [];
  if (Array.isArray(obj['nodes'])) {
    for (const item of obj['nodes']) {
      const node = parseControl(item);
      if (node) {
        nodes.push(node);
      }
    }
  }
  return {
    url,
    nodes,
    rows: stringsOf(obj['rows'], 12),
    canvas: obj['canvas'] === true,
    flashes: stringsOf(obj['flashes'], 8),
    truncated: obj['truncated'] === true,
    note: typeof obj['note'] === 'string' ? obj['note'].trim().slice(0, 160) : '',
  };
}

/** First look, or a new URL, is the whole viewport. Later looks are the diff. */
export function buildSnapView(prev: PagePicture | undefined, next: PagePicture): SnapView {
  if (!prev || prev.url !== next.url) {
    return {
      mode: 'full',
      lines: fullLines(next),
      changed: next.nodes.filter((node) => node.role !== 'heading'),
    };
  }
  const prevKeys = keyed(prev.nodes);
  const nextKeys = keyed(next.nodes);
  const prevMap = new Map(prevKeys.map((item) => [item.key, item.node]));
  const nextMap = new Map(nextKeys.map((item) => [item.key, item.node]));
  const lines: string[] = [];
  const changed: SnapControl[] = [];
  for (const item of nextKeys) {
    if (!prevMap.has(item.key)) {
      lines.push(formatControl(item.node, '+'));
      if (item.node.role !== 'heading') {
        changed.push(item.node);
      }
    }
  }
  for (const item of prevKeys) {
    if (!nextMap.has(item.key)) {
      lines.push(formatControl(item.node, '-'));
    }
  }
  const body: string[] = [];
  if (lines.length) {
    body.push('变化:', ...lines);
  }
  const rowLines = diffRows(prev.rows, next.rows);
  if (rowLines.length) {
    body.push('表格:', ...rowLines);
  }
  appendFlashes(body, next.flashes);
  if (next.truncated) {
    body.push('还有更多控件在视口里。');
  }
  const focus = focusLine(next);
  if (!body.length && !focus) {
    body.push('页面没有变化。');
  }
  if (focus) {
    body.unshift(focus);
  }
  return { mode: 'diff', lines: body, changed };
}

/**
 * A picture is the fallback. A named control or a table row is enough.
 * A canvas or a player iframe does not force a screenshot while those words exist.
 */
export function needsShot(picture: PagePicture, force: boolean): boolean {
  if (force) {
    return true;
  }
  const controls = picture.nodes.filter((node) => node.role !== 'heading');
  const named = controls.some((node) => node.name.trim() !== '' || node.hint.trim() !== '');
  if (named || picture.rows.length > 0) {
    return false;
  }
  return true;
}

/** Crop around changed controls. A region that is almost the whole viewport is left uncropped. */
export function cropRect(nodes: SnapControl[], viewport: { width: number; height: number }): CssRect | undefined {
  if (!nodes.length || viewport.width < 2 || viewport.height < 2) {
    return undefined;
  }
  if (nodes.every((node) => node.w < 2 && node.h < 2)) {
    return undefined;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.w);
    bottom = Math.max(bottom, node.y + node.h);
  }
  const pad = 24;
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  const farX = Math.min(viewport.width, Math.ceil(right + pad));
  const farY = Math.min(viewport.height, Math.ceil(bottom + pad));
  const width = Math.max(1, farX - x);
  const height = Math.max(1, farY - y);
  if (width * height > viewport.width * viewport.height * 0.85) {
    return undefined;
  }
  return { x, y, width, height };
}

/** The control the model named, if this picture still lists it. */
export function controlByRef(picture: PagePicture | undefined, ref: string): SnapControl | undefined {
  const trimmed = ref.trim();
  if (!trimmed) {
    return undefined;
  }
  return picture?.nodes.find((node) => node.ref === trimmed);
}

/** Text fields are replaced. Buttons and the page itself are left alone. */
export function shouldClearBeforeType(role: string, append: boolean): boolean {
  if (append) {
    return false;
  }
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/**
 * After a navigation, wait until the document is complete and the DOM sits
 * still. Cap the wait so a page that never goes idle (video, analytics)
 * still returns. Same idea as ZCode's networkidle, without a 25s hang.
 */
export const NAV_SETTLE_JS = `new Promise((resolve) => {
  const root = document.documentElement;
  let last = Date.now();
  const start = last;
  const obs = new MutationObserver(() => { last = Date.now(); });
  if (root) obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    const now = Date.now();
    const ready = document.readyState === 'complete';
    if ((ready && now - last >= 300) || now - start >= 2500) {
      obs.disconnect();
      resolve(now - start);
      return;
    }
    setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
})`;

/** Clears the focused field. No-op when focus is not an editor. */
export const CLEAR_FIELD_JS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const input = el;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (el.isContentEditable) {
    el.textContent = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
})()`;

/** Waits for new elements, not for text or a player that never sits still. */
export const SETTLE_JS = `new Promise((resolve) => {
  const root = document.documentElement;
  if (!root) { resolve(0); return; }
  let last = Date.now();
  const obs = new MutationObserver(() => { last = Date.now(); });
  obs.observe(root, { subtree: true, childList: true });
  const start = Date.now();
  const tick = () => {
    const now = Date.now();
    if (now - last >= 40 || now - start >= 180) {
      obs.disconnect();
      resolve(now - start);
      return;
    }
    setTimeout(tick, 20);
  };
  setTimeout(tick, 20);
})`;

/** Removes the red ref marks before the next real paint matters. */
export const CLEAR_STAMP_JS = `(() => {
  document.getElementById('og-snap-marks')?.remove();
  return true;
})()`;

/** Clicks a ref. A dead ref is rebound only when role and name match one control. */
export function clickTargetScript(ref: string, role: string, name: string): string {
  return `(() => { ${PAGE_HELPERS}
    const hit = ogResolve(${JSON.stringify(ref)}, ${JSON.stringify(role)}, ${JSON.stringify(name)});
    if (!hit || hit.ambiguous) return hit;
    ogPointer(hit);
    return { ok: true, ref: hit.getAttribute('data-og-ref') || '' };
  })()`;
}

/** Focuses a ref so the following key events land in that control. */
export function focusTargetScript(ref: string, role: string, name: string): string {
  return `(() => { ${PAGE_HELPERS}
    const hit = ogResolve(${JSON.stringify(ref)}, ${JSON.stringify(role)}, ${JSON.stringify(name)});
    if (!hit || hit.ambiguous) return hit;
    try { hit.focus(); } catch (e) {}
    return { ok: true, ref: hit.getAttribute('data-og-ref') || '' };
  })()`;
}

/** Paints ref labels on the live page so a fallback screenshot shows the same numbers. */
export function stampScript(nodes: SnapControl[]): string {
  const marks = nodes
    .filter((node) => node.role !== 'heading' && node.w > 0 && node.h > 0)
    .map((node) => ({ ref: node.ref, x: node.x, y: node.y, w: node.w, h: node.h }));
  return `(() => {
    document.getElementById('og-snap-marks')?.remove();
    const nodes = ${JSON.stringify(marks)};
    const host = document.createElement('div');
    host.id = 'og-snap-marks';
    host.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;');
    for (const n of nodes) {
      const box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;left:' + n.x + 'px;top:' + n.y + 'px;width:' + Math.max(n.w, 8) + 'px;height:' + Math.max(n.h, 8) + 'px;border:2px solid #e23d3d;box-sizing:border-box;');
      const label = document.createElement('div');
      label.textContent = n.ref;
      label.setAttribute('style', 'position:absolute;left:-2px;top:-14px;background:#e23d3d;color:#fff;font:12px/14px sans-serif;padding:0 3px;');
      box.append(label);
      host.append(box);
    }
    (document.documentElement || document.body).append(host);
    return true;
  })()`;
}

function fullLines(picture: PagePicture): string[] {
  const lines = picture.nodes.map((node) => formatControl(node, '-'));
  if (picture.rows.length) {
    lines.push('表格:', ...picture.rows.map((row) => `- ${row}`));
  }
  appendFlashes(lines, picture.flashes);
  if (picture.truncated) {
    lines.push('还有更多控件在视口里。');
  }
  if (picture.note) {
    lines.push(picture.note);
  }
  if (!lines.length) {
    lines.push('视口里没有可点控件。');
  }
  return lines;
}

export function formatControl(node: SnapControl, mark: '+' | '-'): string {
  const parts = [`${mark} ${node.role} ${JSON.stringify(node.name)}`];
  if (node.role === 'heading' && node.level > 0) {
    parts.push(`[level=${node.level}]`);
  }
  parts.push(`[ref=${node.ref}]`);
  if (node.value && node.value !== node.name) {
    parts.push(`[value=${JSON.stringify(node.value)}]`);
  }
  if (!node.enabled) {
    parts.push('[disabled]');
  }
  if (node.focused) {
    parts.push('[focused]');
  }
  if (node.hint) {
    parts.push(`[hint=${JSON.stringify(node.hint)}]`);
  }
  return parts.join(' ');
}

function focusLine(picture: PagePicture): string {
  const node = picture.nodes.find((item) => item.focused && (item.role === 'textbox' || item.role === 'searchbox'));
  if (!node) {
    return '';
  }
  return `当前焦点: ${formatControl(node, '-').slice(2)}`;
}

interface KeyedControl {
  key: string;
  node: SnapControl;
}

function keyed(nodes: SnapControl[]): KeyedControl[] {
  const seen = new Map<string, number>();
  const out: KeyedControl[] = [];
  for (const node of nodes) {
    const base = [node.role, node.name, node.value, node.hint, node.enabled ? '1' : '0', node.focused ? '1' : '0', String(node.level)].join('\u0001');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    out.push({ key: `${base}\u0001${count}`, node });
  }
  return out;
}

function diffRows(prev: string[], next: string[]): string[] {
  const before = countOf(prev);
  const after = countOf(next);
  const lines: string[] = [];
  for (const [row, count] of after) {
    const had = before.get(row) ?? 0;
    for (let i = had; i < count; i += 1) {
      lines.push(`+ ${row}`);
    }
  }
  for (const [row, count] of before) {
    const has = after.get(row) ?? 0;
    for (let i = has; i < count; i += 1) {
      lines.push(`- ${row}`);
    }
  }
  return lines;
}

function countOf(rows: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row, (counts.get(row) ?? 0) + 1);
  }
  return counts;
}

function appendFlashes(lines: string[], flashes: string[]): void {
  if (!flashes.length) {
    return;
  }
  lines.push('中间出现过:');
  for (const flash of flashes) {
    lines.push(`- ${flash}`);
  }
}

function parseControl(raw: unknown): SnapControl | undefined {
  const obj = asRecord(raw);
  const ref = textOf(obj['ref']);
  const role = textOf(obj['role']);
  if (!ref || !role) {
    return undefined;
  }
  return {
    ref,
    role,
    name: textOf(obj['name']),
    value: textOf(obj['value']),
    enabled: obj['enabled'] !== false,
    focused: obj['focused'] === true,
    level: numberOf(obj['level']),
    x: numberOf(obj['x']),
    y: numberOf(obj['y']),
    w: numberOf(obj['w']),
    h: numberOf(obj['h']),
    hint: textOf(obj['hint']),
  };
}

function stringsOf(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const text = item.trim();
    if (!text) {
      continue;
    }
    out.push(text.slice(0, 160));
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function textOf(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
}

function numberOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

const PAGE_HELPERS = `
function ogPushFlash(line) {
  const text = String(line || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  if (!text) return;
  const buf = window.__ogFlashes || (window.__ogFlashes = []);
  if (buf[buf.length - 1] === text) return;
  buf.push(text);
  if (buf.length > 8) buf.shift();
}
function ogInstallWatch() {
  if (window.__ogWatch) return;
  window.__ogWatch = true;
  if (!window.__ogFlashes) window.__ogFlashes = [];
  const wrap = (name) => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (msg) {
      ogPushFlash(name + '：' + msg);
      return orig.apply(this, arguments);
    };
  };
  wrap('alert');
  wrap('confirm');
  wrap('prompt');
  const seen = new WeakSet();
  const note = (node) => {
    if (!(node instanceof Element)) return;
    const dlg = node.matches('dialog,[role="dialog"],[aria-modal="true"]')
      ? node
      : node.querySelector('dialog,[role="dialog"],[aria-modal="true"]');
    if (dlg && !seen.has(dlg)) {
      seen.add(dlg);
      ogPushFlash('对话框：' + (dlg.getAttribute('aria-label') || dlg.innerText || dlg.textContent || ''));
    }
    const live = node.matches('[aria-live]') ? node : node.querySelector('[aria-live]');
    if (live) ogPushFlash('提示：' + (live.innerText || live.textContent || ''));
  };
  const obs = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) note(node);
      if (record.type === 'characterData' && record.target && record.target.parentElement) {
        const live = record.target.parentElement.closest('[aria-live]');
        if (live) ogPushFlash('提示：' + (live.innerText || live.textContent || ''));
      }
    }
  });
  if (document.documentElement) {
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }
}
function ogRect(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (rect.width < 2 || rect.height < 2) return null;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) return null;
  return rect;
}
function ogRole(el) {
  const explicit = (el.getAttribute && el.getAttribute('role')) || '';
  if (explicit) return explicit;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
  if (el.isContentEditable) return 'textbox';
  if (tag === 'input') {
    const kind = String(el.type || 'text').toLowerCase();
    if (kind === 'hidden' || kind === 'file') return '';
    if (kind === 'checkbox') return 'checkbox';
    if (kind === 'radio') return 'radio';
    if (kind === 'submit' || kind === 'button' || kind === 'reset') return 'button';
    if (kind === 'search') return 'searchbox';
    return 'textbox';
  }
  return '';
}
function ogClean(text) {
  return String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
}
function ogName(el) {
  const aria = el.getAttribute && el.getAttribute('aria-label');
  if (ogClean(aria)) return ogClean(aria);
  const ids = el.getAttribute && el.getAttribute('aria-labelledby');
  if (ids) {
    const text = ids.split(/\\s+/).map((id) => {
      const node = document.getElementById(id);
      return node ? (node.innerText || node.textContent || '') : '';
    }).join(' ');
    if (ogClean(text)) return ogClean(text);
  }
  if (el.id) {
    const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (lab && ogClean(lab.innerText || lab.textContent)) return ogClean(lab.innerText || lab.textContent);
  }
  const wrap = el.closest && el.closest('label');
  if (wrap && wrap !== el && ogClean(wrap.innerText || wrap.textContent)) return ogClean(wrap.innerText || wrap.textContent);
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'select') {
    const opt = el.selectedOptions && el.selectedOptions[0];
    return ogClean(opt ? (opt.label || opt.text || '') : '');
  }
  if (tag === 'input' || tag === 'textarea') {
    if (ogRole(el) === 'button' && el.value) return ogClean(el.value);
    return ogClean((el.getAttribute && el.getAttribute('title')) || '');
  }
  if (el.isContentEditable) return '';
  const alt = el.getAttribute && el.getAttribute('alt');
  if (ogClean(alt)) return ogClean(alt);
  const visible = ogClean(el.innerText || el.textContent || '');
  if (visible) return visible;
  return ogClean((el.getAttribute && el.getAttribute('title')) || '');
}
function ogInChrome(el) {
  return !!(el.closest && el.closest('header,nav,form,[role="banner"],[role="search"],[role="navigation"]'));
}
function ogHint(el, role) {
  const bits = [];
  if (role === 'textbox' || role === 'searchbox') {
    const ph = ogClean(el.placeholder || '');
    if (ph) bits.push('占位「' + ph + '」');
    const blob = ph + ' ' + (el.getAttribute && el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.className || '');
    if (ogInChrome(el) || el.type === 'search' || /搜索|search/i.test(blob)) bits.push('输入后按 Enter 提交');
  }
  if (role === 'link' && el.getAttribute) {
    const href = el.getAttribute('href') || '';
    if (href && href.indexOf('javascript:') !== 0) {
      try {
        const path = (new URL(href, location.href).pathname || '').slice(0, 48);
        if (path && path !== '/') bits.push(path);
      } catch (e) {}
    }
  }
  if (role === 'button' && ogInChrome(el)) {
    const blob = ogName(el) + ' ' + (el.className || '') + ' ' + ((el.getAttribute && el.getAttribute('title')) || '');
    if (/搜索|search/i.test(blob)) bits.push('提交搜索');
  }
  return bits.join('，').slice(0, 80);
}
function ogChromeExtras(seen) {
  const extras = [];
  document.querySelectorAll('header,nav,form,[role="banner"],[role="search"]').forEach((root) => {
    root.querySelectorAll('div,span,i,button,a').forEach((el) => {
      if (extras.length >= 8 || seen.has(el)) return;
      let style;
      try { style = getComputedStyle(el); } catch (e) { return; }
      if (!style || style.cursor !== 'pointer') return;
      const rect = ogRect(el);
      if (!rect || rect.width > 96 || rect.height > 72 || rect.width < 8) return;
      const name = ogName(el);
      if (!name) return;
      extras.push({ el: el, role: ogRole(el) || 'button', name: name, rect: rect, inDialog: false });
    });
  });
  return extras;
}
function ogValue(el, role) {
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    const checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
    return checked ? 'on' : 'off';
  }
  if (role === 'combobox' && el.tagName && el.tagName.toLowerCase() === 'select') {
    const opt = el.selectedOptions && el.selectedOptions[0];
    return ogClean(opt ? (opt.label || opt.text || '') : '');
  }
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
    if ('value' in el) return ogClean(el.value);
    if (el.isContentEditable) return ogClean(el.innerText || el.textContent || '');
  }
  return '';
}
function ogLevel(el, role) {
  if (role !== 'heading') return 0;
  const aria = Number(el.getAttribute && el.getAttribute('aria-level'));
  if (aria) return aria;
  const tag = (el.tagName || '').toLowerCase();
  const num = Number(tag.slice(1));
  return num || 0;
}
const OG_SELECTOR = 'a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="combobox"],[role="switch"],[role="searchbox"],[role="option"],[role="heading"],[contenteditable="true"],h1,h2,h3,h4';
function ogCollect(root, into) {
  if (!root || !root.querySelectorAll || into.length > 1500) return;
  root.querySelectorAll(OG_SELECTOR).forEach((el) => {
    if (into.length < 1500) into.push(el);
  });
  root.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) ogCollect(el.shadowRoot, into);
  });
}
function ogOwned(el) {
  if (!el.closest) return false;
  const owner = el.closest('a[href],button,summary,[role="button"]');
  return !!(owner && owner !== el);
}
function ogByRef(ref) {
  if (!ref) return null;
  const sel = '[data-og-ref="' + CSS.escape(ref) + '"]';
  const walk = (root) => {
    if (!root || !root.querySelector) return null;
    const hit = root.querySelector(sel);
    if (hit) return hit;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (!el.shadowRoot) continue;
      const inner = walk(el.shadowRoot);
      if (inner) return inner;
    }
    return null;
  };
  return walk(document);
}
function ogResolve(ref, role, name) {
  const direct = ogByRef(ref);
  if (direct) return direct;
  if (!role) return null;
  const hits = [];
  ogCollect(document, hits);
  const matched = hits.filter((el) => ogRole(el) === role && ogName(el) === name);
  if (matched.length > 1) return { ambiguous: true };
  return matched[0] || null;
}
function ogPointer(el) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  try { el.focus(); } catch (e) {}
  if (typeof el.click === 'function') el.click();
}
`;

const SNAPSHOT_BODY = `
ogInstallWatch();
const found = [];
ogCollect(document, found);
const topDialog = [...document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]')].filter(ogRect).pop() || null;
const prepared = [];
const seen = new Set();
for (const el of found) {
  if (seen.has(el) || ogOwned(el)) continue;
  seen.add(el);
  const role = ogRole(el);
  if (!role) continue;
  const rect = ogRect(el);
  if (!rect) continue;
  const name = ogName(el);
  if (role === 'heading' && !name) continue;
  prepared.push({ el, role, name, rect, inDialog: !!(topDialog && topDialog.contains(el)) });
}
for (const extra of ogChromeExtras(seen)) {
  prepared.push(extra);
  seen.add(extra.el);
}
prepared.sort((a, b) => {
  if (a.inDialog !== b.inDialog) return a.inDialog ? -1 : 1;
  return a.rect.top - b.rect.top || a.rect.left - b.rect.left;
});
const headings = prepared.filter((item) => item.role === 'heading');
const chrome = [];
const rest = [];
for (const item of prepared) {
  if (item.role === 'heading') continue;
  if (item.inDialog || ogInChrome(item.el) || item.role === 'textbox' || item.role === 'searchbox' || item.role === 'combobox') chrome.push(item);
  else rest.push(item);
}
const chosen = chrome.slice(0, 24).concat(rest.slice(0, 8)).concat(headings.slice(0, 4));
const hidden = Math.max(0, rest.length - 8);
const note = hidden > 0 ? ('还有 ' + hidden + ' 个内容链接。它们打开具体内容，不是页头功能。搜索用带「输入后按 Enter」的输入框。') : '';
let seq = window.__ogRefSeq || 0;
const nodes = [];
for (const item of chosen) {
  let ref = item.el.getAttribute('data-og-ref');
  if (!ref) {
    seq += 1;
    ref = 'e' + seq;
    item.el.setAttribute('data-og-ref', ref);
  }
  nodes.push({
    ref: ref,
    role: item.role,
    name: item.name,
    value: ogValue(item.el, item.role),
    enabled: item.el.disabled !== true && item.el.getAttribute('aria-disabled') !== 'true',
    focused: document.activeElement === item.el,
    level: ogLevel(item.el, item.role),
    x: Math.round(item.rect.left),
    y: Math.round(item.rect.top),
    w: Math.round(item.rect.width),
    h: Math.round(item.rect.height),
    hint: ogHint(item.el, item.role)
  });
}
window.__ogRefSeq = seq;
const rowRoot = topDialog || document;
const rows = [];
for (const table of rowRoot.querySelectorAll('table')) {
  if (!ogRect(table)) continue;
  for (const tr of table.querySelectorAll('tr')) {
    if (rows.length >= 12) break;
    if (!ogRect(tr)) continue;
    const cells = [...tr.children].map((cell) => ogClean(cell.innerText || cell.textContent)).filter(Boolean);
    if (cells.length) rows.push(cells.join(' | ').slice(0, 160));
  }
}
const vw = window.innerWidth || 1;
const vh = window.innerHeight || 1;
let canvas = false;
for (const el of document.querySelectorAll('canvas,video,iframe')) {
  const rect = el.getBoundingClientRect();
  if (rect.width * rect.height > vw * vh * 0.45) canvas = true;
}
const flashes = (window.__ogFlashes || []).slice(0, 8);
window.__ogFlashes = [];
return { nodes: nodes, rows: rows, canvas: canvas, flashes: flashes, truncated: chrome.length > 24, note: note };
`;

/** Installs the flash watcher once per document. */
export const ENSURE_WATCH_JS = `(() => { ${PAGE_HELPERS} ogInstallWatch(); return true; })()`;

/** Reads the viewport. Refs already on an element are kept. */
export const PAGE_SNAPSHOT_JS = `(() => { ${PAGE_HELPERS} ${SNAPSHOT_BODY} })()`;
