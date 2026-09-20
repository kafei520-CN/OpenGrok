import { post, tr } from '../app';
import { pinFloating, releaseByClass } from './popover';

const MENU_CLASS = 'file-link-menu';
let dummy: HTMLElement | undefined;

export function bindFileLinkMenu(): void {
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.file-link-menu')) {
      return;
    }
    closeFileLinkMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeFileLinkMenu();
    }
  });
}

export function closeFileLinkMenu(): void {
  dummy?.remove();
  dummy = undefined;
  releaseByClass(MENU_CLASS);
}

function onContextMenu(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const link = target.closest('.md-file');
  if (!(link instanceof HTMLElement)) {
    return;
  }
  const filePath = link.dataset.path?.trim();
  const lineRaw = link.dataset.line?.trim();
  const line = lineRaw ? Number(lineRaw) : undefined;
  if (!filePath) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  closeFileLinkMenu();
  const menu = document.createElement('div');
  menu.className = `picker-menu ${MENU_CLASS}`;
  menu.append(
    menuItem(tr('openFileLink'), () =>
      post({ type: 'openFile', path: filePath, line: Number.isFinite(line) ? line : undefined }),
    ),
    menuItem(tr('revealInExplorer'), () => post({ type: 'revealFile', path: filePath })),
  );
  dummy = document.createElement('div');
  dummy.style.position = 'fixed';
  dummy.style.left = `${event.clientX}px`;
  dummy.style.top = `${event.clientY}px`;
  dummy.style.width = '1px';
  dummy.style.height = '1px';
  dummy.style.pointerEvents = 'none';
  document.body.append(dummy);
  pinFloating(menu, dummy, { prefer: 'below', align: 'start' });
}

function menuItem(label: string, run: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'picker-item';
  item.textContent = label;
  item.addEventListener('click', (click) => {
    click.stopPropagation();
    closeFileLinkMenu();
    run();
  });
  return item;
}
