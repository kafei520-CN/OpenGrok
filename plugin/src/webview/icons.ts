export function iconClock(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>';
}

export function iconGrid(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1"/></svg>';
}

export function iconPet(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.2 8.2 8 2.8l3.8 5.4-1.4 4.6H5.6z"/><path d="M6.6 7.6v1.7M9.4 7.6v1.7"/></svg>';
}

export function iconEdit(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9.2 3.4 12.6 6.8 6 13.4H2.6V10z"/></svg>';
}

export function iconPlus(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';
}

export function iconStar(size = '100%'): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="M12 1.1 14.35 9.65 22.9 12 14.35 14.35 12 22.9 9.65 14.35 1.1 12 9.65 9.65z"/></svg>`;
}

/** Grok mark: left comma first (red), right spike second (blue). */
export function grokBootMark(): string {
  return `<svg class="boot-logo" viewBox="0 0 35 33" width="72" height="68" fill="none" aria-hidden="true">
    <path class="boot-a" pathLength="1" d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341"/>
    <path class="boot-b" pathLength="1" d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436"/>
  </svg>`;
}

export function iconMore(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12" cy="8" r="1.2"/></svg>';
}

export function iconStop(): string {
  return '<svg viewBox="0 0 16 16" width="10" height="10"><rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor"/></svg>';
}

export function iconTarget(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.4"/><circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="8" r="0.6" fill="currentColor" stroke="none"/></svg>';
}

export function iconPause(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="4.2" y="3.2" width="2.4" height="9.6" rx="0.7"/><rect x="9.4" y="3.2" width="2.4" height="9.6" rx="0.7"/></svg>';
}

export function iconPlay(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5.2 3.4 12.4 8 5.2 12.6z"/></svg>';
}

export function iconSendNow(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2.4 3.2 8.2 8 2.4 12.8z"/><path d="M8.6 3.2 14.4 8 8.6 12.8z"/></svg>';
}

export function iconExpand(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M9.5 3.5h3v3M13.5 3.5 9.2 7.8M6.5 12.5h-3v-3M2.5 12.5 6.8 8.2"/></svg>';
}

export function iconCopy(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4A1.3 1.3 0 0 0 3.8 10.5H5.5"/></svg>';
}

export function iconFork(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="4.5" cy="4" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="11.5" cy="8" r="1.6"/><path d="M4.5 5.6v4.8M4.5 8h3.2c1.6 0 2.3.4 3.2 1.4"/></svg>';
}

export function iconRewind(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 6.1A5 5 0 1 1 3.9 9"/><path d="M4.5 3.2v3.1h3.1"/></svg>';
}

export function iconCheck(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.2 6.6 11.2 12.5 4.8"/></svg>';
}

export function iconChevron(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 6l4 4 4-4"/></svg>';
}

export function iconDown(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.8v9.4M4.1 8.6 8 12.6l3.9-4"/></svg>';
}

export function iconClose(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
}

/** Circled inverted exclamation (¡) for option hints. */
export function iconAskHint(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="5.15" r="0.95" fill="currentColor" stroke="none"/><path d="M8 7.35v4.05" stroke-linecap="round"/></svg>';
}

export function iconBack(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5 8l5 4.5"/></svg>';
}

export function iconFolder(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2.4 4.6h4.1l1.3 1.5h5.8v6.7H2.4z"/><path d="M2.4 6.1h11.2"/></svg>';
}

export function iconTrash(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3.5 4.5h9M6.2 4.5V3.4h3.6v1.1M5.2 6.2v6.2M8 6.2v6.2M10.8 6.2v6.2M4.4 4.5l.6 8.4h6l.6-8.4"/></svg>';
}

export function iconBook(): string {
  return '<svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M8 3.3C6.7 2.4 5.2 2.2 3.4 2.6v9.5c1.8-.4 3.3-.2 4.6.7 1.3-.9 2.8-1.1 4.6-.7V2.6C10.8 2.2 9.3 2.4 8 3.3z"/><path d="M8 3.4v9.4"/></svg>';
}

export function iconSearch(): string {
  return '<svg viewBox="0 0 16 16" width="70%" height="70%" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"><circle cx="6.8" cy="6.8" r="4.35"/><path d="m10.3 10.3 3.2 3.2"/></svg>';
}

export function iconMark(size = '100%'): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="currentColor"><path d="M32.2 9.2c-12.6 0-22.8 10.2-22.8 22.8s10.2 22.8 22.8 22.8c5.4 0 10.3-1.9 14.2-5.1L41.6 44.4A14.6 14.6 0 1 1 42 19.6l4.8-5.6A22.7 22.7 0 0 0 32.2 9.2z"/><path d="M14.2 52.6 48.6 11.8l4.2 3.6L18.4 56.2z"/></svg>`;
}

