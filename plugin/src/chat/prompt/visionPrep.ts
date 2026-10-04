import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Long edge sent to the model. UI text stays readable without a huge payload. */
export const VISION_LONG_EDGE = 2048;

export const VISION_HINT =
  '用户附了界面截图。先看全图，再看后面的红标特写。若另附了图中文字，以文字为准。先指出红框或箭头标出的目标，再修改。';

export interface VisionImage {
  mimeType: string;
  data: string;
}

export interface PreparedVision {
  images: VisionImage[];
  note: string;
}

export interface RedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

/** A red mark is useful when it is a region, not a few pixels and not the whole frame. */
export function shouldCropRed(box: RedBox, width: number, height: number): boolean {
  if (box.count < 40 || width <= 0 || height <= 0 || box.w <= 0 || box.h <= 0) {
    return false;
  }
  const ratio = (box.w * box.h) / (width * height);
  return ratio >= 0.004 && ratio <= 0.72;
}

export function padBox(
  box: RedBox,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const padX = Math.max(24, Math.round(box.w * 0.18));
  const padY = Math.max(24, Math.round(box.h * 0.18));
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const right = Math.min(width, box.x + box.w + padX);
  const bottom = Math.min(height, box.y + box.h + padY);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

/** Tall screenshots are split so a later downscale does not erase the text. */
export function tileSpans(width: number, height: number): Array<{ y: number; h: number }> {
  if (height < 1700 || height < width * 1.7) {
    return [];
  }
  const strip = 1200;
  const overlap = 160;
  const spans: Array<{ y: number; h: number }> = [];
  let y = 0;
  while (y < height && spans.length < 4) {
    const h = Math.min(strip, height - y);
    spans.push({ y, h });
    if (y + h >= height) {
      break;
    }
    y += strip - overlap;
  }
  return spans;
}

export async function prepareVisionImage(input: {
  mimeType?: string;
  data: string;
  region?: { x: number; y: number; width: number; height: number };
}): Promise<PreparedVision> {
  const original: VisionImage = {
    mimeType: input.mimeType?.startsWith('image/') ? input.mimeType : 'image/png',
    data: input.data,
  };
  if (process.platform !== 'win32' || input.data.length < 48) {
    return { images: [original], note: '' };
  }
  try {
    const prepared = await runWindowsPrep(input.data, input.region);
    if (!prepared.images.length) {
      return { images: [original], note: '' };
    }
    return prepared;
  } catch {
    return { images: [original], note: '' };
  }
}

async function runWindowsPrep(
  b64: string,
  region?: { x: number; y: number; width: number; height: number },
): Promise<PreparedVision> {
  const dir = await mkdtemp(join(tmpdir(), 'og-vision-'));
  const imagePath = join(dir, 'in.b64');
  const scriptPath = join(dir, 'prep.ps1');
  const regionArg =
    region && region.width > 1 && region.height > 1
      ? `${Math.round(region.x)},${Math.round(region.y)},${Math.round(region.width)},${Math.round(region.height)}`
      : '';
  try {
    await writeFile(imagePath, b64, 'utf8');
    await writeFile(scriptPath, PREP_SCRIPT, 'utf8');
    const stdout = await powershell(scriptPath, imagePath, regionArg);
    const line = stdout
      .split(/\r?\n/)
      .map((row) => row.trim())
      .reverse()
      .find((row) => row.startsWith('{') && row.endsWith('}'));
    if (!line) {
      throw new Error('vision prep returned no json');
    }
    const parsed = JSON.parse(line) as {
      images?: Array<{ data?: string; note?: string }>;
      ocr?: string;
    };
    const images: VisionImage[] = [];
    const notes: string[] = [];
    for (const image of parsed.images ?? []) {
      if (!image.data) {
        continue;
      }
      images.push({ mimeType: 'image/png', data: image.data });
      if (image.note) {
        notes.push(image.note);
      }
    }
    const ocr = (parsed.ocr ?? '').trim();
    if (ocr) {
      notes.push(`图中文字：\n${ocr.slice(0, 2500)}`);
    }
    return { images, note: notes.join('\n\n') };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function powershell(script: string, imagePath: string, region: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-ImagePath',
        imagePath,
        '-Region',
        region,
      ],
      { windowsHide: true },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('vision prep timed out'));
    }, 25_000);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(err.trim() || `vision prep exit ${code}`));
    });
  });
}

