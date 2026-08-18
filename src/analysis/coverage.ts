import { breakdown, type MatchupRow, pool } from './matchups.ts';
import { type Confidence, confidenceOf, type MetaPrior, prepMatchup } from './prep.ts';

/**
 * What the engine does NOT know yet, as a quantity.
 *
 * `confidenceOf` already turns "I don't know" into a rung; this walks every matchup he has
 * actually played and reports how far each one is from the next rung. The output is the sentence
 * the tool should say instead of a confident number: *"of Diana vs Sylas I can tell you nothing —
 * 2 reps, 6 more before your own record carries half the estimate."*
 *
 * Two things it deliberately does not do:
 *
 * - It does not invent a threshold. Every rung comes from `confidenceOf`, and `gamesToNext` is
 *   found by asking that function what it would say at n+1, n+2, … rather than by hardcoding the
 *   3 and 10 that today's rungs happen to sit at. Change the rungs and this follows.
 * - It does not merge accounts. Reps pool (knowledge), the record does not (performance,
 *   ADR-011). `pool()` refuses to build the illegal aggregate, so the split is structural.
 *
 * Every count carries its SCOPE. G-015 was born from comparing a last-20-games snapshot against
 * a full-season count and reporting the difference as a data defect; a coverage number without
 * its window, queue and remake policy invites exactly that.
 */

export type CoverageScope = {
  /** The account the RECORD is scoped to. Reps still span every account in `rows`. */
  account: string;
  /** Queue label, or 'todas' when no queue filter was applied. */
  queue: string;
  /** Epoch ms floor, or null for the whole cached history. */
  since: number | null;
  /**
   * Always 'excluidos'. `collectMatchups` reads through `queryParticipants`, which drops matches
   * under 300 seconds and blank positions — verified in `store/matches.ts`, not assumed. Stated
   * as a field rather than a comment because op.gg excludes remakes too and the vault's notes do
   * not, so the reader needs to know which convention a number follows before comparing it.
   */
  remakes: 'excluidos';
};

export type CoverageRow = {
  champion: string;
  opponent: string;
  /** Reps across every account: knowledge, so this may pool. */
  reps: number;
  /** Games on the scoped account only: performance, so this may not. */
  ownGames: number;
  ownWins: number;
  confidence: Confidence;
  /**
   * Further games ON THIS ACCOUNT before `confidenceOf` would say something stronger.
   * 0 means the top rung is already reached.
   */
  gamesToNext: number;
  /** The rung those games would buy, or null at the top. */
  nextConfidence: Confidence | null;
  /** Epoch ms of the most recent game of this matchup on this account, null if never. */
  lastSeen: number | null;
};

export type Coverage = {
  scope: CoverageScope;
  rows: CoverageRow[];
};

/**
 * The rungs, weakest first. Kept beside `Confidence` rather than inside it because an ordering
 * is a claim about the rungs, not part of their definition — and a `Record` keyed on the union
 * fails `tsc` if a rung is added without being placed.
 */
const RUNG: Record<Confidence, number> = {
  sin_datos: 0,
  solo_meta: 1,
  // Below `mayormente_meta` on purpose: that rung has thousands of op.gg games carrying the
  // estimate plus a couple of his own, this one has a handful of his own and nothing else.
  poco_propio: 2,
  mayormente_meta: 3,
  mixto: 4,
  mayormente_propio: 5,
};

/**
 * How many more games on this account before the rung improves.
 *
 * Found by re-asking `confidenceOf`, not by reading the constants off it. A synthetic row with
 * `games: k` is appended and the real `prepMatchup` runs: only `own.games` moves the rung, so the
 * hypothetical wins are irrelevant and are left at 0 rather than guessed.
 */
const MAX_LOOKAHEAD = 200;

function lookahead(
  rows: MatchupRow[],
  options: { champion: string; opponent: string; account: string; prior: MetaPrior | null },
  current: Confidence,
): { gamesToNext: number; nextConfidence: Confidence | null } {
  const template = rows.find(
    (r) =>
      r.champion === options.champion &&
      r.opponent === options.opponent &&
      r.account === options.account,
  );
  for (let k = 1; k <= MAX_LOOKAHEAD; k += 1) {
    const synthetic: MatchupRow = {
      champion: options.champion,
      opponent: options.opponent,
      role: template?.role ?? 'mid',
      account: options.account,
      queue: template?.queue ?? 'soloq',
      games: k,
      wins: 0,
      first: template?.first ?? 0,
      last: template?.last ?? 0,
    };
    const next = confidenceOf(prepMatchup([...rows, synthetic], options));
    if (RUNG[next] > RUNG[current]) return { gamesToNext: k, nextConfidence: next };
  }
  return { gamesToNext: 0, nextConfidence: null };
}

