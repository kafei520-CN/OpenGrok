import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.OPENGROK_TRY = '1';

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
  try {
    fs.rmSync(DEV_DIR, { recursive: true, force: true });
  } catch (error) {
    if (usableDevElectron()) {
      console.warn(`reuse existing .electron-dev (${error instanceof Error ? error.message : error})`);
      writeTryAppManifest();
      return;
    }
    throw error;
  }
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

function extractZip(zipPath, dest) {
  // Node 24.16+ stalls extract-zip after the first zip entry, so the window never opens.
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  console.log(`extracting ${path.basename(zipPath)}`);
  const result = spawnSync(tar, ['-xf', zipPath, '-C', dest], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Could not extract ${path.basename(zipPath)} with ${tar}.`);
  }
}

async function downloadOfficialElectron(version) {
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
  extractZip(zipPath, DEV_DIR);
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
let allowRestart = false;
let openTimer;
let openTries = 0;

function electronEnv() {
  const env = { ...process.env, OPENGROK_TRY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function clearOpenTimer() {
  clearTimeout(openTimer);
  openTimer = undefined;
}

function startElectron() {
  if (!electronBin) {
    return;
  }
  if (electronChild && electronChild.exitCode == null && !restarting) {
    return;
  }
  openTries += 1;
  const attempt = openTries;
  console.log(`launching ${electronBin}`);
  // electron.exe is a GUI binary, so an inherited console swallows its stdout on Windows.
  electronChild = spawn(electronBin, ['.'], {
    cwd: root,
    env: electronEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let readyBuf = '';
  const forward = (chunk) => {
    readyBuf = (readyBuf + chunk.toString()).slice(-400);
    if (readyBuf.includes('OpenGrok window ready')) {
      clearOpenTimer();
    }
    process.stdout.write(chunk);
  };
  electronChild.stdout.on('data', forward);
  electronChild.stderr.on('data', forward);
  const child = electronChild;
  child.on('exit', (code) => {
    clearOpenTimer();
    if (restarting) {
      return;
    }
    console.error(`OpenGrok exited (${code ?? 0}).`);
    process.exit(code ?? 0);
  });
  // A fresh Electron often never reaches the window. Killing it and starting once more does.
  clearOpenTimer();
  openTimer = setTimeout(() => {
    if (electronChild !== child || child.exitCode != null || attempt >= 2) {
      if (electronChild === child && child.exitCode == null && attempt >= 2) {
        console.error('OpenGrok still has no window.');
      }
      return;
    }
    console.error('OpenGrok did not open a window. Starting it again.');
    restarting = true;
    stop(child);
    const again = () => {
      restarting = false;
      startElectron();
    };
    if (child.exitCode != null) {
      setTimeout(again, 400);
      return;
    }
    child.once('exit', () => setTimeout(again, 400));
  }, 8000);
}

function scheduleRestart() {
  if (!allowRestart) {
    return;
  }
  openTries = 0;
  clearOpenTimer();
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restarting = true;
    const previous = electronChild;
    stop(previous);
    const start = () => {
      restarting = false;
      startElectron();
    };
    if (!previous || previous.exitCode != null) {
      setTimeout(start, 300);
      return;
    }
    previous.once('exit', () => setTimeout(start, 300));
  }, 400);
}

console.log('compiling...');
const compiled = spawnSync(process.execPath, [path.join(root, 'esbuild.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: electronEnv(),
});
if (compiled.status !== 0) {
  process.exit(compiled.status ?? 1);
}

const esbuild = spawn(process.execPath, [path.join(root, 'esbuild.mjs'), '--watch'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: electronEnv(),
});

let markWatchReady = () => {};
const watchReady = new Promise((resolve) => {
  markWatchReady = resolve;
});
let watchBuf = '';
esbuild.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  watchBuf = (watchBuf + text).slice(-200);
  if (watchBuf.includes('watching')) {
    markWatchReady();
  }
});
esbuild.stdout.on('end', () => markWatchReady());

esbuild.on('exit', (code) => {
  markWatchReady();
  if (!electronChild) {
    process.exit(code ?? 1);
  }
});

console.log('launching...');
ensureDevElectron()
  .then(async (bin) => {
    electronBin = bin;
    await watchReady;
    startElectron();
    setTimeout(() => {
      allowRestart = true;
    }, 1500);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
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
