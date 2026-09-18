import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.OPENGROK_TRY = '1';

const require = createRequire(import.meta.url);
const DEV_DIR = path.join(root, '.electron-dev');

async function ensureDevElectron() {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const bin = path.join(DEV_DIR, exe);
  const packaged = path.join(DEV_DIR, 'resources', 'app.asar');
  if (fs.existsSync(bin) && !fs.existsSync(packaged)) {
    return bin;
  }
  fs.mkdirSync(DEV_DIR, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = String(pkg.devDependencies?.electron || pkg.dependencies?.electron || '37.10.3').replace(/^[^\d]*/, '');
  const { downloadArtifact } = require('@electron/get');
  const extract = require('extract-zip');
  console.log(`downloading electron ${version} for try...`);
  const zip = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
  });
  await extract(zip, { dir: DEV_DIR });
  if (!fs.existsSync(bin)) {
    throw new Error(`electron ${version} extract missed ${exe}`);
  }
  return bin;
}

function stop(child) {
  if (!child?.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

let electronBin;
let electronChild;
let restarting = false;
let restartTimer;

function startElectron() {
  if (!electronBin) {
    return;
  }
  electronChild = spawn(electronBin, ['.'], {
    cwd: root,
    env: { ...process.env, OPENGROK_TRY: '1', ELECTRON_RUN_AS_NODE: '' },
    stdio: 'inherit',
    windowsHide: false,
  });
  electronChild.on('exit', (code) => {
    if (restarting) {
      return;
    }
    process.exit(code ?? 0);
  });
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restarting = true;
    stop(electronChild);
    setTimeout(() => {
      restarting = false;
      startElectron();
    }, 400);
  }, 400);
}

const esbuild = spawn(process.execPath, [path.join(root, 'esbuild.mjs'), '--watch'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});

let started = false;
esbuild.stdout.on('data', (buf) => {
  const text = String(buf);
  process.stdout.write(text);
  if (!started && text.includes('watching')) {
    started = true;
    ensureDevElectron()
      .then((bin) => {
        electronBin = bin;
        startElectron();
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  }
});

esbuild.on('exit', (code) => {
  if (!started) {
    process.exit(code ?? 1);
  }
});

for (const dir of ['dist', path.join('plugin', 'dist')]) {
  const target = path.join(root, dir);
  fs.mkdirSync(target, { recursive: true });
  try {
    fs.watch(target, (_event, filename) => {
      const name = String(filename ?? '');
      if (name === 'main.js' || name === 'preload.js' || name === 'host.js') {
        scheduleRestart();
      }
    });
  } catch {
    /* ignore */
  }
}

process.on('SIGINT', () => {
  stop(electronChild);
  esbuild.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop(electronChild);
  esbuild.kill();
  process.exit(0);
});
