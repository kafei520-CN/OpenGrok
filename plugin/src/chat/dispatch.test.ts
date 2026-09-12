import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GrokController } from './controller';
import { dispatchUi } from './dispatch';

describe('dispatchUi', () => {
  it('routes editUserPrompt so confirm can rewind and resend', async () => {
    const seen: string[] = [];
    const controller = {
      async editUserPrompt(messageId: string, text: string) {
        seen.push(`${messageId}:${text}`);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'editUserPrompt', messageId: 'u1', text: 'hello' });
    assert.deepEqual(seen, ['u1:hello']);
  });

  it('routes quoteSelection into chat attachments', async () => {
    const seen: string[] = [];
    const controller = {
      quoteText(text: string) {
        seen.push(text);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'quoteSelection', text: 'picked line' });
    assert.deepEqual(seen, ['picked line']);
  });

  it('routes pasteClipboard so dropped files attach', async () => {
    const seen: string[][] = [];
    const controller = {
      async pasteClipboard(payload: { uris?: string[] }) {
        seen.push(payload.uris ?? []);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, {
      type: 'pasteClipboard',
      uris: ['file:///C:/work/a.ts'],
    });
    assert.deepEqual(seen, [['file:///C:/work/a.ts']]);
  });

  it('routes skipLogin so the start screen is not required', async () => {
    const seen: string[] = [];
    const controller = {
      async skipLogin() {
        seen.push('skip');
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'skipLogin' });
    assert.deepEqual(seen, ['skip']);
  });

  it('routes useApiLogin to skip then open API settings', async () => {
    const seen: string[] = [];
    const controller = {
      async useApiLogin() {
        seen.push('api');
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'useApiLogin' });
    assert.deepEqual(seen, ['api']);
  });

  it('routes wallpaper preview open and close', async () => {
    const seen: string[] = [];
    const controller = {
      openThemePreview() {
        seen.push('open');
      },
      closeThemePreview() {
        seen.push('close');
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'openThemePreview' });
    await dispatchUi(controller, { type: 'closeThemePreview' });
    assert.deepEqual(seen, ['open', 'close']);
  });

  it('routes remote access start and pair rotation', async () => {
    const seen: string[] = [];
    const controller = {
      openRemote() {
        seen.push('open');
      },
      async startRemoteAccess(port?: number) {
        seen.push(`start:${port ?? ''}`);
      },
      rotateRemoteCode() {
        seen.push('rotate');
      },
      setRemoteAuth(fields: { mode?: string; secret?: string }) {
        seen.push(`auth:${fields.mode ?? ''}:${fields.secret ?? ''}`);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'openRemote' });
    await dispatchUi(controller, { type: 'startRemote', port: 8787 });
    await dispatchUi(controller, { type: 'rotateRemoteCode' });
    await dispatchUi(controller, { type: 'setRemoteAuth', mode: 'custom', secret: 'ok-pass' });
    assert.deepEqual(seen, ['open', 'start:8787', 'rotate', 'auth:custom:ok-pass']);
  });

  it('routes workspace list and file open', async () => {
    const seen: string[] = [];
    const controller = {
      async listWorkspace(dir?: string) {
        seen.push(`list:${dir ?? ''}`);
      },
      async openWorkspaceFile(filePath: string) {
        seen.push(`open:${filePath}`);
      },
      async saveWorkspaceFile(filePath: string, hash: string) {
        seen.push(`save:${filePath}:${hash}`);
      },
      async mutateWorkspace(op: { action: string; name?: string }) {
        seen.push(`mutate:${op.action}:${op.name ?? ''}`);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'setRemoteView', view: 'workspace' });
    await dispatchUi(controller, { type: 'listWorkspace', dir: 'src' });
    await dispatchUi(controller, { type: 'openWorkspaceFile', path: 'src/a.ts' });
    await dispatchUi(controller, { type: 'saveWorkspaceFile', path: 'src/a.ts', hash: 'abc', text: 'x' });
    await dispatchUi(controller, { type: 'mutateWorkspace', action: 'create', dir: '', name: 'n.ts', kind: 'file' });
    assert.deepEqual(seen, [
      'list:',
      'list:src',
      'open:src/a.ts',
      'save:src/a.ts:abc',
      'mutate:create:n.ts',
    ]);
  });

  it('routes public remote seats and advertised url', async () => {
    const seen: string[] = [];
    const controller = {
      async setRemotePublicUrl(url: string) {
        seen.push(`url:${url}`);
      },
      async setRemoteTunnel(fields: { host?: string }) {
        seen.push(`tunnel:${fields.host ?? ''}`);
      },
    } as unknown as GrokController;
    await dispatchUi(controller, { type: 'setRemotePublicUrl', url: 'http://vps:8787' });
    await dispatchUi(controller, { type: 'setRemoteTunnel', host: '1.2.3.4', user: 'root' });
    assert.deepEqual(seen, ['url:http://vps:8787', 'tunnel:1.2.3.4']);
  });
});
