import * as esbuild from 'esbuild';
import { cpSync, existsSync, globSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

if (test) {
  rmSync('dist/test', { recursive: true, force: true });
}
mkdirSync('dist/test', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
};

const webview = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  external: [],
};

const diffView = {
  ...common,
  entryPoints: ['src/webview/editor/diff.ts'],
  outfile: 'dist/diff.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  external: [],
};

const host = {
  ...common,
  entryPoints: ['src/chat/sidecar.ts'],
  outfile: 'dist/host.js',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
};

const relay = {
  ...common,
  entryPoints: ['src/remote/publicRelayServer.ts'],
  outfile: 'dist/relay.js',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
};

const shikiMonaco = {
  ...common,
  entryPoints: ['src/webview/editor/shiki-monaco.ts'],
  outfile: 'dist/shiki-monaco.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  external: [],
};

const tests = {
  ...common,
  entryPoints: globSync('src/**/*.test.ts').map((file) => file.replaceAll('\\', '/')),
  outdir: 'dist/test',
  format: 'cjs',
  external: ['vscode'],
  outExtension: { '.js': '.js' },
};

async function run() {
  if (test) {
    await esbuild.build(tests);
    return;
  }
  copyMonaco();
  copyKatex();
  if (watch) {
    const ctxs = await Promise.all([
      esbuild.context(extension),
      esbuild.context(webview),
      esbuild.context(diffView),
      esbuild.context(host),
      esbuild.context(relay),
      esbuild.context(shikiMonaco),
    ]);
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
    return;
  }
  await Promise.all([
    esbuild.build(extension),
    esbuild.build(webview),
    esbuild.build(diffView),
    esbuild.build(host),
    esbuild.build(relay),
    esbuild.build(shikiMonaco),
  ]);
}

function copyKatex() {
  const srcCss = path.join('node_modules', 'katex', 'dist', 'katex.min.css');
  const srcFonts = path.join('node_modules', 'katex', 'dist', 'fonts');
  const destDir = path.join('media', 'katex');
  if (!existsSync(srcCss) || !existsSync(srcFonts)) {
    console.warn('katex missing; math/chemistry markdown will fall back to code');
    return;
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(srcCss, path.join(destDir, 'katex.min.css'));
  cpSync(srcFonts, path.join(destDir, 'fonts'), { recursive: true });
}

function copyMonaco() {
  const src = path.join('node_modules', 'monaco-editor', 'min', 'vs');
  const dest = path.join('dist', 'monaco', 'vs');
  if (!existsSync(src)) {
    console.warn('monaco-editor missing; remote workspace falls back to a textarea');
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    cpSync(src, dest, {
      recursive: true,
      filter: (from) => !from.endsWith('.map'),
    });
  } catch (error) {
    if (existsSync(path.join(dest, 'loader.js'))) {
      console.warn('monaco copy skipped; existing dist/monaco/vs kept');
      return;
    }
    throw error;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
