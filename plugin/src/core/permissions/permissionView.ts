import {
  permissionButtonClass,
  permissionLabelKey,
  type PermLabelKey,
} from './index';
import type { PermissionPrompt } from '../types';
import { fileName } from '../../webview/transcript/markdown';

export interface PermissionActionView {
  optionId: string;
  labelKey: PermLabelKey;
  className: string;
}

export function permissionTarget(perm: PermissionPrompt): string {
  const tick = perm.title.match(/`([^`]+)`/);
  if (tick) {
    return fileName(tick[1]);
  }
  if (perm.details && !perm.details.trim().startsWith('{')) {
    const first = perm.details.trim().split(/[\s\n]/)[0];
    if (first.includes('/') || first.includes('\\')) {
      return fileName(first);
    }
  }
  return perm.title;
}

export function permissionActions(perm: PermissionPrompt): PermissionActionView[] {
  return perm.options.map((option) => ({
    optionId: option.optionId,
    labelKey: permissionLabelKey(option, perm.toolKind),
    className: permissionButtonClass(option.kind),
  }));
}

export function permissionNeedsCancel(perm: PermissionPrompt): boolean {
  return perm.options.length === 0;
}
