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
const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron';

function devElectronBin() {
  return path.join(DEV_DIR, exeName);
}

function usableDevElectron() {
  const bin = devElectronBin();
  if (!fs.existsSync(bin)) {
    return false;
  }
  if (fs.existsSync(path.join(DEV_DIR, 'resources', 'app.asar'))) {
    return false;
  }
  return true;
}

function unpackedRuntime() {
  if (process.platform !== 'win32') {
    return undefined;
  }
  const dir = path.join(root, 'release', 'win-unpacked');
  const exe = path.join(dir, 'OpenGrok.exe');
  return fs.existsSync(exe) ? dir : undefined;
}

function linkOrCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function stitchFromUnpacked(src) {
  console.log('using local Electron from release/win-unpacked (skip download)');
  fs.rmSync(DEV_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEV_DIR, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    if (entry.name === 'OpenGrok.exe') {
      linkOrCopy(from, path.join(DEV_DIR, 'electron.exe'));
      continue;
    }
    if (entry.name === 'resources') {
      continue;
    }
    const to = path.join(DEV_DIR, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      linkOrCopy(from, to);
    }
  }
  writeTryAppManifest();
}

function writeTryAppManifest() {
  const appDir = path.join(DEV_DIR, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      { name: 'opengrok', version: String(pkg.version || '0.0.0'), main: '../../../dist/main.js' },
      null,
      2,
    )}\n`,
  );
}

function electronZipName(version) {
  return `electron-v${version}-${process.platform}-${process.arch}.zip`;
}

function electronZipUrls(version) {
  const file = electronZipName(version);
  const envMirror = String(process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror || '')
    .trim()
    .replace(/\/?$/, '/');
  const urls = [
    `https://cdn.npmmirror.com/binaries/electron/v${version}/${file}`,
    `https://npmmirror.com/mirrors/electron/v${version}/${file}`,
    `https://github.com/electron/electron/releases/download/v${version}/${file}`,
  ];
  if (envMirror) {
    urls.unshift(`${envMirror}v${version}/${file}`);
  }
  return [...new Set(urls)];
}

function downloadZip(url, dest) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  console.log(`downloading ${url}`);
  const result = spawnSync(
    curl,
    ['-L', '--fail', '--retry', '2', '--connect-timeout', '20', '--max-time', '300', '-o', dest, url],
    { stdio: 'inherit' },
  );
  return result.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000;
}

async function downloadOfficialElectron(version) {
  const extract = require('extract-zip');
  const cacheDir = path.join(root, '.electron-dev-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, electronZipName(version));
  if (!(fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1_000_000)) {
    let got = false;
    for (const url of electronZipUrls(version)) {
      try {
        if (downloadZip(url, zipPath)) {
          got = true;
          break;
        }
      } catch (error) {
        console.warn(String(error));
      }
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    }
    if (!got) {
      throw new Error(
        `Could not download Electron ${version}. Set ELECTRON_MIRROR or unpack a build under release/win-unpacked.`,
      );
    }
  }
  fs.rmSync(DEV_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEV_DIR, { recursive: true });
  await extract(zipPath, { dir: DEV_DIR });
}

async function ensureDevElectron() {
  const bin = devElectronBin();
  if (usableDevElectron()) {
    writeTryAppManifest();
    return bin;
  }
  const local = unpackedRuntime();
  if (local) {
    stitchFromUnpacked(local);
    if (!fs.existsSync(bin)) {
      throw new Error(`local Electron stitch missed ${exeName}`);
    }
    return bin;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = String(pkg.devDependencies?.electron || pkg.dependencies?.electron || '37.10.3').replace(
    /^[^\d]*/,
    '',
  );
  console.log(`downloading electron ${version} for try...`);
  await downloadOfficialElectron(version);
  if (!fs.existsSync(bin)) {
    throw new Error(`electron ${version} extract missed ${exeName}`);
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

function electronEnv() {
  const env = { ...process.env, OPENGROK_TRY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function startElectron() {
  if (!electronBin) {
    return;
  }
  electronChild = spawn(electronBin, ['.'], {
    cwd: root,
    env: electronEnv(),
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
  env: electronEnv(),
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
