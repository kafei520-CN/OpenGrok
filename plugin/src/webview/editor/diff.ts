import type { FileDiff } from '../../edits/diff';
import { applyThemeTo } from '../../settings/theme';
import type { ThemeColors } from '../../core/types';
import { appendDiffFiles, mountDiffView, type DiffViewPayload } from './diffView';

type Payload = DiffViewPayload & { locale: DiffViewPayload['locale']; theme?: ThemeColors };

const vscode = (
  window as unknown as {
    acquireVsCodeApi: () => {
      postMessage(message: unknown): void;
    };
  }
).acquireVsCodeApi();

const root = document.getElementById('app') ?? document.body;
root.classList.add('og-diff');
let payload: Payload = { locale: 'en', files: [] };

window.addEventListener(
  'message',
  (event: MessageEvent<{ type: string; payload?: Payload; files?: FileDiff[] }>) => {
    if (event.data?.type === 'diff' && event.data.payload) {
      payload = event.data.payload;
      render();
      return;
    }
    if (event.data?.type === 'diffMore' && Array.isArray(event.data.files) && event.data.files.length) {
      payload.files = [...(payload.files ?? []), ...event.data.files];
      appendDiffFiles(event.data.files);
    }
  },
);

function render(): void {
  applyThemeTo(document.documentElement.style, payload.theme);
  mountDiffView(root, payload, {
    onRevert: () => vscode.postMessage({ type: 'revert' }),
    onOpenFile: (path) => vscode.postMessage({ type: 'openFile', path }),
  });
}

vscode.postMessage({ type: 'ready' });
