import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { drift, GrowthError, growthCurve, trendSlope } from '../src/analysis/growth.ts';
import { FLAT, growthVerdict } from '../src/cli/growth.ts';
import type { MatchDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch } from '../src/store/matches.ts';
import { match, participant } from './fixtures.ts';

type Game = { id: string; at: number; myCs: number; theirCs: number; win?: boolean };

function game(g: Game): MatchDto {
  return match({
    matchId: g.id,
    queueId: 420,
    gameCreation: g.at,
    participants: [
      participant({
        puuid: 'me',
        championName: 'Locke',
        teamId: 100,
        teamPosition: 'MIDDLE',
        win: g.win ?? true,
        challenges: { laneMinionsFirst10Minutes: g.myCs },
      }),
      participant({
        puuid: `${g.id}-enemy`,
        championName: 'Akali',
        teamId: 200,
        teamPosition: 'MIDDLE',
        win: !(g.win ?? true),
        challenges: { laneMinionsFirst10Minutes: g.theirCs },
      }),
    ],
  });
}

function seed(db: Db, games: Game[]): void {
  for (const g of games) {
    const raw = game(g);
    saveMatch(db, flattenMatch(raw), raw);
  }
}

const curve = (db: Db, window = 3) =>
  growthCurve(db, {
    puuid: 'me',
    accountLabel: 'smurf',
    metricKey: 'cs_first_10',
    role: 'MIDDLE',
    queueId: 420,
    window,
  });

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('the growth curve', () => {
  it('orders games oldest-first and indexes by game, not by date', () => {
    seed(db, [
      { id: 'LA2_3', at: 300, myCs: 70, theirCs: 60 },
      { id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 },
      { id: 'LA2_2', at: 200, myCs: 60, theirCs: 60 },
    ]);
    const c = curve(db);
    expect(c.points.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(c.points.map((p) => p.mine)).toEqual([50, 60, 70]);
  });

  it('carries the opponent value as the underlay, so the confound is visible', () => {
    // He improves 50 -> 70, but his opponents improve identically: the lobbies got harder and
    // the curve must show both lines, not just his.
    seed(db, [
      { id: 'LA2_1', at: 100, myCs: 50, theirCs: 50 },
      { id: 'LA2_2', at: 200, myCs: 60, theirCs: 60 },
      { id: 'LA2_3', at: 300, myCs: 70, theirCs: 70 },
    ]);
    const c = curve(db);
    expect(c.points.map((p) => p.theirs)).toEqual([50, 60, 70]);
    expect(drift(c.points, (p) => p.mineRolling)).toBeCloseTo(
      drift(c.points, (p) => p.theirsRolling),
    );
  });

  it('rolls the mean over the trailing window, not the whole history', () => {
    seed(db, [
      { id: 'LA2_1', at: 100, myCs: 30, theirCs: 60 },
      { id: 'LA2_2', at: 200, myCs: 60, theirCs: 60 },
      { id: 'LA2_3', at: 300, myCs: 60, theirCs: 60 },
      { id: 'LA2_4', at: 400, myCs: 60, theirCs: 60 },
    ]);
    const c = curve(db, 3);
    // The 30 leaves the window at game 4, so the last point is a clean 60.
    expect(c.points.map((p) => p.mineRolling)).toEqual([30, 45, 50, 60]);
  });

  it('cannot span accounts, because it takes one puuid and queries for it', () => {
    seed(db, [{ id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 }]);
    const other = growthCurve(db, {
      puuid: 'LA2_1-enemy',
      accountLabel: 'main',
      metricKey: 'cs_first_10',
      role: 'MIDDLE',
      queueId: 420,
    });
    expect(other.points.map((p) => p.mine)).toEqual([60]);
    expect(other.account).toBe('main');
  });

  it('REFUSES a contaminated metric (G-008)', () => {
    seed(db, [{ id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 }]);
    expect(() =>
      growthCurve(db, {
        puuid: 'me',
        accountLabel: 'smurf',
        metricKey: 'kda',
        role: 'MIDDLE',
        queueId: 420,
      }),
    ).toThrow(GrowthError);
  });

  it('refuses a metric that does not exist rather than returning an empty curve', () => {
    expect(() =>
      growthCurve(db, { puuid: 'me', accountLabel: 'smurf', metricKey: 'invented' }),
    ).toThrow(GrowthError);
  });

  it('counts games it had to drop instead of shortening the curve silently', () => {
    const solo = match({
      matchId: 'LA2_SOLO',
      queueId: 420,
      gameCreation: 500,
      participants: [
        participant({
          puuid: 'me',
          teamId: 100,
          teamPosition: 'MIDDLE',
          challenges: { laneMinionsFirst10Minutes: 50 },
        }),
        participant({ puuid: 'x', teamId: 200, teamPosition: 'TOP' }),
      ],
    });
    saveMatch(db, flattenMatch(solo), solo);
    seed(db, [{ id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 }]);
    const c = curve(db);
    expect(c.points).toHaveLength(1);
    expect(c.skipped).toBe(1);
  });

  it('reports drift as NaN below two points rather than inventing a slope', () => {
    seed(db, [{ id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 }]);
    expect(Number.isNaN(drift(curve(db).points, (p) => p.mineRolling))).toBe(true);
  });

  it('fits the known slope of a straight line, in metric units per game', () => {
    // 50, 53, 56, 59: exactly +3 CS@10 per game, with the rolling window at 1 so the series is
    // the raw values and the expected answer is arithmetic rather than a fixture.
    seed(db, [
      { id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 },
      { id: 'LA2_2', at: 200, myCs: 53, theirCs: 60 },
      { id: 'LA2_3', at: 300, myCs: 56, theirCs: 60 },
      { id: 'LA2_4', at: 400, myCs: 59, theirCs: 60 },
    ]);
    const points = curve(db, 1).points;
    expect(trendSlope(points, (p) => p.mineRolling)).toBeCloseTo(3, 10);
    // A flat opponent line has slope zero, not "no measurement".
    expect(trendSlope(points, (p) => p.theirsRolling)).toBeCloseTo(0, 10);
  });

  it('reports the fitted slope as NaN below two points, like drift', () => {
    seed(db, [{ id: 'LA2_1', at: 100, myCs: 50, theirCs: 60 }]);
    expect(Number.isNaN(trendSlope(curve(db).points, (p) => p.mineRolling))).toBe(true);
  });
});

/**
 * The verdict `lol growth` prints under the two curves.
 *
 * Born from a real print: with a fixture whose CS@10 never moved, the report said "tu línea se
 * movió MÁS que la de los rivales (neto +0.000 por partida)". Every comparison in the chain was
 * false and the claim lived in the fallback (G-012).
 */
describe('el veredicto de growth', () => {
  it('refuses to read anything into two curves that did not move (G-012)', () => {
    const lines = growthVerdict(0, 0).join(' ');
    expect(lines).toContain('Ninguna de las dos curvas se movió');
    expect(lines).not.toContain('más que la de los rivales');
  });

  it('treats a drift below the floor as flat, not as a tiny finding', () => {
    // Reading the third decimal of a rolling mean and printing it as a trend is the same
    // mistake as reading zero as a sign, one order of magnitude up.
    const lines = growthVerdict(FLAT / 10, -FLAT / 10).join(' ');
    expect(lines).toContain('Ninguna de las dos curvas se movió');
  });

  it('says nothing rather than guessing when a drift is not measurable', () => {
    expect(growthVerdict(Number.NaN, 0).join(' ')).toContain('No se pudo medir');
    expect(growthVerdict(0.5, Number.NaN).join(' ')).toContain('No se pudo medir');
  });

  it('still calls a real divergence a divergence', () => {
    const lines = growthVerdict(0.4, 0.05).join(' ');
    expect(lines).toContain('Tu línea se movió más');
    expect(lines).toContain('+0.350');
  });

  it('still warns when the lobby moved more than he did', () => {
    expect(growthVerdict(0.1, -0.6).join(' ')).toContain('LEER CON CUIDADO');
  });

  it('still calls two curves that moved together what they are', () => {
    expect(growthVerdict(0.4, 0.35).join(' ')).toContain('se movieron juntas');
  });
});
