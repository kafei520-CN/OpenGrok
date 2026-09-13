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
  setChrome(chrome: { background: string; foreground: string; surface?: 'glass' | 'solid' | 'endfield' }) {
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

contextBridge.exposeInMainWorld('opengrokPet', {
  ready() {
    ipcRenderer.send('pet-ready');
  },
  move(delta: { dx: number; dy: number }) {
    ipcRenderer.send('pet-move', delta);
  },
  endMove() {
    ipcRenderer.send('pet-end-move');
  },
  click() {
    ipcRenderer.send('pet-click');
  },
  dblclick() {
    ipcRenderer.send('pet-dblclick');
  },
  menu() {
    ipcRenderer.send('pet-menu');
  },
  setIgnore(ignore: boolean) {
    ipcRenderer.send('pet-ignore', ignore);
  },
  fit(opts: { bubble?: boolean; size?: number }) {
    ipcRenderer.send('pet-fit', opts);
  },
  onConfig(handler: (config: unknown) => void) {
    ipcRenderer.on('pet-config', (_event, config: unknown) => handler(config));
  },
  onStatus(handler: (status: string) => void) {
    ipcRenderer.on('pet-status', (_event, status: string) => handler(status));
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
