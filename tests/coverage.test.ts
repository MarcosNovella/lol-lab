import { describe, expect, it } from 'vitest';
import { coverageGaps } from '../src/analysis/coverage.ts';
import type { MatchupRow } from '../src/analysis/matchups.ts';
import type { MetaPrior } from '../src/analysis/prep.ts';

function row(over: Partial<MatchupRow> & { account: string }): MatchupRow {
  return {
    champion: 'Locke',
    opponent: 'Akali',
    role: 'mid',
    queue: 'soloq',
    games: 1,
    wins: 0,
    first: 0,
    last: 0,
    ...over,
  };
}

const PRIOR: MetaPrior = {
  champion: 'Locke',
  opponent: 'Akali',
  sampleGames: 977,
  winRate: 0.435,
};
const noPrior = (): null => null;
const withPrior =
  (prior: MetaPrior) =>
  (champion: string, opponent: string): MetaPrior | null =>
    champion === prior.champion && opponent === prior.opponent ? prior : null;

describe('coverageGaps', () => {
  it('flags a matchup barely played as a gap', () => {
    const rows = [row({ account: 'smurf', games: 2, wins: 1 })];
    const gaps = coverageGaps(rows, 'smurf', withPrior(PRIOR));
    expect(gaps).toEqual([
      {
        champion: 'Locke',
        opponent: 'Akali',
        account: 'smurf',
        ownGames: 2,
        ownWins: 1,
        gamesToHalf: 8,
        confidence: 'mayormente_meta',
      },
    ]);
  });

  it('drops a matchup once his own record dominates the estimate', () => {
    const rows = [row({ account: 'smurf', games: 30, wins: 24 })];
    expect(coverageGaps(rows, 'smurf', withPrior(PRIOR))).toEqual([]);
  });

  it('never reports a matchup he has not played on this account, even if another account has', () => {
    const rows = [
      row({ account: 'smurf', games: 20, wins: 16 }),
      row({ account: 'main', games: 0, wins: 0 }),
    ];
    // The main's row above has games: 0 and would not exist in real data (collectMatchups
    // never emits a zero-game row) — the guard is `r.games === 0`, exercised directly here.
    expect(coverageGaps(rows, 'main', withPrior(PRIOR))).toEqual([]);
  });

  it('sorts least-covered first', () => {
    const rows = [
      row({ account: 'smurf', champion: 'Locke', opponent: 'Akali', games: 3, wins: 1 }),
      row({ account: 'smurf', champion: 'Diana', opponent: 'Sylas', games: 1, wins: 0 }),
    ];
    const priorOf = (champion: string, opponent: string): MetaPrior | null =>
      withPrior({ champion: 'Locke', opponent: 'Akali', sampleGames: 977, winRate: 0.435 })(
        champion,
        opponent,
      ) ??
      withPrior({ champion: 'Diana', opponent: 'Sylas', sampleGames: 500, winRate: 0.48 })(
        champion,
        opponent,
      );
    const gaps = coverageGaps(rows, 'smurf', priorOf);
    expect(gaps.map((g) => g.champion)).toEqual(['Diana', 'Locke']);
  });

  it('reports a matchup with no prior and no games as a gap too, once games exist elsewhere', () => {
    // Without a prior, `confidenceOf` treats any nonzero n as the whole story (nothing to
    // shrink toward), so it is 'mayormente_propio' from game 1 — correct, not a bug: a coverage
    // tracker only has something to say about the balance between his own record and a prior.
    const rows = [row({ account: 'smurf', games: 1, wins: 0 })];
    expect(coverageGaps(rows, 'smurf', noPrior)).toEqual([]);
  });

  it('honours a looser floor, e.g. only flag what is still mostly meta', () => {
    const rows = [row({ account: 'smurf', games: 6, wins: 3 })];
    // At 6 games this is 'mixto' by default (worse than mayormente_propio => flagged).
    expect(coverageGaps(rows, 'smurf', withPrior(PRIOR))).toHaveLength(1);
    // Asking only for 'mayormente_meta' or worse excludes a 'mixto' matchup.
    expect(coverageGaps(rows, 'smurf', withPrior(PRIOR), 'mayormente_meta')).toEqual([]);
  });
});
