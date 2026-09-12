import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import {
  clampFileBytes,
  clampFrameBytes,
  clampListenPort,
  hashPassword,
  normalizeIp,
  verifyPassword,
  type RelayFileConfig,
} from './relayConfig';
import { isAdminPath, requestPath, type RelayControl } from './publicRelay';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX = 5;
const COOKIE = 'grok_web_admin';

export interface AdminAuth {
  user: string;
  hash: string;
  setHash(next: string): void;
}

interface HttpHead {
  method: string;
  url: string;
  headers: Record<string, string>;
  raw: Buffer;
}

export function handleAdmin(
  socket: Socket,
  head: HttpHead,
  leftover: Buffer,
  auth: AdminAuth,
  control: RelayControl,
  save: (patch: Partial<RelayFileConfig>) => void,
): boolean {
  const pathName = requestPath(head.url);
  if (!isAdminPath(pathName)) {
    return false;
  }
  const ip = normalizeIp(socket.remoteAddress);
  const sid = cookieValue(head.headers.cookie, COOKIE);
  const authed = Boolean(sid && sessions.get(sid) && sessions.get(sid)! > Date.now());
  void route(socket, head, leftover, {
    pathName,
    ip,
    sid,
    authed,
    auth,
    control,
    save,
  });
  return true;
}

const sessions = new Map<string, number>();
const loginHits = new Map<string, { n: number; reset: number }>();

async function route(
  socket: Socket,
  head: HttpHead,
  leftover: Buffer,
  ctx: {
    pathName: string;
    ip: string;
    sid?: string;
    authed: boolean;
    auth: AdminAuth;
    control: RelayControl;
    save: (patch: Partial<RelayFileConfig>) => void;
  },
): Promise<void> {
  const { pathName, authed } = ctx;
  if (head.method === 'GET' && pathName === '/admin') {
    writeHtml(socket, 200, authed ? dashboardPage(ctx.control) : loginPage(''));
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/login') {
    const body = await readBody(socket, leftover, head.headers['content-length']);
    const form = Object.fromEntries(new URLSearchParams(body));
    if (tooManyLogins(ctx.ip)) {
      writeHtml(socket, 429, loginPage('尝试过多，请稍后再试。'));
      return;
    }
    const userOk = safeEqual(form.user ?? '', ctx.auth.user);
    const passOk = verifyPassword(form.pass ?? '', ctx.auth.hash);
    if (!userOk || !passOk) {
      noteLoginFail(ctx.ip);
      writeHtml(socket, 401, loginPage('用户名或密码错误。'));
      return;
    }
    const id = randomBytes(24).toString('base64url');
    sessions.set(id, Date.now() + SESSION_MS);
    writeHtml(socket, 302, '', [
      'Location: /admin',
      `Set-Cookie: ${COOKIE}=${id}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=43200`,
    ]);
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/logout') {
    if (ctx.sid) {
      sessions.delete(ctx.sid);
    }
    writeHtml(socket, 302, '', ['Location: /admin', `Set-Cookie: ${COOKIE}=; Path=/admin; Max-Age=0`]);
    return;
  }
  if (!authed) {
    if (pathName.startsWith('/admin/api/')) {
      writeJson(socket, 401, { error: 'auth' });
      return;
    }
    writeHtml(socket, 302, '', ['Location: /admin']);
    return;
  }
  if (head.method === 'GET' && pathName === '/admin/api/state') {
    writeJson(socket, 200, snapshot(ctx.control));
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/api/kick') {
    const body = JSON.parse((await readBody(socket, leftover, head.headers['content-length'])) || '{}') as {
      ip?: string;
      slot?: string;
    };
    const n = ctx.control.kick(body.ip, body.slot);
    writeJson(socket, 200, { ok: true, n });
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/api/ban') {
    const body = JSON.parse((await readBody(socket, leftover, head.headers['content-length'])) || '{}') as {
      ip?: string;
    };
    const ip = normalizeIp(body.ip);
    if (!ip) {
      writeJson(socket, 400, { error: 'ip' });
      return;
    }
    ctx.control.ban(ip);
    ctx.save({ bannedIps: ctx.control.banned() });
    writeJson(socket, 200, { ok: true });
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/api/unban') {
    const body = JSON.parse((await readBody(socket, leftover, head.headers['content-length'])) || '{}') as {
      ip?: string;
    };
    ctx.control.unban(normalizeIp(body.ip));
    ctx.save({ bannedIps: ctx.control.banned() });
    writeJson(socket, 200, { ok: true });
    return;
  }
  if (head.method === 'POST' && pathName === '/admin/api/settings') {
    const body = JSON.parse((await readBody(socket, leftover, head.headers['content-length'])) || '{}') as {
      publicHost?: string;
      listenPort?: number;
      maxFrameBytes?: number;
      maxFileBytes?: number;
      rotateKey?: boolean;
      adminPass?: string;
    };
    const patch: Partial<RelayFileConfig> = {
      publicHost: String(body.publicHost ?? '').trim(),
      listenPort: clampListenPort(body.listenPort ?? ctx.control.port),
      maxFrameBytes: clampFrameBytes(body.maxFrameBytes),
      maxFileBytes: clampFileBytes(body.maxFileBytes),
    };
    ctx.control.patchSettings(patch);
    if (body.rotateKey) {
      patch.hostKey = ctx.control.rotateHostKey();
    }
    if (body.adminPass && body.adminPass.length >= 12) {
      const hashed = hashPassword(body.adminPass);
      ctx.auth.setHash(hashed);
      patch.adminHash = hashed;
    }
    ctx.save(patch);
    writeJson(socket, 200, {
      ok: true,
      hostKey: body.rotateKey ? patch.hostKey : undefined,
      listenPort: patch.listenPort,
      livePort: ctx.control.port,
    });
    return;
  }
  writeHtml(socket, 404, '<p>not found</p>');
}

