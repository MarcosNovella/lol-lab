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

/** The columns the puller writes and this parser needs. Named so a rename cannot be silent. */
const COLUMNS = ['champion', 'lane_opponent', 'wr_pct', 'muestra_partidas'] as const;

/**
 * Why the priors are empty, when they are.
 *
 * `ausente` is the NORMAL case and is not a problem: the vault is a different repo that stays
 * on his machine, so a cloud session or a fresh clone simply has no file. The other two are
 * problems, and telling them apart is the entire point of this type — all three used to return
 * `[]` and be indistinguishable, so a CSV this parser could not read looked exactly like a
 * machine that never had one, and `confidenceOf` went on to report `mayormente_propio`: not a
 * missing feature but a WRONG confidence label, which is worse than a loud failure.
 */
export type PriorsProblem =
  | { kind: 'ok' }
  | { kind: 'ausente'; path: string }
  | { kind: 'ilegible'; path: string; detail: string }
  | { kind: 'columnas'; path: string; missing: string[]; found: string[] };

export type PriorsRead = { priors: MetaPrior[]; problem: PriorsProblem };

/**
 * Reads the CSV and says what went wrong when nothing comes back.
 *
 * Two failures it now survives, both found by feeding it files rather than by reading it:
 *
 * - CRLF. `split('\n')` leaves a `\r` glued to the LAST field of every line, so the last
 *   HEADER name is `muestra_partidas\r`, `indexOf` returns -1, `c[-1]` is `undefined` and
 *   every row is skipped. The file is written by a Python script on Windows, which is the
 *   exact machine G-010 was written about, so this was a matter of time.
 * - A renamed column. Same shape, same silent zero rows, and no way to tell it from an
 *   absent file.
 *
 * Only `\r` is stripped, and the fields are not otherwise unquoted: this is not a CSV parser
 * and does not pretend to be one. Champion names carry no commas, and the day they do, a real
 * parser is the fix — not a regex that half-works.
 */
export function readPriors(path: string = priorsPath()): PriorsRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code === 'ENOENT'
      ? { priors: [], problem: { kind: 'ausente', path } }
      : {
          priors: [],
          problem: {
            kind: 'ilegible',
            path,
            detail: error instanceof Error ? error.message : String(error),
          },
        };
  }

  // Strip the carriage returns before anything looks at a field. Doing it per-field would
  // leave the HEADER row broken, which is where the damage actually was.
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const head = (lines[0] ?? '').split(',').map((h) => h.trim());
  const missing = COLUMNS.filter((name) => !head.includes(name));
  if (missing.length > 0) {
    return { priors: [], problem: { kind: 'columnas', path, missing: [...missing], found: head } };
  }

  const at = (name: string): number => head.indexOf(name);
  const priors: MetaPrior[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const c = line.split(',');
    const pct = Number(c[at('wr_pct')]);
    const games = Number(c[at('muestra_partidas')]);
    if (!Number.isFinite(pct) || !Number.isFinite(games) || games <= 0) continue;
    priors.push({
      champion: String(c[at('champion')]).trim(),
      opponent: String(c[at('lane_opponent')]).trim(),
      sampleGames: games,
      winRate: pct / 100,
    });
  }
  return { priors, problem: { kind: 'ok' } };
}

/**
 * The priors alone, for the call sites that only blend and never report.
 *
 * Kept because most consumers genuinely do not care WHY the list is empty — `priorFor` returns
 * null either way and the shrinkage falls back to his own record. The ones that print a line
 * about the meta use `readPriors` and say which of the three it was.
 */
export function loadPriors(path: string = priorsPath()): MetaPrior[] {
  return readPriors(path).priors;
}

/** The problem as one line for a human, or null when there is nothing to say. */
export function describePriorsProblem(problem: PriorsProblem): string | null {
  switch (problem.kind) {
    case 'ok':
      return null;
    case 'ausente':
      return `sin priors de op.gg (${problem.path} no está) — todo se apoya en tu propio registro`;
    case 'ilegible':
      return `NO PUDE LEER los priors de op.gg (${problem.path}): ${problem.detail}. Lo que sigue se apoya SOLO en tu propio registro, y no porque no haya meta.`;
    case 'columnas':
      return (
        `LOS PRIORS DE op.gg ESTÁN PERO NO LOS PUEDO LEER (${problem.path}): falta(n) ` +
        `${problem.missing.join(', ')}; el encabezado trae ${problem.found.join(', ')}. ` +
        'Revisá opgg_pull.py. Hasta entonces todo se apoya SOLO en tu propio registro.'
      );
  }
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
