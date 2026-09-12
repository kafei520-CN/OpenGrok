import * as os from 'node:os';
import * as path from 'node:path';
import { BUNDLED_RELAY_TOKEN, listenPublicRelay, type PublicRelayListener } from './publicRelay';
import { handleAdmin, type AdminAuth } from './relayAdmin';
import {
  clampListenPort,
  configPath,
  DEFAULT_RELAY_FILE,
  loadRelayConfig,
  saveRelayConfig,
  type RelayFileConfig,
} from './relayConfig';

async function main(): Promise<void> {
  const home = process.env.GROK_WEB_HOME?.trim() || path.join(os.homedir(), '.grok', 'web');
  const loaded = loadRelayConfig(home, { resetAdmin: process.argv.includes('--reset-admin') });
  const cfg = loaded.cfg;
  const auth: AdminAuth = {
    user: cfg.adminUser,
    hash: cfg.adminHash,
    setHash(next) {
      cfg.adminHash = next;
      auth.hash = next;
    },
  };
  const publicHost = process.env.GROK_RELAY_HOST?.trim() || cfg.publicHost || DEFAULT_RELAY_FILE.publicHost;
  cfg.publicHost = publicHost;
  const envPort = Number(process.env.GROK_RELAY_PORT ?? '');
  const envLocked = Number.isInteger(envPort) && envPort > 0;
  let live: PublicRelayListener | undefined;
  const save = (patch: Partial<RelayFileConfig>) => {
    Object.assign(cfg, patch);
    saveRelayConfig(home, cfg);
    if (patch.listenPort !== undefined) {
      patch.listenPort = clampListenPort(patch.listenPort);
    }
    const next = patch.listenPort;
    if (!envLocked && next && live && next !== live.port) {
      setTimeout(() => {
        void bind(next).catch((error) => {
          process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
        });
      }, 80);
    }
  };
  async function bind(port: number): Promise<PublicRelayListener> {
    const prev = live;
    live = undefined;
    if (prev) {
      await prev.close();
    }
    live = await listenPublicRelay({
      port,
      bind: process.env.GROK_RELAY_BIND?.trim() || '0.0.0.0',
      officialToken: BUNDLED_RELAY_TOKEN,
      customToken: cfg.hostKey,
      publicHost: cfg.publicHost,
      maxFrameBytes: cfg.maxFrameBytes,
      maxFileBytes: cfg.maxFileBytes,
      bannedIps: cfg.bannedIps,
      onHttp: (socket, head, leftover, control) =>
        handleAdmin(socket, head, leftover, auth, control, save),
    });
    cfg.listenPort = live.port;
    const origin = `http://${cfg.publicHost}${live.port === 80 ? '' : `:${live.port}`}`;
    process.stdout.write(`grok web ${origin}\n`);
    process.stdout.write(`admin ${origin}/admin  user=${cfg.adminUser}\n`);
    return live;
  }
  await bind(envLocked ? envPort : cfg.listenPort);
  if (loaded.adminPass) {
    process.stdout.write(`admin password (shown once): ${loaded.adminPass}\n`);
  } else if (process.env.GROK_WEB_ADMIN_PASS?.trim()) {
    process.stdout.write('admin password set from GROK_WEB_ADMIN_PASS\n');
  }
  process.stdout.write(`custom plugin key: hostKey in ${configPath(home)}\n`);
  if (envLocked) {
    process.stdout.write(`listen port locked by GROK_RELAY_PORT=${envPort}\n`);
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
