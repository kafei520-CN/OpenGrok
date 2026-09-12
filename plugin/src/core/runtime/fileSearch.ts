export const FILE_SEARCH_LIMIT = 30;
export const FILE_SEARCH_MIN = 2;
export const FILE_SEARCH_MAX_VISIT = 2_500;

export const FILE_SEARCH_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.idea',
  '.gradle',
  '.intellijPlatform',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  'coverage',
]);

export const FILE_SEARCH_EXCLUDE =
  '**/{node_modules,target,.git,dist,build,out,.idea,.gradle,.venv,venv,__pycache__,.next,coverage}/**';

export function shouldSearchFiles(query: string): boolean {
  return sanitizeGlobFragment(query).length >= FILE_SEARCH_MIN;
}

export function fileSearchGlob(query: string): string {
  return `**/*${sanitizeGlobFragment(query)}*`;
}

export function sanitizeGlobFragment(query: string): string {
  return query.trim().replace(/[*?{}\[\]\\]/g, '');
}
