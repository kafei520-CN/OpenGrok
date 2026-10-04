import { createReadStream } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { emptyHeatmap, parseTurnUsage, ymd, type HeatmapDay } from './heatmapStats';

export interface HeatmapBundle {
  days: HeatmapDay[];
  longestSecs: number;
}

interface DayAgg {
  requests: number;
  tokens: number;
  duration: number;
}

/** Per-turn totals from `updates.jsonl`, dated by the turn itself. Same rule CC Switch uses for Grok. */
export async function loadLocalHeatmap(days = 371): Promise<HeatmapBundle> {
  const padded = emptyHeatmap(days);
  const root = path.join(os.homedir(), '.grok', 'sessions');
  const aggs = new Map<string, DayAgg>();
  const seen = new Set<string>();
  let longest = 0;
  await walk(root, 0, seen, aggs, (secs) => {
    if (secs > longest) {
      longest = secs;
    }
  });
  for (const row of padded) {
    const hit = aggs.get(row.date);
    if (hit) {
      row.requests = hit.requests;
      row.tokens = hit.tokens;
    }
  }
  return { days: padded, longestSecs: longest };
}

async function walk(
  dir: string,
  depth: number,
  seen: Set<string>,
  aggs: Map<string, DayAgg>,
  onDuration: (secs: number) => void,
): Promise<void> {
  if (depth > 6) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, seen, aggs, onDuration);
      continue;
    }
    if (entry.name === 'updates.jsonl') {
      await ingest(full, seen, aggs, onDuration);
    }
  }
}

async function ingest(
  file: string,
  seen: Set<string>,
  aggs: Map<string, DayAgg>,
  onDuration: (secs: number) => void,
): Promise<void> {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const turn = parseTurnUsage(line);
      if (!turn || seen.has(turn.id)) {
        continue;
      }
      seen.add(turn.id);
      if (turn.secs > 0) {
        onDuration(turn.secs);
      }
      const day = ymd(new Date(turn.at));
      const row = aggs.get(day) ?? { requests: 0, tokens: 0, duration: 0 };
      row.requests += 1;
      row.tokens += turn.tokens;
      row.duration = Math.max(row.duration, turn.secs);
      aggs.set(day, row);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
