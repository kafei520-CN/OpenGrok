import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advertisedPublicUrl,
  buildSshArgs,
  classifySshError,
  clampSshPort,
  AUTO_FORWARD_MAX,
  AUTO_FORWARD_MIN,
  DEFAULT_PUBLIC_HOST,
  isBundledRelayHost,
  parseRelayEndpoint,
  pickAutoForwardPort,
  resolveForwardPort,
  resolvePublicHost,
  sanitizeTunnelHost,
  sanitizeTunnelUser,
} from './remoteTunnel';

describe('reverse tunnel helpers', () => {
  it('builds an outbound ssh reverse-forward command', () => {
    const args = buildSshArgs({
      host: '1.2.3.4',
      user: 'root',
      sshPort: 22,
      remotePort: 8787,
      localPort: 8787,
    });
    assert.ok(args.includes('-N'));
    assert.ok(args.includes('-R'));
    assert.ok(args.includes('0.0.0.0:8787:127.0.0.1:8787'));
    assert.ok(args.includes('root@1.2.3.4'));
    assert.ok(args.includes('BatchMode=yes'));
    assert.ok(args.includes('ExitOnForwardFailure=yes'));
    const withId = buildSshArgs(
      {
        host: '1.2.3.4',
        user: 'root',
        sshPort: 22,
        remotePort: 8787,
        localPort: 8787,
      },
      { identity: 'C:/tmp/id_ed25519', knownHosts: 'C:/tmp/known_hosts' },
    );
    assert.ok(withId.includes('-i'));
    assert.ok(withId.includes('IdentitiesOnly=yes'));
    assert.ok(withId.some((arg) => arg.includes('UserKnownHostsFile=')));
  });

  it('sanitizes host, user, and ssh port', () => {
    assert.equal(sanitizeTunnelHost('vps.example.com'), 'vps.example.com');
    assert.equal(sanitizeTunnelHost('10.0.0.8'), '10.0.0.8');
    assert.equal(sanitizeTunnelHost('https://vps.example.com:8788/admin'), 'vps.example.com');
    assert.equal(sanitizeTunnelHost('vps.example.com:8788'), 'vps.example.com');
    assert.equal(sanitizeTunnelHost('10.0.0.8; rm -rf /'), '');
    assert.deepEqual(parseRelayEndpoint('vps.example.com'), { host: 'vps.example.com', port: 8788 });
    assert.deepEqual(parseRelayEndpoint('10.0.0.8:9000'), { host: '10.0.0.8', port: 9000 });
    assert.deepEqual(parseRelayEndpoint('http://vps.example.com:9000/admin'), {
      host: 'vps.example.com',
      port: 9000,
    });
    assert.equal(sanitizeTunnelUser('ubuntu'), 'ubuntu');
    assert.equal(sanitizeTunnelUser('root;id'), 'root');
    assert.equal(clampSshPort(22), 22);
    assert.equal(clampSshPort(0), 1);
  });

  it('classifies ssh failures', () => {
    assert.equal(classifySshError('Permission denied (publickey).'), 'auth');
    assert.equal(classifySshError('Could not resolve hostname vps'), 'host');
    assert.equal(classifySshError('Error: remote port forwarding failed for listen port 8787'), 'forward');
    assert.equal(classifySshError('Load key "C:\\\\Users\\\\a\\\\.ssh\\\\id_rsa": invalid format'), 'keyfile');
    assert.equal(classifySshError('Host key verification failed.'), 'hostkey');
    assert.equal(
      classifySshError('Unable to negotiate: no matching host key type found. Their offer: ssh-rsa'),
      'hostkey',
    );
  });

  it('advertises http on the vps listen port', () => {
    assert.equal(advertisedPublicUrl('1.2.3.4', 8787), 'http://1.2.3.4:8787');
    assert.equal(advertisedPublicUrl('', 8787), '');
  });

  it('treats the built-in relay host as bundled', () => {
    assert.equal(isBundledRelayHost(DEFAULT_PUBLIC_HOST), true);
    assert.equal(isBundledRelayHost('10.0.0.2'), false);
  });

  it('defaults an empty public host to the built-in relay', () => {
    assert.equal(resolvePublicHost(''), DEFAULT_PUBLIC_HOST);
    assert.equal(resolvePublicHost('10.0.0.2'), '10.0.0.2');
    assert.equal(resolveForwardPort(''), 0);
    assert.equal(resolveForwardPort(9000), 9000);
    const auto = pickAutoForwardPort();
    assert.ok(auto >= AUTO_FORWARD_MIN && auto <= AUTO_FORWARD_MAX);
  });
});
