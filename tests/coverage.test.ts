import { describe, expect, it } from 'vitest';
import {
  coverageFor,
  coverageOf,
  coverageTotals,
  repsByAccount,
} from '../src/analysis/coverage.ts';
import { CrossAccountError, type MatchupRow, pool } from '../src/analysis/matchups.ts';
import {
  confidenceOf,
  type MetaPrior,
  prepMatchup,
  SHRINKAGE_DEFAULT,
} from '../src/analysis/prep.ts';

/**
 * What these pin: the coverage tracker must get its thresholds from `confidenceOf` and its
 * account rule from `pool`, so that changing either changes this — rather than leaving a second
 * copy of the rungs to drift.
 */

function row(over: Partial<MatchupRow> & { champion: string; opponent: string }): MatchupRow {
  return {
    role: 'mid',
    account: 'smurf',
    queue: 'soloq',
    games: 1,
    wins: 0,
    first: 1_760_000_000_000,
    last: 1_760_000_000_000,
    ...over,
  };
}

const PRIOR: MetaPrior = {
  champion: 'Diana',
  opponent: 'Sylas',
  sampleGames: 4000,
  winRate: 0.47,
};

describe('coverage', () => {
  it('reports a matchup he has never played as silent', () => {
    const rows = [row({ champion: 'Diana', opponent: 'Akali', games: 4 })];
    const found = coverageFor(rows, {
      account: 'smurf',
      champion: 'Diana',
      opponent: 'Akali',
    });
    expect(found?.ownGames).toBe(4);

    // A matchup absent from the rows entirely is absent from the coverage: the tracker reports
    // on matchups that exist in the cache, and inventing rows for every champion in the game
    // would drown the real holes.
    expect(coverageFor(rows, { account: 'smurf', champion: 'Diana', opponent: 'Zed' })).toBeNull();
  });

  it('takes its threshold from confidenceOf rather than a copy of it', () => {
    const rows = [row({ champion: 'Diana', opponent: 'Sylas', games: 2, wins: 1 })];
    const found = coverageFor(rows, {
      account: 'smurf',
      champion: 'Diana',
      opponent: 'Sylas',
      priors: [PRIOR],
    });

    expect(found?.ownGames).toBe(2);
    expect(found?.confidence).toBe('mayormente_meta');

    // The claim: playing exactly `gamesToNext` more games really does move the rung, and one
    // fewer does not. Verified by running the real prep, not by trusting the arithmetic here.
    const at = (extra: number): string =>
      confidenceOf(
        prepMatchup([...rows, row({ champion: 'Diana', opponent: 'Sylas', games: extra })], {
          champion: 'Diana',
          opponent: 'Sylas',
          account: 'smurf',
          prior: PRIOR,
        }),
      );
    const need = found?.gamesToNext ?? 0;
    expect(need).toBeGreaterThan(0);
    expect(at(need)).toBe(found?.nextConfidence);
    expect(at(need - 1)).toBe(found?.confidence);
  });

  it('ranks a thin no-prior record below a meta-backed one', () => {
    const rows = [
      // Two of his own games and thousands of op.gg games behind them.
      row({ champion: 'Diana', opponent: 'Sylas', games: 2 }),
      // Three of his own and nothing else. Weaker, despite the larger own-record.
      row({ champion: 'Yone', opponent: 'Ahri', games: 3 }),
    ];
    const order = coverageOf(rows, { account: 'smurf', priors: [PRIOR] }).rows;
    expect(order.map((r) => r.opponent)).toEqual(['Ahri', 'Sylas']);
    expect(order[0]?.confidence).toBe('poco_propio');
    expect(order[1]?.confidence).toBe('mayormente_meta');
  });

  it('returns 0 and a null next rung once the top is reached', () => {
    const rows = [row({ champion: 'Locke', opponent: 'Akali', games: SHRINKAGE_DEFAULT + 5 })];
    const found = coverageFor(rows, {
      account: 'smurf',
      champion: 'Locke',
      opponent: 'Akali',
      priors: [],
    });
    expect(found?.confidence).toBe('mayormente_propio');
    expect(found?.gamesToNext).toBe(0);
    expect(found?.nextConfidence).toBeNull();
  });

  it('counts a matchup only played on the other account as a hole on this one', () => {
    const rows = [row({ champion: 'Locke', opponent: 'Veigar', account: 'smurf', games: 6 })];
    const onMain = coverageFor(rows, {
      account: 'main',
      champion: 'Locke',
      opponent: 'Veigar',
      priors: [],
    });

    // Reps pool — he has seen Veigar six times and that is elo-invariant knowledge.
    expect(onMain?.reps).toBe(6);
    // The record does not. On the main he has never played it, and the estimate must say so.
    expect(onMain?.ownGames).toBe(0);
    expect(onMain?.confidence).toBe('sin_datos');
  });

  it('never builds a pooled win count', () => {
    const rows = [
      row({ champion: 'Locke', opponent: 'Akali', account: 'smurf', games: 3, wins: 1 }),
      row({ champion: 'Locke', opponent: 'Akali', account: 'main', games: 2, wins: 2 }),
    ];
    // The split the tracker is allowed to show.
    expect(repsByAccount(rows, 'Locke', 'Akali')).toEqual([
      { account: 'main', games: 2, wins: 2 },
      { account: 'smurf', games: 3, wins: 1 },
    ]);
    // Reps may pool across accounts, so the totals compute without complaint.
    expect(coverageTotals(rows, coverageOf(rows, { account: 'smurf' })).reps).toBe(5);
    // And the aggregate it structurally cannot build: `pool` refuses the numerator a pooled
    // win RATE would need, which is why no `winsCovered` exists on `coverageTotals` (ADR-011).
    expect(() => pool(rows, 'wins')).toThrow(CrossAccountError);
  });

  it('orders the weakest coverage first', () => {
    const rows = [
      row({ champion: 'Diana', opponent: 'Sylas', games: 1 }),
      row({ champion: 'Locke', opponent: 'Akali', games: 12 }),
      row({ champion: 'Yone', opponent: 'Ahri', games: 5 }),
    ];
    const order = coverageOf(rows, { account: 'smurf' }).rows.map((r) => r.opponent);
    expect(order).toEqual(['Sylas', 'Ahri', 'Akali']);
  });

  it('states its scope on every result', () => {
    const rows = [row({ champion: 'Diana', opponent: 'Sylas' })];
    const scope = coverageOf(rows, { account: 'smurf', queue: 'soloq', since: 1000 }).scope;
    expect(scope).toEqual({
      account: 'smurf',
      queue: 'soloq',
      since: 1000,
      // G-015: the reader cannot compare this to an op.gg or vault number without knowing it.
      remakes: 'excluidos',
    });
  });

  it('defaults the scope to the whole cached history rather than leaving it unsaid', () => {
    const scope = coverageOf([row({ champion: 'Diana', opponent: 'Sylas' })], {
      account: 'smurf',
    }).scope;
    expect(scope.queue).toBe('todas');
    expect(scope.since).toBeNull();
  });

  it('counts the matchups it cannot speak about', () => {
    const rows = [
      row({ champion: 'Diana', opponent: 'Sylas', games: 1 }),
      row({ champion: 'Locke', opponent: 'Akali', games: 12 }),
      // Played only on the main, so from the smurf's perspective this is a true hole: no
      // record of his own and no prior to fall back on.
      row({ champion: 'Yone', opponent: 'Ahri', account: 'main', games: 4 }),
    ];
    const totals = coverageTotals(rows, coverageOf(rows, { account: 'smurf', priors: [] }));

    expect(totals.matchups).toBe(3);
    // Reps pool across accounts, so the main's four Ahri games count as experience.
    expect(totals.reps).toBe(17);
    // Exactly one: 'silent' means the engine has nothing to say, which is `sin_datos` (no games,
    // no prior) or `solo_meta` (no games, prior only). One game of his own is thin, but it is
    // not silence, and conflating the two would hide the rows that actually need games.
    expect(totals.silent).toBe(1);
  });
});
