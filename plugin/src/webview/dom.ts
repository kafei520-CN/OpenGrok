export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = primary ? 'btn primary' : 'btn';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

export function iconButton(title: string, svg: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-btn';
  el.title = title;
  el.innerHTML = svg;
  el.addEventListener('click', onClick);
  return el;
}

export function replaceSlot(id: string, node: HTMLElement, parent: HTMLElement): void {
  node.id = id;
  const prev = document.getElementById(id);
  if (prev) {
    prev.replaceWith(node);
    return;
  }
  parent.append(node);
}

export function removeSlot(id: string): void {
  document.getElementById(id)?.remove();
}
