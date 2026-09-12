import { post, tr } from '../app';
import { pinFloating, releaseByClass } from './popover';

const MENU_CLASS = 'quote-menu';
let dummy: HTMLElement | undefined;

export function bindQuoteMenu(): void {
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.quote-menu')) {
      return;
    }
    closeQuoteMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeQuoteMenu();
    }
  });
}

export function closeQuoteMenu(): void {
  dummy?.remove();
  dummy = undefined;
  releaseByClass(MENU_CLASS);
}

function onContextMenu(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('textarea, input, [contenteditable="true"]')) {
    return;
  }
  const text = window.getSelection()?.toString().trim() ?? '';
  if (!text) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  closeQuoteMenu();
  const menu = document.createElement('div');
  menu.className = `picker-menu ${MENU_CLASS}`;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'picker-item';
  item.textContent = tr('quoteInChat');
  item.addEventListener('click', (click) => {
    click.stopPropagation();
    closeQuoteMenu();
    post({ type: 'quoteSelection', text });
  });
  menu.append(item);
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
