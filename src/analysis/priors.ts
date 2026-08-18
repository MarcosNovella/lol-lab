import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sameChampion } from './names.ts';
import type { MetaPrior } from './prep.ts';

/**
 * The op.gg meta priors, read from the CSV `opgg_pull.py` writes into the vault.
 *
 * Lives here rather than inside one command because two of them need it — the matchup prep and
 * the coverage tracker — and a second copy of this parser is a second place for the column
 * names to drift from the puller that produces them.
 *
 * The two sources are complementary, not redundant (README): op.gg has matchup win rates over
 * thousands of games, which the Riot API does not expose at all, and this repo has his own
 * games, which op.gg only keeps twenty of.
 *
 * Absence is normal and is NOT an error. The vault is a different repo that stays on his
 * machine, so any session without it — a cloud session, a fresh clone — gets an empty list and
 * every estimate falls back to his own record with `confidenceOf` saying so. Failing loudly
 * here would make the engine unusable wherever the vault is not mounted.
 */

const DEFAULT_VAULT = 'C:/Users/Marcos/Documents/vault';

/** The snapshot currently pulled. Dated in the filename on purpose: a prior is a fact about a
 *  patch, and an undated one silently ages into a different game. */
const META_FILE = 'opgg-matchups-2026-08-14.csv';

export function priorsPath(): string {
  return join(process.env['VAULT_PATH'] ?? DEFAULT_VAULT, '_raw', 'lol', META_FILE);
}

export function loadPriors(path: string = priorsPath()): MetaPrior[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
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

/**
 * Finds the prior for a matchup, matching champion names across spellings.
 *
 * Always through `sameChampion` (G-016): op.gg writes 'Twisted Fate', Riot writes 'TwistedFate',
 * and a naive comparison silently fails to join every multi-word champion — which once produced
 * a fabricated report that the vault disagreed with the cache.
 */
export function priorFor(
  priors: MetaPrior[],
  champion: string,
  opponent: string,
): MetaPrior | null {
  return (
    priors.find((p) => sameChampion(p.champion, champion) && sameChampion(p.opponent, opponent)) ??
    null
  );
}

/**
 * Re-keys priors to the spellings the CACHE uses, so a consumer can match them by plain equality.
 *
 * `coverageOf` walks hundreds of matchups and calling `sameChampion` inside that loop would run
 * the normaliser on every pair; doing it once here keeps the coverage path free of the name
 * problem without letting a raw comparison back in.
 */
export function priorsKeyedLike(
  priors: MetaPrior[],
  pairs: { champion: string; opponent: string }[],
): MetaPrior[] {
  const out: MetaPrior[] = [];
  for (const pair of pairs) {
    const found = priorFor(priors, pair.champion, pair.opponent);
    if (found) out.push({ ...found, champion: pair.champion, opponent: pair.opponent });
  }
  return out;
}