export type CoverageOptions = {
  /** The account whose RECORD is being scoped — its label, as it appears on `MatchupRow`. */
  account: string;
  queue?: string;
  since?: number;
  priors?: MetaPrior[];
  /** Restrict to the champions he actually plays. Omit for every matchup in the rows. */
  champions?: string[];
};

/** Matches a prior to a matchup. Champion spellings are already normalised by `collectMatchups`,
 *  which reads them from Riot; the priors come from op.gg and are matched by the caller through
 *  `sameChampion` (G-016) before being handed here. */
function priorFor(priors: MetaPrior[], champion: string, opponent: string): MetaPrior | null {
  return priors.find((p) => p.champion === champion && p.opponent === opponent) ?? null;
}

export function coverageOf(rows: MatchupRow[], options: CoverageOptions): Coverage {
  const priors = options.priors ?? [];
  const scoped = options.champions
    ? rows.filter((r) => options.champions?.includes(r.champion))
    : rows;

  // One entry per matchup, regardless of which account played it: a matchup he has only ever
  // seen on the other account is a real coverage HOLE on this one, and dropping it would hide
  // exactly the rows worth showing.
  const pairs = new Map<string, { champion: string; opponent: string }>();
  // Composite key, with the one separator that cannot occur inside a champion name — written as
  // an ESCAPE, never as a raw byte, or git classifies the file as binary (G-018, and the exact
  // defect `ce2d34c` fixed in matchups.ts).
  for (const r of scoped) pairs.set([r.champion, r.opponent].join('\u0000'), r);

  const out: CoverageRow[] = [];
  for (const { champion, opponent } of pairs.values()) {
    const prior = priorFor(priors, champion, opponent);
    const prep = prepMatchup(scoped, { champion, opponent, account: options.account, prior });
    const confidence = confidenceOf(prep);
    const { gamesToNext, nextConfidence } = lookahead(
      scoped,
      { champion, opponent, account: options.account, prior },
      confidence,
    );
    out.push({
      champion,
      opponent,
      reps: prep.repsTotal,
      ownGames: prep.own.games,
      ownWins: prep.own.wins,
      confidence,
      gamesToNext,
      nextConfidence,
      lastSeen: prep.lastSeen,
    });
  }

  out.sort(
    (a, b) =>
      RUNG[a.confidence] - RUNG[b.confidence] ||
      a.ownGames - b.ownGames ||
      b.reps - a.reps ||
      a.champion.localeCompare(b.champion) ||
      a.opponent.localeCompare(b.opponent),
  );

  return {
    scope: {
      account: options.account,
      queue: options.queue ?? 'todas',
      since: options.since ?? null,
      remakes: 'excluidos',
    },
    rows: out,
  };
}

/** One matchup, when the caller already knows which one he is about to play or just played. */
export function coverageFor(
  rows: MatchupRow[],
  options: CoverageOptions & { champion: string; opponent: string },
): CoverageRow | null {
  const found = coverageOf(rows, options).rows.find(
    (r) => r.champion === options.champion && r.opponent === options.opponent,
  );
  return found ?? null;
}

/**
 * How many of his own games are behind the record for a set of matchups, and how many matchups
 * the engine still cannot speak about.
 *
 * `pool` is called on `games` on purpose — reps are knowledge and may span accounts. There is no
 * `winsCovered` counterpart and there must not be: `pool` would refuse to build it.
 */
export function coverageTotals(
  rows: MatchupRow[],
  coverage: Coverage,
): { matchups: number; silent: number; reps: number } {
  const silent = coverage.rows.filter(
    (r) => r.confidence === 'sin_datos' || r.confidence === 'solo_meta',
  ).length;
  return {
    matchups: coverage.rows.length,
    silent,
    reps: pool(rows, 'games'),
  };
}

/** The per-account split behind a matchup's reps — the answer to "where did those games happen". */
export function repsByAccount(
  rows: MatchupRow[],
  champion: string,
  opponent: string,
): { account: string; games: number; wins: number }[] {
  return breakdown(rows.filter((r) => r.champion === champion && r.opponent === opponent));
}
