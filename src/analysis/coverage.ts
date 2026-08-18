import type { MatchupRow } from './matchups.ts';
import { type Confidence, confidenceOf, type MetaPrior, prepMatchup } from './prep.ts';

/**
 * The aggregate view of what `prepMatchup` already says one matchup at a time: every combo
 * this account has actually faced, worst-covered first. Turns "no puedo decirte nada de Diana
 * vs Sylas" into a list he can read before a session, instead of something he has to think to
 * ask about one matchup at a time.
 *
 * Scoped to matchups PLAYED on this account (`own.games > 0`). A matchup never faced at all is
 * a different question — what to expect from a first game — not a coverage gap, which is about
 * how much of his OWN experience backs the number he'd be shown.
 */

/** Worst to best, matching the order `confidenceOf` reasons in. */
export const CONFIDENCE_ORDER: readonly Confidence[] = [
  'sin_datos',
  'solo_meta',
  'mayormente_meta',
  'mixto',
  'mayormente_propio',
];

export type CoverageGap = {
  champion: string;
  opponent: string;
  account: string;
  ownGames: number;
  ownWins: number;
  /** Further games on THIS account before his own record carries half the estimate. */
  gamesToHalf: number;
  confidence: Confidence;
};

/**
 * Every matchup played on `account` whose confidence is strictly worse than `atLeast`
 * (default `mayormente_propio`, so anything short of "his own record dominates" is a gap).
 * Sorted least-covered first, so the top of the list is what to prioritise playing.
 *
 * Only meaningful where `priorOf` returns something: without a prior, `confidenceOf` treats
 * any nonzero n as the whole story — there is nothing to shrink toward — so a matchup with no
 * op.gg row never shows up here no matter how few games back it.
 */
export function coverageGaps(
  rows: MatchupRow[],
  account: string,
  priorOf: (champion: string, opponent: string) => MetaPrior | null,
  atLeast: Confidence = 'mayormente_propio',
): CoverageGap[] {
  const floor = CONFIDENCE_ORDER.indexOf(atLeast);

  const combos = new Map<string, { champion: string; opponent: string }>();
  for (const r of rows) {
    if (r.account !== account || r.games === 0) continue;
    combos.set(`${r.champion} ${r.opponent}`, { champion: r.champion, opponent: r.opponent });
  }

  const gaps: CoverageGap[] = [];
  for (const { champion, opponent } of combos.values()) {
    const prep = prepMatchup(rows, {
      champion,
      opponent,
      account,
      prior: priorOf(champion, opponent),
    });
    const confidence = confidenceOf(prep);
    if (CONFIDENCE_ORDER.indexOf(confidence) >= floor) continue;
    gaps.push({
      champion,
      opponent,
      account,
      ownGames: prep.own.games,
      ownWins: prep.own.wins,
      gamesToHalf: prep.gamesToHalf,
      confidence,
    });
  }

  return gaps.sort(
    (a, b) =>
      a.ownGames - b.ownGames ||
      a.champion.localeCompare(b.champion) ||
      a.opponent.localeCompare(b.opponent),
  );
}
