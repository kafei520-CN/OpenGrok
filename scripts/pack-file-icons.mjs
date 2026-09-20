import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'plugin', 'media', 'file-icons');
const outFile = path.join(root, 'plugin', 'src', 'webview', 'transcript', 'fileIcons.ts');

const EXT_MAP = {
  ts: 'file_type_typescript',
  tsx: 'file_type_reactjs',
  js: 'file_type_js',
  jsx: 'file_type_reactjs',
  mjs: 'file_type_js',
  cjs: 'file_type_js',
  json: 'file_type_json',
  md: 'file_type_markdown',
  markdown: 'file_type_markdown',
  css: 'file_type_css',
  scss: 'file_type_css',
  less: 'file_type_css',
  html: 'file_type_html',
  htm: 'file_type_html',
  xml: 'file_type_xml',
  svg: 'file_type_svg',
  py: 'file_type_python',
  rs: 'file_type_rust',
  go: 'file_type_go',
  java: 'file_type_java',
  jar: 'file_type_java',
  kt: 'file_type_kotlin',
  kts: 'file_type_kotlin',
  cs: 'file_type_csharp',
  c: 'file_type_c',
  h: 'file_type_c',
  cpp: 'file_type_cpp',
  hpp: 'file_type_cpp',
  cc: 'file_type_cpp',
  yml: 'file_type_yaml',
  yaml: 'file_type_yaml',
  toml: 'file_type_toml',
  sql: 'file_type_sql',
  vue: 'file_type_vue',
  svelte: 'file_type_svelte',
  sh: 'file_type_shell',
  bash: 'file_type_shell',
  zsh: 'file_type_shell',
  ps1: 'file_type_powershell',
  pdf: 'file_type_pdf',
  png: 'file_type_image',
  jpg: 'file_type_image',
  jpeg: 'file_type_image',
  gif: 'file_type_image',
  webp: 'file_type_image',
  gradle: 'file_type_gradle',
  pom: 'file_type_maven',
};

function packSvg(raw, id) {
  let svg = String(raw)
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .trim();
  svg = svg.replace(/<svg\b([^>]*)>/i, (_all, attrs) => {
    let next = String(attrs)
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\sclass="[^"]*"/g, '');
    return `<svg class="md-file-icon" width="16" height="16"${next}>`;
  });
  return `  ${JSON.stringify(id)}: ${JSON.stringify(svg)}`;
}

const svgs = {};
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.svg')) continue;
  const id = file.replace(/\.svg$/i, '');
  svgs[id] = fs.readFileSync(path.join(srcDir, file), 'utf8');
}

const entries = [packSvg(svgs.default_file, 'default')];
if (svgs.default_folder) {
  entries.push(packSvg(svgs.default_folder, 'folder'));
}
for (const [ext, id] of Object.entries(EXT_MAP)) {
  const raw = svgs[id];
  if (!raw) continue;
  entries.push(packSvg(raw, ext));
}
const lines = [
  '/* Packed from vscode-icons (MIT): https://github.com/vscode-icons/vscode-icons */',
  'export const FILE_ICON_SVG: Record<string, string> = {',
  entries.join(',\n'),
  '};',
];
lines.push('');
lines.push('export function fileIconSvg(ext: string): string {');
lines.push('  return FILE_ICON_SVG[ext.toLowerCase()] ?? FILE_ICON_SVG.default ?? \'\';');
lines.push('}');
lines.push('');

fs.writeFileSync(outFile, lines.join('\n'));
console.log('wrote', path.relative(root, outFile));
