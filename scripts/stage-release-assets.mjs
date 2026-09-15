import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const VER = JSON.parse(readFileSync('package.json', 'utf8')).version;
const srcDir = process.argv[2] || 'release';
const destDir = process.argv[3] || 'release/github';

mkdirSync(destDir, { recursive: true });

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function mapName(file) {
  const base = path.basename(file);
  if (base === 'catalog.json' || base === 'SHA256SUMS' || base === 'builder-debug.yml') {
    return null;
  }
  if (/^latest.*\.yml$/i.test(base) || /\.blockmap$/i.test(base)) {
    return { name: base, alias: base };
  }
  if (/setup\.exe$/i.test(base) || (base.endsWith('.exe') && /win/i.test(base))) {
    return { name: `OpenGrok_${VER}_x64-setup.exe`, alias: 'OpenGrok_x64-setup.exe' };
  }
  if (/\.exe$/i.test(base)) {
    return { name: `OpenGrok_${VER}_x64-setup.exe`, alias: 'OpenGrok_x64-setup.exe' };
  }
  if (/portable\.zip$/i.test(base) || (/win/i.test(base) && /\.zip$/i.test(base))) {
    return { name: `OpenGrok_${VER}_x64-portable.zip`, alias: 'OpenGrok_x64-portable.zip' };
  }
  if (/\.dmg$/i.test(base)) {
    const arm = /arm64|aarch64/i.test(base);
    const arch = arm ? 'aarch64' : 'x64';
    return { name: `OpenGrok_${VER}_${arch}.dmg`, alias: `OpenGrok_${arch}.dmg` };
  }
  if (/\.zip$/i.test(base) && /mac|darwin|arm64|x64/i.test(base)) {
    const arm = /arm64|aarch64/i.test(base);
    const arch = arm ? 'aarch64' : 'x64';
    return { name: `OpenGrok_${VER}_${arch}.app.zip`, alias: `OpenGrok_${arch}.app.zip` };
  }
  if (/\.AppImage$/i.test(base)) {
    return { name: `OpenGrok_${VER}_amd64.AppImage`, alias: 'OpenGrok_amd64.AppImage' };
  }
  if (/\.deb$/i.test(base)) {
    return { name: `OpenGrok_${VER}_amd64.deb`, alias: 'OpenGrok_amd64.deb' };
  }
  if (/\.rpm$/i.test(base)) {
    return { name: `OpenGrok-${VER}-1.x86_64.rpm`, alias: 'OpenGrok.x86_64.rpm' };
  }
  if (/\.tar\.gz$/i.test(base) && /linux/i.test(base)) {
    return { name: `OpenGrok_${VER}_amd64.tar.gz`, alias: 'OpenGrok_amd64.tar.gz' };
  }
  if (/\.app\.tar\.gz$/i.test(base) || (/\.tar\.gz$/i.test(base) && /mac|darwin|arm64|aarch64/i.test(base))) {
    const arm = /arm64|aarch64/i.test(base);
    const arch = arm ? 'aarch64' : 'x64';
    return { name: `OpenGrok_${VER}_${arch}.app.tar.gz`, alias: `OpenGrok_${arch}.app.tar.gz` };
  }
  return null;
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64');
}

function writeUpdateYml(filePath, urlName, destYml) {
  const st = statSync(filePath);
  const sha = sha512Base64(filePath);
  writeFileSync(
    destYml,
    [
      `version: ${VER}`,
      'files:',
      `  - url: ${urlName}`,
      `    sha512: ${sha}`,
      `    size: ${st.size}`,
      `path: ${urlName}`,
      `sha512: ${sha}`,
      `releaseDate: '${new Date().toISOString()}'`,
      '',
    ].join('\n'),
  );
}

function ymlPathField(text) {
  const match = /^path:\s*(.+)$/m.exec(text);
  return match ? match[1].trim() : '';
}

function ensureYml(dir, ymlName, matchers) {
  const names = readdirSync(dir);
  const tests = Array.isArray(matchers) ? matchers : [matchers];
  let target;
  for (const matchFile of tests) {
    target = names.find(matchFile);
    if (target) {
      break;
    }
  }
  if (!target) {
    return;
  }
  const ymlPath = path.join(dir, ymlName);
  if (existsSync(ymlPath)) {
    const pointed = ymlPathField(readFileSync(ymlPath, 'utf8'));
    if (pointed && names.includes(pointed)) {
      return;
    }
  }
  writeUpdateYml(path.join(dir, target), target, ymlPath);
  staged.push(ymlName);
  console.log(`wrote ${ymlName} → ${target}`);
}

const files = walk(srcDir);
const staged = [];
for (const file of files) {
  const mapped = mapName(file);
  if (!mapped) {
    continue;
  }
  const original = path.basename(file);
  const to = path.join(destDir, mapped.name);
  copyFileSync(file, to);
  staged.push(mapped.name);
  if (mapped.alias && mapped.alias !== mapped.name) {
    copyFileSync(file, path.join(destDir, mapped.alias));
    staged.push(mapped.alias);
  }
  if (original !== mapped.name && original !== mapped.alias) {
    copyFileSync(file, path.join(destDir, original));
    staged.push(original);
  }
  console.log(`${original} → ${mapped.name}`);
}

ensureYml(destDir, 'latest.yml', [
  (name) => /win-.*-setup\.exe$/i.test(name),
  (name) => /_x64-setup\.exe$/i.test(name),
]);
ensureYml(destDir, 'latest-mac.yml', [
  (name) => /\.zip$/i.test(name) && /mac-x64/i.test(name),
  (name) => /\.zip$/i.test(name) && /mac|darwin/i.test(name) && !/win|portable/i.test(name),
]);
ensureYml(destDir, 'latest-linux.yml', [(name) => /\.AppImage$/i.test(name)]);

const sums = [];
for (const name of [...new Set(staged)].sort()) {
  const buf = readFileSync(path.join(destDir, name));
  sums.push(`${createHash('sha256').update(buf).digest('hex')}  ${name}`);
}
writeFileSync(path.join(destDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`staged ${[...new Set(staged)].length} files in ${destDir}`);
if (!staged.length) {
  process.exit(1);
}
