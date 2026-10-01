import { execFile } from 'node:child_process';
import path from 'node:path';

const names = new Map<string, string>();

/** Windows default-app display name for a file extension. Empty when unknown. */
export function defaultAppName(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext || process.platform !== 'win32') {
    return Promise.resolve('');
  }
  const cached = names.get(ext);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const script = [
    `$ext = '${ext.replace(/'/g, '')}'`,
    '$prog = $null',
    'try { $prog = (Get-ItemProperty -LiteralPath "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice" -ErrorAction Stop).ProgId } catch {}',
    'if (-not $prog) {',
    '  $cmd = & "$env:SystemRoot\\System32\\cmd.exe" /d /c "assoc $ext" 2>$null',
    "  if ($cmd -match '=(.+)$') { $prog = $Matches[1].Trim() }",
    '}',
    "$name = ''",
    'if ($prog) {',
    "  foreach ($root in @('HKCU:\\Software\\Classes', 'HKLM:\\Software\\Classes')) {",
    '    $app = Join-Path $root "$prog\\Application"',
    '    try { $n = (Get-ItemProperty -LiteralPath $app -ErrorAction Stop).ApplicationName; if ($n) { $name = [string]$n; break } } catch {}',
    '  }',
    '}',
    'Write-Output $name',
  ].join('\n');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 4000 },
      (_error, stdout) => {
        const name = String(stdout ?? '')
          .trim()
          .split(/\r?\n/)
          .pop()
          ?.trim() ?? '';
        names.set(ext, name);
        resolve(name);
      },
    );
  });
}
