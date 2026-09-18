import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };

function run(args, optional = false) {
  const result = spawnSync(node, args, { cwd: root, stdio: 'inherit', env });
  if (result.error) {
    throw result.error;
  }
  if (result.status) {
    if (optional) {
      console.warn(`skipped: ${args.slice(1).join(' ')}`);
      return;
    }
    process.exit(result.status);
  }
}

run([path.join(root, 'esbuild.mjs'), '--minify']);

if (process.platform === 'darwin') {
  run([builder, '--mac', 'dmg', 'zip', '--x64', '--arm64', '--publish', 'never', '--config.electronVersion=37.10.3']);
} else if (process.platform === 'linux') {
  run([builder, '--linux', 'AppImage', '--linux', 'deb', '--linux', 'tar.gz', '--x64', '--publish', 'never', '--config.electronVersion=37.10.3']);
  run([builder, '--linux', 'rpm', '--x64', '--publish', 'never', '--config.electronVersion=37.10.3'], true);
} else {
  run([builder, '--win', 'nsis', 'zip', '--x64', '--publish', 'never', '--config.electronVersion=37.10.3']);
}
