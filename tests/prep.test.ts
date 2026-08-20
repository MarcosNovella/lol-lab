import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  breakdown,
  CrossAccountError,
  MATCHUP_PERSPECTIVE,
  type MatchupRow,
  pool,
  repsAcrossAccounts,
} from '../src/analysis/matchups.ts';
import {
  confidenceOf,
  type MetaPrior,
  prepMatchup,
  SHRINKAGE_DEFAULT,
} from '../src/analysis/prep.ts';
import { describePriorsProblem, readPriors } from '../src/analysis/priors.ts';

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

describe('the cross-account rule is machine-checked', () => {
  const spanning = [
    row({ account: 'smurf', games: 9, wins: 6 }),
    row({ account: 'main', games: 3, wins: 0 }),
  ];

  it('classifies every numeric field of a matchup row', () => {
    expect(MATCHUP_PERSPECTIVE.games).toBe('conocimiento');
    expect(MATCHUP_PERSPECTIVE.wins).toBe('rendimiento');
  });

  it('REFUSES to pool wins across accounts', () => {
    expect(() => pool(spanning, 'wins')).toThrow(CrossAccountError);
  });

  it('allows pooling reps, because experience is knowledge', () => {
    expect(pool(spanning, 'games')).toBe(12);
    expect(repsAcrossAccounts(spanning, 'Locke', 'Akali')).toBe(12);
  });

  it('still sums a performance field inside ONE account', () => {
    const oneAccount = [
      row({ account: 'smurf', games: 9, wins: 6 }),
      row({ account: 'smurf', games: 3, wins: 1, queue: 'flex' }),
    ];
    expect(pool(oneAccount, 'wins')).toBe(7);
  });

  it('answers a performance question with the per-account breakdown', () => {
    expect(breakdown(spanning)).toEqual([
      { account: 'main', games: 3, wins: 0 },
      { account: 'smurf', games: 9, wins: 6 },
    ]);
  });
});