export function iconWrench(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M10.6 3.2a3.1 3.1 0 0 0-4.2 4.2L3.2 10.6 5.4 12.8l3.2-3.2a3.1 3.1 0 0 0 4.2-4.2L11.2 7 9 4.8z"/></svg>';
}

export function iconBug(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8.2" r="3.2"/><path d="M8 5V3.2M5.2 8.2H3.4M12.6 8.2h-1.8M5.6 5.6 4.4 4.4M10.4 5.6l1.2-1.2M5.6 10.8 4.4 12M10.4 10.8l1.2 1.2"/></svg>';
}

export function iconChat(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.2 3.4h9.6v7.2H6.4L3.2 13z"/></svg>';
}

export function iconPlug(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 3.2v3.2M10 3.2v3.2M4.4 6.4h7.2v2.2A3.6 3.6 0 0 1 8 12.2 3.6 3.6 0 0 1 4.4 8.6zM8 12.2V14"/></svg>';
}

export function iconChip(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.4"/><path d="M8 2.4v1.8M8 11.8v1.8M2.4 8h1.8M11.8 8h1.8"/></svg>';
}

export function iconKey(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="8" r="2.4"/><path d="M8.2 8h5.2l-1.2 1.2M11.2 8v1.4"/></svg>';
}

export function iconGear(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><circle cx="8" cy="8" r="2.1"/><path d="M8 2.4v1.5M8 12.1v1.5M2.4 8h1.5M12.1 8h1.5M4.05 4.05l1.06 1.06M10.89 10.89l1.06 1.06M4.05 11.95l1.06-1.06M10.89 5.11l1.06-1.06"/></svg>';
}

export function iconSpark(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 2.2 8.9 6.2 13 7.2 8.9 8.2 8 12.2 7.1 8.2 3 7.2 7.1 6.2z"/><path d="M12.2 2.8v2.2M13.3 3.9h-2.2M3.6 11.2v1.6M4.4 12h-1.6"/></svg>';
}

export function iconSun(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="2.4"/><path d="M8 2.4v1.4M8 12.2v1.4M2.4 8h1.4M12.2 8h1.4M4.1 4.1l1 1M10.9 10.9l1 1M11.9 4.1l-1 1M5.1 10.9l-1 1"/></svg>';
}

export function iconPerson(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="5.2" r="2.2"/><path d="M3.4 13.2c.6-2.4 2.3-3.6 4.6-3.6s4 1.2 4.6 3.6"/></svg>';
}

export function iconInfo(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 7.2V11" stroke-linecap="round"/><circle cx="8" cy="5.2" r="0.7" fill="currentColor" stroke="none"/></svg>';
}

export function toolIcon(kind?: string): string {
  switch (kind) {
    case 'edit':
    case 'write':
      return '✎';
    case 'read':
      return iconBook();
    case 'execute':
    case 'terminal':
      return '▷';
    case 'search':
      return iconSearch();
    case 'delete':
      return '⌫';
    default:
      return '⚙';
  }
}
