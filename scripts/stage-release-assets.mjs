import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
  if (/\.blockmap$/i.test(base) || /latest.*\.yml$/i.test(base) || base === 'catalog.json') {
    return null;
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

const files = walk(srcDir);
const staged = [];
for (const file of files) {
  const mapped = mapName(file);
  if (!mapped) {
    continue;
  }
  const to = path.join(destDir, mapped.name);
  copyFileSync(file, to);
  copyFileSync(file, path.join(destDir, mapped.alias));
  staged.push(mapped.name, mapped.alias);
  console.log(`${path.basename(file)} → ${mapped.name} + ${mapped.alias}`);
}

const sums = [];
for (const name of [...new Set(staged)].sort()) {
  const buf = readFileSync(path.join(destDir, name));
  sums.push(`${createHash('sha256').update(buf).digest('hex')}  ${name}`);
}
writeFileSync(path.join(destDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`staged ${staged.length / 2} installers in ${destDir}`);
if (!staged.length) {
  process.exit(1);
}
