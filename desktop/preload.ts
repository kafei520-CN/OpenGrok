import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('opengrok', {
  post(message: unknown) {
    ipcRenderer.send('grok-ui', message);
  },
  onHost(handler: (message: unknown) => void) {
    ipcRenderer.on('grok-host', (_event, message: unknown) => {
      handler(message);
    });
  },
  setChrome(chrome: { background: string; foreground: string }) {
    ipcRenderer.send('grok-chrome', chrome);
  },
  window(action: 'min' | 'max' | 'close') {
    ipcRenderer.send('grok-window', action);
  },
  maximized(): Promise<boolean> {
    return ipcRenderer.invoke('grok-maximized');
  },
  onMaximized(handler: (value: boolean) => void) {
    ipcRenderer.on('grok-maximized', (_event, value: boolean) => {
      handler(value);
    });
  },
});

contextBridge.exposeInMainWorld('opengrokPrompt', {
  result(value: unknown) {
    ipcRenderer.send('grok-prompt-result', value);
  },
  cancel() {
    ipcRenderer.send('grok-prompt-result', undefined);
  },
  config(): Promise<PromptConfig> {
    return ipcRenderer.invoke('grok-prompt-config');
  },
});

export interface PromptConfig {
  mode: 'input' | 'password' | 'pick';
  title: string;
  prompt?: string;
  items?: Array<{ label: string; description?: string; value: unknown }>;
}
