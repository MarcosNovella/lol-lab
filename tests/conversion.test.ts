import { describe, expect, it } from 'vitest';
import {
  conversionAtBand,
  conversionByBand,
  conversionSurvivesBandSweep,
  type StateRow,
} from '../src/analysis/conversion.ts';

function row(goldDiff: number, win: boolean): StateRow {
  return {
    matchId: `LA2_${goldDiff}_${win}`,
    gameCreation: 0,
    win,
    champion: 'Diana',
    opponentChampion: 'Ahri',
    goldDiff,
    xpDiff: 0,
    csDiff: 0,
    teamGoldDiff: 0,
    restOfTeamGoldDiff: 0,
  };
}

describe('conversion by game state', () => {
  it('splits games into the three buckets by the gold band', () => {
    const rows = [row(2000, true), row(0, false), row(-2000, false)];
    const c = conversionAtBand(rows, 500);
    expect(c.buckets.map((b) => [b.bucket, b.games])).toEqual([
      ['atrás', 1],
      ['pareja', 1],
      ['arriba', 1],
    ]);
  });

  it("derives the opponents' conversion from the games where THEY held the lead", () => {
    // He is behind in 4 and wins 1 of them, so his opponents converted a lead 3 times in 4.
    const rows = [row(-1000, true), row(-1000, false), row(-1200, false), row(-900, false)];
    const c = conversionAtBand(rows, 500);
    expect(c.opponentFromAhead).toEqual({ bucket: 'arriba', games: 4, wins: 3, rate: 0.75 });
  });

  it('reports an empty bucket as NaN, never as a 0% win rate', () => {
    // A 0 here would read as "he always loses from ahead" when he was simply never ahead.
    const c = conversionAtBand([row(-1000, false)], 500);
    const ahead = c.buckets.find((b) => b.bucket === 'arriba');
    expect(ahead?.games).toBe(0);
    expect(Number.isNaN(ahead?.rate ?? 0)).toBe(true);
  });

  it('sweeps the bands so no finding can rest on one arbitrary cut', () => {
    const rows = [row(600, true), row(1200, true), row(-600, false)];
    const sweep = conversionByBand(rows, [300, 500, 1000]);
    expect(sweep.map((s) => s.band)).toEqual([300, 500, 1000]);
    // At band 1000 the ±600 games fall into "pareja", so the split genuinely moves.
    expect(sweep[2]?.buckets.find((b) => b.bucket === 'pareja')?.games).toBe(2);
  });

  it('blesses a band sweep only when every band agrees on a direction', () => {
    // He converts 1 of 2 from ahead; his opponents 2 of 2 from theirs. A real gap, same sign
    // at both bands.
    const agree = conversionByBand(
      [row(2000, true), row(2500, false), row(-2000, false), row(-2500, false)],
      [300, 500],
    );
    expect(conversionSurvivesBandSweep(agree)).toBe(true);

    // Band 1000 empties the "arriba" bucket, so the sweep can no longer speak with one voice.
    const mixed = conversionByBand([row(600, true), row(-600, false)], [300, 1000]);
    expect(conversionSurvivesBandSweep(mixed)).toBe(false);
  });

  it('refuses to bless a gap of exactly zero, however unanimous the bands are (G-012)', () => {
    // Both rates are 1.0 at every band: the sweep "agrees" on a difference of nothing. The old
    // implementation returned true here — Math.sign(0) is 0 and one distinct sign passed the
    // agreement test — so a finding of no difference was reported as a robust finding.
    const noGap = conversionByBand(
      [row(2000, true), row(2500, true), row(-2000, false), row(-2500, false)],
      [300, 500],
    );
    for (const band of noGap) {
      const mine = band.buckets.find((b) => b.bucket === 'arriba');
      expect(mine?.rate).toBe(1);
      expect(band.opponentFromAhead.rate).toBe(1);
    }
    expect(conversionSurvivesBandSweep(noGap)).toBe(false);
  });

  it('is false for an empty sweep rather than vacuously true', () => {
    expect(conversionSurvivesBandSweep([])).toBe(false);
  });
});