function snapshot(control: RelayControl) {
  return {
    publicHost: control.publicHost,
    port: control.port,
    maxFrameBytes: control.maxFrameBytes,
    maxFileBytes: control.maxFileBytes,
    customKeySet: control.customKeySet,
    peers: control.peers(),
    banned: control.banned(),
  };
}

function tooManyLogins(ip: string): boolean {
  const row = loginHits.get(ip);
  return Boolean(row && row.reset > Date.now() && row.n >= LOGIN_MAX);
}

function noteLoginFail(ip: string): void {
  const now = Date.now();
  const row = loginHits.get(ip);
  if (!row || row.reset < now) {
    loginHits.set(ip, { n: 1, reset: now + LOGIN_WINDOW_MS });
    return;
  }
  row.n += 1;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (!left.length || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function cookieValue(raw: string | undefined, name: string): string | undefined {
  for (const part of String(raw ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

function readBody(socket: Socket, leftover: Buffer, lengthHeader: string | undefined): Promise<string> {
  const want = Math.min(64 * 1024, Math.max(0, Number(lengthHeader) || leftover.length));
  return new Promise((resolve) => {
    let buf = leftover;
    if (buf.length >= want) {
      resolve(buf.subarray(0, want).toString('utf8'));
      return;
    }
    const timer = setTimeout(() => {
      socket.removeListener('data', onData);
      resolve(buf.toString('utf8'));
    }, 4000);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= want) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        resolve(buf.subarray(0, want).toString('utf8'));
      }
    };
    socket.on('data', onData);
  });
}

function writeHtml(socket: Socket, status: number, body: string, extra: string[] = []): void {
  const reason = status === 302 ? 'Found' : status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : 'OK';
  send(socket, status, reason, 'text/html; charset=utf-8', body, extra);
}

function writeJson(socket: Socket, status: number, body: unknown): void {
  send(socket, status, status === 401 ? 'Unauthorized' : 'OK', 'application/json; charset=utf-8', JSON.stringify(body));
}

function send(
  socket: Socket,
  status: number,
  reason: string,
  type: string,
  body: string,
  extra: string[] = [],
): void {
  const payload = Buffer.from(body, 'utf8');
  const headers = [
    `HTTP/1.1 ${status} ${reason}`,
    `Content-Type: ${type}`,
    `Content-Length: ${payload.length}`,
    extra.some((row) => row.toLowerCase().startsWith('location:')) ? 'Connection: close' : 'Connection: close',
    ...extra,
    '',
    '',
  ].join('\r\n');
  socket.end(Buffer.concat([Buffer.from(headers, 'utf8'), payload]));
}

function loginPage(error: string): string {
  return shell(
    '登录',
    `<form class="card" method="post" action="/admin/login">
      <h1>Grok Web</h1>
      <p class="muted">控制面板。使用服务端管理员账号。</p>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <label>用户名<input name="user" autocomplete="username" required></label>
      <label>密码<input name="pass" type="password" autocomplete="current-password" required></label>
      <button type="submit">登录</button>
    </form>`,
  );
}

function dashboardPage(control: RelayControl): string {
  const peers = control.peers();
  const banned = control.banned();
  return shell(
    '控制面板',
    `<header class="bar"><h1>Grok Web</h1>
      <form method="post" action="/admin/logout"><button type="submit">退出</button></form></header>
    <section class="card">
      <h2>中转设置</h2>
      <p class="muted">官方插件走内置密钥，不用填这里的密钥。自定义插件必须使用下面的中转密钥。监听端口不必是 80，保存后会切换到新端口。</p>
      <label>公网主机 / 域名<input id="publicHost" value="${esc(control.publicHost)}"></label>
      <label>监听端口<input id="listenPort" type="number" min="1" max="65535" value="${control.port}"></label>
      <label>单帧上限（字节）<input id="maxFrame" type="number" value="${control.maxFrameBytes}"></label>
      <label>上传文件上限（字节）<input id="maxFile" type="number" value="${control.maxFileBytes}"></label>
      <label>新管理员密码（至少 12 位，留空不改）<input id="adminPass" type="password" autocomplete="new-password"></label>
      <p class="muted">当前自定义密钥：${control.customKeySet ? '已设置' : '未设置'}</p>
      <div class="row">
        <button type="button" id="save">保存</button>
        <button type="button" id="rotate" class="ghost">轮换自定义密钥</button>
      </div>
      <pre id="newKey" hidden></pre>
    </section>
    <section class="card">
      <h2>在线会话</h2>
      <p class="muted">公网用 IP/域名打开插件给出的地址，再填授权码。此处可踢线或拉黑 IP。</p>
      <table><thead><tr><th>槽</th><th>插件 IP</th><th>浏览器</th><th></th></tr></thead>
      <tbody>${
        peers.length
          ? peers
              .map(
                (row) => `<tr>
            <td><code>${esc(row.slot)}</code> <span class="tag">${row.kind === 'official' ? '官方' : '自定义'}</span></td>
            <td>${esc(row.pluginIp)}</td>
            <td>${row.browsers.map((ip) => esc(ip)).join('<br>') || '—'}</td>
            <td>
              <button data-kick-slot="${esc(row.slot)}">踢出槽</button>
              <button data-kick-ip="${esc(row.pluginIp)}">踢出 IP</button>
              <button data-ban="${esc(row.pluginIp)}" class="ghost">拉黑插件 IP</button>
              ${row.browsers.map((ip) => `<button data-ban="${esc(ip)}" class="ghost">拉黑 ${esc(ip)}</button>`).join('')}
            </td>
          </tr>`,
              )
              .join('')
          : '<tr><td colspan="4" class="muted">没有在线插件</td></tr>'
      }</tbody></table>
    </section>
    <section class="card">
      <h2>黑名单</h2>
      <div class="row">
        <input id="banIp" placeholder="IP">
        <button type="button" id="banAdd">拉黑</button>
      </div>
      <ul>${
        banned.length
          ? banned
              .map((ip) => `<li>${esc(ip)} <button data-unban="${esc(ip)}" class="ghost">解除</button></li>`)
              .join('')
          : '<li class="muted">空</li>'
      }</ul>
    </section>
    <script>
      const post = (url, body) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      document.getElementById('save').onclick = async () => {
        const listenPort = Number(document.getElementById('listenPort').value);
        const row = await post('/admin/api/settings', {
          publicHost: document.getElementById('publicHost').value,
          listenPort,
          maxFrameBytes: Number(document.getElementById('maxFrame').value),
          maxFileBytes: Number(document.getElementById('maxFile').value),
          adminPass: document.getElementById('adminPass').value,
        });
        const host = location.hostname;
        const next = Number(row.listenPort || listenPort);
        const cur = Number(location.port || (location.protocol === 'https:' ? 443 : 80));
        if (next && next !== cur) {
          setTimeout(() => { location.href = location.protocol + '//' + host + ':' + next + '/admin'; }, 400);
          return;
        }
        location.reload();
      };
      document.getElementById('rotate').onclick = async () => {
        const row = await post('/admin/api/settings', { rotateKey: true });
        const box = document.getElementById('newKey');
        box.hidden = false;
        box.textContent = '新自定义密钥（只显示一次）：\\n' + (row.hostKey || '');
      };
      document.getElementById('banAdd').onclick = async () => {
        await post('/admin/api/ban', { ip: document.getElementById('banIp').value });
        location.reload();
      };
      for (const btn of document.querySelectorAll('[data-kick-slot]')) {
        btn.addEventListener('click', async () => { await post('/admin/api/kick', { slot: btn.getAttribute('data-kick-slot') }); location.reload(); });
      }
      for (const btn of document.querySelectorAll('[data-kick-ip]')) {
        btn.addEventListener('click', async () => { await post('/admin/api/kick', { ip: btn.getAttribute('data-kick-ip') }); location.reload(); });
      }
      for (const btn of document.querySelectorAll('[data-ban]')) {
        btn.addEventListener('click', async () => { await post('/admin/api/ban', { ip: btn.getAttribute('data-ban') }); location.reload(); });
      }
      for (const btn of document.querySelectorAll('[data-unban]')) {
        btn.addEventListener('click', async () => { await post('/admin/api/unban', { ip: btn.getAttribute('data-unban') }); location.reload(); });
      }
    </script>`,
  );
}

function shell(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Grok Web · ${esc(title)}</title>
<style>
:root{color-scheme:dark}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#111;color:#eee}
main{width:min(880px,94vw);margin:32px auto 64px;display:grid;gap:16px}
h1{font-size:1.25rem;margin:0 0 8px}h2{font-size:1rem;margin:0 0 10px}
.muted{color:#9aa}.err{color:#f88}.card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px 18px}
label{display:grid;gap:6px;margin:10px 0}input,button,pre{font:inherit}
input{background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:8px 10px}
button{background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
button.ghost{background:#222;border:1px solid #444}
.bar{display:flex;justify-content:space-between;align-items:center;gap:12px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid #2a2a2a;vertical-align:top}
code{font-size:12px}.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;background:#243;color:#9fd}
pre{white-space:pre-wrap;background:#111;border:1px solid #333;border-radius:8px;padding:10px}
ul{padding-left:18px}
</style></head><body><main>${body}</main></body></html>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
