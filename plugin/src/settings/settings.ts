import { plat } from '../core/platform';
import { normalizeTermEncoding } from '../terminal/termEncoding';
import { DEFAULT_SETTINGS, type GrokSettings } from '../core/types';

export { settingNeedsRestart } from '../core/types';

export function readGrokSettings(): GrokSettings {
  const p = plat();
  const permission = p.getConfig('permissionMode', DEFAULT_SETTINGS.permissionMode);
  const locale = p.getConfig('locale', DEFAULT_SETTINGS.locale);
  return {
    cliPath: p.getConfig('cliPath', DEFAULT_SETTINGS.cliPath),
    preferWorkspaceBinary: p.getConfig(
      'preferWorkspaceBinary',
      DEFAULT_SETTINGS.preferWorkspaceBinary,
    ),
    minCliVersion: p.getConfig('minCliVersion', DEFAULT_SETTINGS.minCliVersion),
    permissionMode:
      permission === 'auto' || permission === 'acceptEdits' ? permission : 'ask',
    includeSelectionOnSend: p.getConfig(
      'includeSelectionOnSend',
      DEFAULT_SETTINGS.includeSelectionOnSend,
    ),
    alwaysApprove: p.getConfig('alwaysApprove', DEFAULT_SETTINGS.alwaysApprove),
    useTerminal: p.getConfig('useTerminal', DEFAULT_SETTINGS.useTerminal),
    locale: locale === 'en' || locale === 'zh-CN' ? locale : 'auto',
    notifySound: p.getConfig('notifySound', DEFAULT_SETTINGS.notifySound),
    termEncoding: normalizeTermEncoding(
      p.getConfig('termEncoding', DEFAULT_SETTINGS.termEncoding),
    ),
  };
}

export async function writeGrokSetting(
  key: keyof GrokSettings,
  value: GrokSettings[keyof GrokSettings],
): Promise<void> {
  await plat().setConfig(key, value);
}

export function normalizeSetting(
  key: keyof GrokSettings,
  value: string | boolean,
): GrokSettings[keyof GrokSettings] | undefined {
  switch (key) {
    case 'cliPath':
    case 'minCliVersion':
      return typeof value === 'string' ? value.trim() : undefined;
    case 'preferWorkspaceBinary':
    case 'includeSelectionOnSend':
    case 'alwaysApprove':
    case 'useTerminal':
    case 'notifySound':
      return typeof value === 'boolean' ? value : undefined;
    case 'permissionMode':
      return value === 'auto' || value === 'ask' || value === 'acceptEdits' ? value : undefined;
    case 'locale':
      return value === 'auto' || value === 'en' || value === 'zh-CN' ? value : undefined;
    case 'termEncoding':
      return typeof value === 'string' ? normalizeTermEncoding(value) : undefined;
    default:
      return undefined;
  }
}
