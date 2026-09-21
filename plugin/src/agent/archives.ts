import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ZIP_EXTS = new Set(['zip', 'jar', 'war', 'ear', 'cbz', 'nupkg', 'whl', 'apk']);
const TAR_EXTS = new Set(['tar', 'tgz', 'tbz', 'tbz2']);
const OTHER_EXTS = new Set(['7z', 'rar', 'gz', 'bz2', 'xz']);

export const ARCHIVE_MIME: Record<string, string> = {
  zip: 'application/zip',
  jar: 'application/java-archive',
  war: 'application/java-archive',
  ear: 'application/java-archive',
  cbz: 'application/zip',
  nupkg: 'application/zip',
  whl: 'application/zip',
  apk: 'application/vnd.android.package-archive',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
};

export function archiveExt(filePath: string): string {
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('.tar.gz')) {
    return 'tgz';
  }
  if (lower.endsWith('.tar.bz2')) {
    return 'tbz2';
  }
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

export function isArchivePath(filePath: string): boolean {
  const ext = archiveExt(filePath);
  return ZIP_EXTS.has(ext) || TAR_EXTS.has(ext) || OTHER_EXTS.has(ext);
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

export function splitArchivePath(filePath: string): { archive: string; member?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(
    /^(.*\.(?:zip|jar|war|ear|cbz|nupkg|whl|apk|tar|tgz|tar\.gz|tar\.bz2))\/(.+)$/i,
  );
  if (!match?.[1] || !match[2]) {
    return { archive: filePath };
  }
  return { archive: match[1].replace(/\//g, path.sep), member: match[2] };
}

export function formatArchiveListing(archive: string, names: string[]): string {
  const label = path.basename(archive);
  if (!names.length) {
    return `Archive ${label} is empty.`;
  }
  return [`Archive ${label} (${names.length} entries):`, ...names].join('\n');
}

export async function readArchiveText(filePath: string): Promise<string> {
  const { archive, member } = splitArchivePath(filePath);
  const ext = archiveExt(archive);
  if (OTHER_EXTS.has(ext) && !TAR_EXTS.has(ext) && ext !== 'gz') {
    return `Archive ${path.basename(archive)} (${ext}). Use a shell tool to list or extract this format.`;
  }
  if (member) {
    return readArchiveMember(archive, member);
  }
  const names = await listArchiveEntries(archive);
  return formatArchiveListing(archive, names);
}

async function listArchiveEntries(archive: string): Promise<string[]> {
  const listed = await execFileAsync('tar', ['-tf', archive], {
    windowsHide: true,
    maxBuffer: 8_000_000,
  });
  return String(listed.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readArchiveMember(archive: string, member: string): Promise<string> {
  const extracted = await execFileAsync('tar', ['-xOf', archive, member.replace(/\\/g, '/')], {
    windowsHide: true,
    maxBuffer: 2_000_000,
    encoding: 'utf8',
  });
  return String(extracted.stdout);
}
