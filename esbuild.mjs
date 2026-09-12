import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'node20',
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['plugin/src/webview/main.ts'],
    outfile: 'plugin/dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['plugin/src/webview/editor/diff.ts'],
    outfile: 'plugin/dist/diff.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['plugin/src/webview/editor/shiki-monaco.ts'],
    outfile: 'plugin/dist/shiki-monaco.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['plugin/src/chat/sidecar.ts'],
    outfile: 'plugin/dist/host.js',
    platform: 'node',
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
  }),
  esbuild.build({
    ...common,
    entryPoints: ['desktop/main.ts'],
    outfile: 'dist/main.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  esbuild.build({
    ...common,
    entryPoints: ['desktop/preload.ts'],
    outfile: 'dist/preload.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
]);

copyKatex();
copyMonaco();

function copyKatex() {
  const srcCss = path.join('node_modules', 'katex', 'dist', 'katex.min.css');
  const srcFonts = path.join('node_modules', 'katex', 'dist', 'fonts');
  const destDir = path.join('plugin', 'media', 'katex');
  if (!existsSync(srcCss) || !existsSync(srcFonts)) {
    return;
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(srcCss, path.join(destDir, 'katex.min.css'));
  cpSync(srcFonts, path.join(destDir, 'fonts'), { recursive: true });
}

function copyMonaco() {
  const src = path.join('node_modules', 'monaco-editor', 'min', 'vs');
  const dest = path.join('plugin', 'dist', 'monaco', 'vs');
  if (!existsSync(src)) {
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (from) => !from.endsWith('.map'),
  });
}
