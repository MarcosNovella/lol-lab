import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MetaPrior } from '../src/analysis/prep.ts';

/** Shared by every CLI that needs op.gg's meta rate: `prep.ts` today, `coverage.ts` too. */

const VAULT = process.env['VAULT_PATH'] ?? 'C:/Users/Marcos/Documents/vault';
const META = join(VAULT, '_raw', 'lol', 'opgg-matchups-2026-08-14.csv');

export function loadPriors(): MetaPrior[] {
  let text: string;
  try {
    text = readFileSync(META, 'utf8');
  } catch {
    return [];
  }
  const lines = text.trim().split('\n');
  const head = lines[0]?.split(',') ?? [];
  const at = (name: string): number => head.indexOf(name);
  const priors: MetaPrior[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const pct = Number(c[at('wr_pct')]);
    const games = Number(c[at('muestra_partidas')]);
    if (!Number.isFinite(pct) || !Number.isFinite(games) || games <= 0) continue;
    priors.push({
      champion: String(c[at('champion')]),
      opponent: String(c[at('lane_opponent')]),
      sampleGames: games,
      winRate: pct / 100,
    });
  }
  return priors;
}