describe('shrinkage toward the meta prior', () => {
  it('leaves a 0-for-1 record essentially at the prior', () => {
    // The whole point: "0/1 against Akali" must not read as an unwinnable matchup.
    const prep = prepMatchup([row({ account: 'smurf', games: 1, wins: 0 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: PRIOR,
    });
    const atDefault = prep.estimates.find((e) => e.weight === SHRINKAGE_DEFAULT);
    expect(atDefault?.winRate).toBeCloseTo((1 * 0 + 10 * 0.435) / 11, 4);
    expect(prep.ownWeight).toBeCloseTo(1 / 11, 4);
    expect(confidenceOf(prep)).toBe('mayormente_meta');
  });

  it('does not call one game "your record rules" when there is no prior to blend with', () => {
    // Without a prior `ownWeight` is 1 at ANY n — the estimate is entirely his record because
    // there is nothing else in it — so reading the rung off the share alone reported
    // `mayormente_propio` for a single game. That is the n=1 number wearing a confident label
    // this ladder exists to prevent. It only surfaced once the coverage tracker ran on a machine
    // where the vault, and therefore every prior, was absent.
    const thin = prepMatchup([row({ account: 'smurf', games: 1, wins: 0 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: null,
    });
    expect(thin.ownWeight).toBe(1);
    expect(confidenceOf(thin)).toBe('poco_propio');

    // And it is NOT `mayormente_meta` either: that rung claims thousands of op.gg games are
    // carrying the estimate, and here there are none.
    const solid = prepMatchup([row({ account: 'smurf', games: SHRINKAGE_DEFAULT, wins: 5 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: null,
    });
    expect(confidenceOf(solid)).toBe('mayormente_propio');
  });

  it('lets his own record take over once he has played it enough', () => {
    const prep = prepMatchup([row({ account: 'smurf', games: 30, wins: 24 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: PRIOR,
    });
    expect(prep.ownWeight).toBeCloseTo(30 / 40, 4);
    expect(confidenceOf(prep)).toBe('mayormente_propio');
    expect(prep.gamesToHalf).toBe(0);
  });

  it('sweeps the shrinkage weight, because the weight is a judgement call (G-011)', () => {
    const prep = prepMatchup([row({ account: 'smurf', games: 10, wins: 10 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: PRIOR,
    });
    expect(prep.estimates.map((e) => e.weight)).toEqual([5, 10, 20]);
    // A heavier prior must pull the estimate down; if it did not, the sweep would be inert.
    const [light, mid, heavy] = prep.estimates;
    expect(light?.winRate).toBeGreaterThan(mid?.winRate ?? 0);
    expect(mid?.winRate).toBeGreaterThan(heavy?.winRate ?? 0);
  });

  it('scopes the record to the account he is about to play, never the merged one', () => {
    const rows = [
      row({ account: 'smurf', games: 9, wins: 9 }),
      row({ account: 'main', games: 2, wins: 0 }),
    ];
    const prep = prepMatchup(rows, {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'main',
      prior: PRIOR,
    });
    // His own record here is the main's 0/2 — the smurf's 9/9 must not leak into the estimate.
    expect(prep.own).toEqual({ account: 'main', games: 2, wins: 0 });
    expect(prep.otherAccounts).toEqual([{ account: 'smurf', games: 9, wins: 9 }]);
    // Reps still pool: he has seen the matchup 11 times.
    expect(prep.repsTotal).toBe(11);
    const atDefault = prep.estimates.find((e) => e.weight === SHRINKAGE_DEFAULT);
    expect(atDefault?.winRate).toBeCloseTo((2 * 0 + 10 * 0.435) / 12, 4);
  });

  it('says how many games are still needed before his own record carries half', () => {
    const prep = prepMatchup([row({ account: 'smurf', games: 3, wins: 1 })], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'smurf',
      prior: PRIOR,
    });
    expect(prep.gamesToHalf).toBe(7);
  });

  it('reports no data rather than a number when there is neither record nor prior', () => {
    const prep = prepMatchup([], {
      champion: 'Locke',
      opponent: 'Zed',
      account: 'main',
      prior: null,
    });
    expect(confidenceOf(prep)).toBe('sin_datos');
    expect(prep.estimates.every((e) => Number.isNaN(e.winRate))).toBe(true);
    expect(prep.lastSeen).toBeNull();
  });

  it('falls back to the prior alone when he has never played the matchup', () => {
    const prep = prepMatchup([], {
      champion: 'Locke',
      opponent: 'Akali',
      account: 'main',
      prior: PRIOR,
    });
    expect(confidenceOf(prep)).toBe('solo_meta');
    expect(prep.estimates.every((e) => e.winRate === PRIOR.winRate)).toBe(true);
    expect(prep.ownWeight).toBe(0);
  });
});

/**
 * The op.gg CSV reader.
 *
 * Every case here was found by feeding the parser a file, not by reading it: all three failure
 * modes returned `[]` and were indistinguishable from "this machine has no vault", which the
 * module documents as normal. The cost is not a missing feature — `confidenceOf` goes on to
 * report `mayormente_propio`, a WRONG confidence label on an estimate that silently lost its
 * prior.
 */
describe('leer los priors de op.gg', () => {
  const HEAD = 'champion,lane_opponent,wr_pct,muestra_partidas';
  const ROWS = 'Diana,Yone,52.4,18342\nAhri,Zed,48.1,9001';

  function write(name: string, body: string): string {
    const path = join(tmpdir(), `priors-${name}-${process.pid}-${Math.random()}.csv`);
    writeFileSync(path, body);
    return path;
  }

  it('reads a plain LF file', () => {
    const read = readPriors(write('lf', `${HEAD}\n${ROWS}\n`));
    expect(read.problem.kind).toBe('ok');
    expect(read.priors).toHaveLength(2);
    expect(read.priors[0]?.winRate).toBeCloseTo(0.524);
    expect(read.priors[0]?.sampleGames).toBe(18342);
  });

  it('reads a CRLF file, which used to come back empty and silent (G-010)', () => {
    // `split('\n')` left a `\r` on the last header name, so `indexOf('muestra_partidas')` was
    // -1 and every row was skipped. The file is written by a Python script on Windows.
    const read = readPriors(write('crlf', `${HEAD}\r\n${ROWS.replace(/\n/g, '\r\n')}\r\n`));
    expect(read.problem.kind).toBe('ok');
    expect(read.priors).toHaveLength(2);
    expect(read.priors[0]?.champion).toBe('Diana');
    expect(read.priors[1]?.opponent).toBe('Zed');
  });

  it('names the missing column instead of returning nothing', () => {
    const read = readPriors(
      write('cols', 'champion,lane_opponent,winrate,games\nDiana,Yone,52.4,1'),
    );
    expect(read.problem.kind).toBe('columnas');
    expect(read.priors).toHaveLength(0);
    const described = describePriorsProblem(read.problem) ?? '';
    expect(described).toContain('wr_pct');
    expect(described).toContain('muestra_partidas');
    // It also has to say what it DID find, or the fix is a guessing game.
    expect(described).toContain('winrate');
  });

  it('tells an absent file apart from an unreadable one', () => {
    const absent = readPriors(join(tmpdir(), 'no-existe-jamas-de-los-jamases.csv'));
    expect(absent.problem.kind).toBe('ausente');
    // Absent is NORMAL — a cloud session has no vault — so it reads as an aside, not an alarm.
    expect(describePriorsProblem(absent.problem)).toContain('todo se apoya en tu propio registro');
    expect(describePriorsProblem({ kind: 'ok' })).toBeNull();
  });

  it('ignores blank lines and trims stray spaces rather than dropping the row', () => {
    const read = readPriors(write('blank', `${HEAD}\n${ROWS}\n\n`));
    expect(read.problem.kind).toBe('ok');
    expect(read.priors).toHaveLength(2);
  });
});
