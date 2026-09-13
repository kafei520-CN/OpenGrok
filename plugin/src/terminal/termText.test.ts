import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldCarriageReturns, normalizeTermStream, renderTermHtml } from './termAnsi';
import { normalizeTermEncoding } from './termEncoding';
import iconv from 'iconv-lite';
import { decodeTermBytes, decodeTermUnknown } from './termText';
import {
  isCmdCommand,
  isPowershellCommand,
  prepareWindowsSpawn,
  TermStreamDecoder,
  utf8CmdArgs,
  utf8PowershellArgs,
  wrapWindowsShellCommand,
} from './termSpawn';

describe('term encoding', () => {
  it('defaults unknown labels to utf-8', () => {
    assert.equal(normalizeTermEncoding(''), 'utf-8');
    assert.equal(normalizeTermEncoding('UTF8'), 'utf-8');
    assert.equal(normalizeTermEncoding('cp936'), 'gbk');
    assert.equal(normalizeTermEncoding('nope'), 'utf-8');
  });

  it('decodes gbk bytes when the runtime supports the label', () => {
    const bytes = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
    let supported = true;
    try {
      new TextDecoder('gbk');
    } catch {
      supported = false;
    }
    if (!supported) {
      return;
    }
    assert.equal(decodeTermBytes(bytes, 'gbk'), '你好');
    assert.equal(decodeTermUnknown(Buffer.from(bytes).toJSON().data, 'gbk'), '你好');
  });

  it('keeps an already-decoded string', () => {
    assert.equal(decodeTermUnknown('ok', 'gbk'), 'ok');
  });

  it('falls back to gbk when utf-8 bytes are invalid', () => {
    const bytes = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
    assert.equal(decodeTermBytes(bytes, 'utf-8'), '你好');
  });

  it('decodes cmd dir volume headers from gbk bytes', () => {
    const text = '驱动器 E 中的卷是 文档';
    const bytes = Uint8Array.from(iconv.encode(text, 'gbk'));
    assert.equal(decodeTermBytes(bytes, 'utf-8'), text);
  });

  it('decodes base64-wrapped gbk bytes from bash notifications', () => {
    const text = '驱动器 E 中的卷是 文档';
    const b64 = Buffer.from(iconv.encode(text, 'gbk')).toString('base64');
    assert.equal(decodeTermUnknown(b64, 'utf-8'), text);
  });

  it('does not keep a replacement-char string when bytes are available', () => {
    const raw = [...iconv.encode('驱动器', 'gbk')];
    assert.equal(decodeTermUnknown(raw, 'utf-8'), '驱动器');
    assert.equal(decodeTermUnknown('\uFFFD\uFFFD\uFFFD', 'utf-8'), '');
  });

  it('decodes a live cmd dir listing without replacement chars', () => {
    if (process.platform !== 'win32') {
      return;
    }
    const result = spawnSync(
      'cmd.exe',
      ['/c', 'dir', process.cwd()],
      { encoding: 'buffer', windowsHide: true },
    );
    const bytes = result.stdout ?? Buffer.alloc(0);
    assert.ok(bytes.length > 0);
    const lossy = bytes.toString('utf8');
    const text = decodeTermBytes(Uint8Array.from(bytes), 'utf-8');
    assert.equal(text.includes('\uFFFD'), false);
    assert.match(text, /目录|驱动器/);
    assert.ok(lossy.includes('\uFFFD') || text.includes('目录') || text.includes('驱动器'));
  });
});

describe('term spawn utf-8', () => {
  it('detects powershell hosts', () => {
    assert.equal(isPowershellCommand('powershell.exe'), true);
    assert.equal(isPowershellCommand('C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'), true);
    assert.equal(isPowershellCommand('pwsh'), true);
    assert.equal(isPowershellCommand('cmd.exe'), false);
  });

  it('injects utf-8 console encoding into powershell -Command', () => {
    const args = utf8PowershellArgs(['-NoProfile', '-Command', 'dir']);
    const command = args[args.indexOf('-Command') + 1] ?? '';
    assert.match(command, /UTF8Encoding/);
    assert.match(command, /dir/);
  });

  it('wraps cmd with chcp 65001', () => {
    const wrapped = wrapWindowsShellCommand('echo 你好');
    assert.match(wrapped.args.join(' '), /chcp 65001/);
    assert.match(wrapped.args.join(' '), /echo 你好/);
  });

  it('injects chcp 65001 into cmd /c args', () => {
    assert.equal(isCmdCommand('C:\\\\Windows\\\\System32\\\\cmd.exe'), true);
    const args = utf8CmdArgs(['/d', '/c', 'dir']);
    assert.match(args[args.indexOf('/c') + 1] ?? '', /chcp 65001/);
    assert.match(args[args.indexOf('/c') + 1] ?? '', /dir/);
  });

  it('prepares powershell shell strings with utf-8 console encoding', () => {
    if (process.platform !== 'win32') {
      return;
    }
    const prepared = prepareWindowsSpawn('powershell -NoProfile -Command dir', [], true);
    assert.equal(prepared.shell, false);
    const command = prepared.args[prepared.args.findIndex((item) => item.toLowerCase() === '-command') + 1] ?? '';
    assert.match(command, /UTF8Encoding/);
    assert.match(command, /dir/);
  });

  it('reassembles GBK Chinese split across chunks', () => {
    const bytes = iconv.encode('你好', 'gbk');
    const decoder = new TermStreamDecoder('utf-8');
    const first = decoder.push(bytes.subarray(0, 3));
    const second = decoder.push(bytes.subarray(3));
    const tail = decoder.flush();
    assert.equal(`${first}${second}${tail}`, '你好');
  });

  it('reassembles UTF-8 Chinese split across chunks', () => {
    const bytes = Buffer.from('你好', 'utf8');
    const decoder = new TermStreamDecoder('utf-8');
    const first = decoder.push(bytes.subarray(0, 2));
    const second = decoder.push(bytes.subarray(2));
    const tail = decoder.flush();
    assert.equal(`${first}${second}${tail}`, '你好');
  });
});

describe('term html', () => {
  it('folds CR progress onto the last segment', () => {
    assert.equal(foldCarriageReturns('a\rbo\rok\n'), 'ok\n');
    assert.equal(foldCarriageReturns('IDLE\rainEnd'), 'ainEnd');
  });

  it('keeps a trailing CR segment instead of wiping the line', () => {
    assert.equal(foldCarriageReturns('foo\rbar\r'), 'bar');
  });

  it('collapses stacked gradle progress bars', () => {
    const raw = [
      '<====--------> 33% EXECUTING [16s]',
      '<====--------> 33% EXECUTING [17s]',
      '> :copySharedAssets',
      '<=====-------> 38% EXECUTING [18s]',
      '<=====-------> 38% EXECUTING [19s]',
    ].join('\n');
    const out = normalizeTermStream(raw);
    assert.equal(out.includes('33% EXECUTING [16s]'), false);
    assert.match(out, /:copySharedAssets/);
    assert.match(out, /38% EXECUTING \[19s\]/);
  });

  it('honors cursor-up by dropping the previous line', () => {
    const out = normalizeTermStream('old\n\x1b[1Anew');
    assert.equal(out.includes('old'), false);
    assert.match(out, /new/);
  });

  it('escapes html and paints basic sgr colors', () => {
    const html = renderTermHtml('hi \x1b[31m<red>\x1b[0m');
    assert.equal(html.includes('&lt;red&gt;'), true);
    assert.equal(html.includes('t-fg-31'), true);
    assert.equal(html.includes('<red>'), false);
  });
});