const PREP_SCRIPT = String.raw`
param([string]$ImagePath, [string]$Region)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
function New-White([System.Drawing.Image]$src) {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g.Dispose()
  return $bmp
}
function Resize-Edge([System.Drawing.Bitmap]$bmp, [int]$maxEdge) {
  $long = [Math]::Max($bmp.Width, $bmp.Height)
  if ($long -le $maxEdge) { return $bmp }
  $scale = $maxEdge / $long
  $nw = [Math]::Max(1, [int]($bmp.Width * $scale))
  $nh = [Math]::Max(1, [int]($bmp.Height * $scale))
  $dst = New-Object System.Drawing.Bitmap $nw, $nh
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($bmp, 0, 0, $nw, $nh)
  $g.Dispose()
  return $dst
}
function Crop-Rect([System.Drawing.Bitmap]$bmp, [int]$x, [int]$y, [int]$w, [int]$h) {
  $x = [Math]::Max(0, [Math]::Min($x, $bmp.Width - 1))
  $y = [Math]::Max(0, [Math]::Min($y, $bmp.Height - 1))
  $w = [Math]::Max(1, [Math]::Min($w, $bmp.Width - $x))
  $h = [Math]::Max(1, [Math]::Min($h, $bmp.Height - $y))
  $rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
  return $bmp.Clone($rect, $bmp.PixelFormat)
}
function To-B64([System.Drawing.Image]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $text = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  return $text
}
function Find-Red([System.Drawing.Bitmap]$bmp) {
  $maxW = 480
  $scale = 1.0
  $small = $bmp
  $owned = $false
  if ($bmp.Width -gt $maxW) {
    $scale = $bmp.Width / $maxW
    $small = Resize-Edge $bmp $maxW
    $owned = $true
  }
  $minX = $small.Width; $minY = $small.Height; $maxX = -1; $maxY = -1; $count = 0
  for ($y = 0; $y -lt $small.Height; $y += 2) {
    for ($x = 0; $x -lt $small.Width; $x += 2) {
      $c = $small.GetPixel($x, $y)
      if ($c.R -ge 200 -and $c.G -le 90 -and $c.B -le 90 -and ($c.R - $c.G) -ge 100) {
        $count++
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($owned) { $small.Dispose() }
  if ($count -lt 40) { return $null }
  $x0 = [int]($minX * $scale); $y0 = [int]($minY * $scale)
  $x1 = [int](($maxX + 2) * $scale); $y1 = [int](($maxY + 2) * $scale)
  return @{ x = $x0; y = $y0; w = [Math]::Max(1, $x1 - $x0); h = [Math]::Max(1, $y1 - $y0); count = $count }
}
function Get-Ocr([System.Drawing.Bitmap]$bmp) {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray(); $ms.Dispose()
    $writer = New-Object Windows.Storage.Streams.DataWriter ($stream.GetOutputStreamAt(0))
    $writer.WriteBytes($bytes)
    $store = $writer.StoreAsync()
    $store.AsTask().Wait() | Out-Null
    $writer.DetachStream(); $writer.Dispose()
    $stream.Seek(0) | Out-Null
    $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).AsTask().GetAwaiter().GetResult()
    $soft = $decoder.GetSoftwareBitmapAsync().AsTask().GetAwaiter().GetResult()
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { return '' }
    $result = $engine.RecognizeAsync($soft).AsTask().GetAwaiter().GetResult()
    return [string]$result.Text
  } catch { return '' }
}
$raw = [Convert]::FromBase64String((Get-Content -Raw -Path $ImagePath))
$msIn = New-Object System.IO.MemoryStream (,$raw)
$src = [System.Drawing.Image]::FromStream($msIn)
$flat = New-White $src
$src.Dispose(); $msIn.Dispose()
if ($Region) {
  $parts = $Region.Split(',')
  $flat2 = Crop-Rect $flat ([int]$parts[0]) ([int]$parts[1]) ([int]$parts[2]) ([int]$parts[3])
  $flat.Dispose(); $flat = $flat2
}
$full = Resize-Edge $flat 2048
if (-not [object]::ReferenceEquals($full, $flat)) { $flat.Dispose() }
$images = @()
$tall = ($full.Height -ge 1700 -and $full.Height -ge ($full.Width * 1.7))
if ($tall) {
  $strip = 1200; $overlap = 160; $y = 0; $n = 0
  while ($y -lt $full.Height -and $n -lt 4) {
    $h = [Math]::Min($strip, $full.Height - $y)
    $piece = Crop-Rect $full 0 $y $full.Width $h
    $n++
    $images += @{ data = (To-B64 $piece); note = ("长图第{0}段，原图 y={1} 高={2}" -f $n, $y, $h) }
    $piece.Dispose()
    if (($y + $h) -ge $full.Height) { break }
    $y += ($strip - $overlap)
  }
} else {
  $images += @{ data = (To-B64 $full); note = '' }
}
if (-not $Region) {
  $red = Find-Red $full
  if ($null -ne $red) {
    $area = $red.w * $red.h
    $ratio = $area / [double]($full.Width * $full.Height)
    if ($ratio -ge 0.004 -and $ratio -le 0.72) {
      $padX = [Math]::Max(24, [int]($red.w * 0.18))
      $padY = [Math]::Max(24, [int]($red.h * 0.18))
      $x = [Math]::Max(0, $red.x - $padX)
      $y = [Math]::Max(0, $red.y - $padY)
      $right = [Math]::Min($full.Width, $red.x + $red.w + $padX)
      $bottom = [Math]::Min($full.Height, $red.y + $red.h + $padY)
      $crop = Crop-Rect $full $x $y ($right - $x) ($bottom - $y)
      $images += @{ data = (To-B64 $crop); note = ("红标特写，原图坐标 x={0} y={1} w={2} h={3}" -f $x, $y, ($right - $x), ($bottom - $y)) }
      $ocrBmp = $crop
    }
  }
}
if (-not $ocrBmp) { $ocrBmp = $full }
$ocr = Get-Ocr $ocrBmp
if ($ocrBmp -ne $full) { $ocrBmp.Dispose() }
$full.Dispose()
$payload = @{ images = $images; ocr = $ocr }
Write-Output ($payload | ConvertTo-Json -Compress -Depth 6)
`;
