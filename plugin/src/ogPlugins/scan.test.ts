import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import {
  opengrokPluginsDir,
  scanOgPlugins,
  writePluginDisabled,
} from './scan';

const execFileAsync = promisify(execFile);

describe('OpenGrok plugin scan', () => {
  it('loads ui/host/css from ~/.opengrok/plugins and honors disable state', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'og-plug-'));
    const dir = path.join(opengrokPluginsDir(home), 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'plugin.json'),
      JSON.stringify({ id: 'demo', name: 'Demo' }),
      'utf8',
    );
    await writeFile(path.join(dir, 'ui.js'), 'OpenGrok.plugin(function(){})', 'utf8');
    await writeFile(path.join(dir, 'style.css'), 'body{}', 'utf8');
    const loaded = await scanOgPlugins({ homeDir: home });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.id, 'demo');
    assert.equal(loaded[0]?.hasUi, true);
    assert.equal(loaded[0]?.enabled, true);
    assert.ok(loaded[0]?.ui?.includes('OpenGrok.plugin'));

    await writePluginDisabled(home, ['demo']);
    const off = await scanOgPlugins({ homeDir: home });
    assert.equal(off[0]?.enabled, false);
    assert.equal(off[0]?.ui, undefined);
  });

  it('lets project plugins override user plugins with the same id', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'og-plug-'));
    const workspace = await mkdtemp(path.join(tmpdir(), 'og-ws-'));
    const userDir = path.join(opengrokPluginsDir(home), 'skin');
    const projDir = path.join(workspace, '.opengrok', 'plugins', 'skin');
    await mkdir(userDir, { recursive: true });
    await mkdir(projDir, { recursive: true });
    await writeFile(path.join(userDir, 'ui.js'), '/* user */', 'utf8');
    await writeFile(path.join(projDir, 'ui.js'), '/* project */', 'utf8');
    const loaded = await scanOgPlugins({ homeDir: home, workspaceFolder: workspace });
    assert.equal(loaded[0]?.ui?.includes('project'), true);
  });

  it('loads a zipped plugin sitting in ~/.opengrok/plugins', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'og-plug-'));
    const plugins = opengrokPluginsDir(home);
    const src = path.join(home, 'src');
    await mkdir(plugins, { recursive: true });
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, 'plugin.json'), JSON.stringify({ id: 'packed', name: 'Packed' }), 'utf8');
    await writeFile(path.join(src, 'ui.js'), 'OpenGrok.plugin(function(){})', 'utf8');
    const zip = path.join(plugins, 'packed.zip');
    await execFileAsync('tar', ['-a', '-cf', zip, '-C', src, 'plugin.json', 'ui.js'], {
      windowsHide: true,
    });
    const loaded = await scanOgPlugins({ homeDir: home });
    assert.equal(loaded.some((row) => row.id === 'packed' && row.hasUi), true);
    assert.ok(loaded.find((row) => row.id === 'packed')?.ui?.includes('OpenGrok.plugin'));
  });

  it('unwraps a zip whose files sit in one top-level folder', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'og-plug-'));
    const plugins = opengrokPluginsDir(home);
    const nested = path.join(home, 'src', 'demo-skin');
    await mkdir(plugins, { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'ui.js'), '/* nested zip */', 'utf8');
    const zip = path.join(plugins, 'demo-skin.zip');
    await execFileAsync('tar', ['-a', '-cf', zip, '-C', path.join(home, 'src'), 'demo-skin'], {
      windowsHide: true,
    });
    const loaded = await scanOgPlugins({ homeDir: home });
    assert.equal(loaded[0]?.id, 'demo-skin');
    assert.equal(loaded[0]?.ui?.includes('nested zip'), true);
  });
});
