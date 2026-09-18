export type OgDispatchMessage = { type: string; [key: string]: unknown };

export type OgDispatchNext = (message: OgDispatchMessage) => Promise<void>;

export type OgDispatchWrap = (
  message: OgDispatchMessage,
  next: OgDispatchNext,
) => void | Promise<void>;

export type OgHostContext = {
  id: string;
  dir: string;
  onDispatch: (wrap: OgDispatchWrap) => void;
  postToUi: (payload: unknown) => void;
  controller: unknown;
};

export type OgHostPlugin = (ctx: OgHostContext) => void | Promise<void>;

export type OgPluginInfo = {
  id: string;
  name: string;
  enabled: boolean;
  dir: string;
  hasUi: boolean;
  hasHost: boolean;
  hasCss: boolean;
  ui?: string;
  css?: string;
  hostPath?: string;
};

export type OgPluginStateFile = {
  disabled?: string[];
};
