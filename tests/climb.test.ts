import { describe, expect, it } from 'vitest';
import {
  caminoA,
  intervaloWilson,
  lpAbsoluto,
  lpMedido,
  partidasPara,
} from '../src/analysis/climb.ts';
import type { StateCurve } from '../src/analysis/curve.ts';
import type { RankSnapshot } from '../src/analysis/rank.ts';
import { firmaDe, lecturaDe } from '../src/analysis/signature.ts';

/**
 * The climb calculator, and the interval that is the whole point of it.
 *
 * Every site that ships one of these answers "how many games to Diamond" with a single
 * confident number. At fifty games a win rate has an interval about fourteen points wide, and
 * that is the difference between "sixty games away" and "this win rate does not climb at all".
 */

const snap = (over: Partial<RankSnapshot> & { observedAt: number }): RankSnapshot => ({
  puuid: 'me',
  queueType: 'RANKED_SOLO_5x5',
  tier: 'PLATINUM',
  division: 'II',
  leaguePoints: 50,
  wins: 20,
  losses: 20,
  ...over,
});

describe('el LP absoluto', () => {
  it('makes "how far is Diamond" a subtraction instead of a pile of special cases', () => {
    const platinoII = lpAbsoluto({ tier: 'PLATINUM', division: 'II', leaguePoints: 40 });
    const diamanteIV = lpAbsoluto({ tier: 'DIAMOND', division: 'IV', leaguePoints: 0 });
    expect(diamanteIV).not.toBeNull();
    expect(platinoII).not.toBeNull();
    // Platinum II → Diamond IV: two divisions of Platinum, four of Emerald, minus the 40 held.
    expect((diamanteIV as number) - (platinoII as number)).toBe(560);
  });

  it('answers null for unranked rather than putting him at the bottom of Iron', () => {
    // Zero would make every distance quietly wrong and look like a measurement.
    expect(lpAbsoluto({ tier: null, division: null, leaguePoints: null })).toBeNull();
    expect(lpAbsoluto({ tier: 'NOEXISTE', division: 'IV', leaguePoints: 0 })).toBeNull();
  });

  it('treats an apex tier as division-less rather than demanding a division', () => {
    expect(lpAbsoluto({ tier: 'MASTER', division: null, leaguePoints: 120 })).not.toBeNull();
  });
});

describe('el LP por partida, medido de sus propios snapshots', () => {
  it('reads a win and a loss apart when only one counter moved', () => {
    const m = lpMedido([
      snap({ observedAt: 1, leaguePoints: 40, wins: 20, losses: 20 }),
      snap({ observedAt: 2, leaguePoints: 62, wins: 21, losses: 20 }),
      snap({ observedAt: 3, leaguePoints: 44, wins: 21, losses: 21 }),
    ]);
    expect(m.porVictoria).toBe(22);
    expect(m.porDerrota).toBe(18);
    // The number nobody else can tell him, because it depends on HIS MMR against HIS division.
    expect(m.breakEven).toBeCloseTo(18 / 40, 3);
  });

  it('drops a pair where BOTH counters moved instead of averaging a guess into the answer', () => {
    // Three wins and two losses across one LP gap is four unknowns and one equation.
    const m = lpMedido([
      snap({ observedAt: 1, leaguePoints: 40, wins: 20, losses: 20 }),
      snap({ observedAt: 2, leaguePoints: 55, wins: 23, losses: 22 }),
    ]);
    expect(Number.isNaN(m.porVictoria)).toBe(true);
    expect(m.tramos).toBe(1);
  });

  it('measures across a division boundary, where the naive LP difference goes negative', () => {
    const m = lpMedido([
      snap({ observedAt: 1, division: 'II', leaguePoints: 92, wins: 20, losses: 20 }),
      snap({ observedAt: 2, division: 'I', leaguePoints: 14, wins: 21, losses: 20 }),
    ]);
    // 92 → 14 looks like −78 and is in fact +22.
    expect(m.porVictoria).toBe(22);
  });

  it('refuses to mix apex LP with division LP, which are different quantities', () => {
    const m = lpMedido([
      snap({
        observedAt: 1,
        tier: 'DIAMOND',
        division: 'I',
        leaguePoints: 95,
        wins: 20,
        losses: 20,
      }),
      snap({
        observedAt: 2,
        tier: 'MASTER',
        division: null,
        leaguePoints: 20,
        wins: 21,
        losses: 20,
      }),
    ]);
    expect(m.tramos).toBe(0);
  });
});

describe('el intervalo de Wilson', () => {
  it('stays inside 0 and 1 where the textbook approximation does not', () => {
    // The normal approximation gives a negative lower bound here, and a bar starting at −4%
    // makes the honest half of the card look like a bug.
    const i = intervaloWilson(1, 4);
    expect(i.bajo).toBeGreaterThanOrEqual(0);
    expect(i.alto).toBeLessThanOrEqual(1);
  });

  it('is wide at a small n and narrows as the sample grows', () => {
    const chico = intervaloWilson(11, 20);
    const grande = intervaloWilson(110, 200);
    expect(chico.alto - chico.bajo).toBeGreaterThan(grande.alto - grande.bajo);
  });

  it('is about fourteen points wide at fifty games, which is the whole argument', () => {
    const i = intervaloWilson(27, 50);
    expect((i.alto - i.bajo) * 100).toBeGreaterThan(24);
  });
});

describe('las partidas que faltan', () => {
  const lp = { porVictoria: 22, porDerrota: 18, tramos: 5, breakEven: 0.45 };

  it('divides the LP gap by what a game is actually worth at that rate', () => {
    // At 60%: 0.6*22 − 0.4*18 = 6 LP a game. 300 LP is exactly 50 games, and it has to come
    // back as 50 — the same sum in binary floating point is 5.999999999999999, which turns the
    // ceiling into 51 and puts an unexplainable extra game into a number shown as a count.
    expect(partidasPara(300, 0.6, lp)).toBe(50);
  });

  it('answers NULL below break-even, because "never" is a result and not a big number', () => {
    // Returning Infinity would be arithmetic. Returning null is the truth, and it is the one
    // answer no climb calculator on the internet is willing to print.
    expect(partidasPara(300, 0.4, lp)).toBeNull();
    expect(partidasPara(300, lp.breakEven, lp)).toBeNull();
  });

  it('answers null when the LP per game could not be measured at all', () => {
    expect(partidasPara(300, 0.6, { ...lp, porVictoria: Number.NaN })).toBeNull();
  });
});

describe('el camino completo', () => {
  // A consistent run: +22 a win, −18 a loss, ending in Platinum I. The last pair crosses the
  // division boundary, where the naive LP difference reads −78 and the truth is +22.
  const historial = [
    snap({ observedAt: 1, division: 'II', leaguePoints: 70, wins: 20, losses: 20 }),
    snap({ observedAt: 2, division: 'II', leaguePoints: 92, wins: 21, losses: 20 }),
    snap({ observedAt: 3, division: 'II', leaguePoints: 74, wins: 21, losses: 21 }),
    snap({ observedAt: 4, division: 'II', leaguePoints: 96, wins: 22, losses: 21 }),
    snap({ observedAt: 5, division: 'I', leaguePoints: 18, wins: 23, losses: 21 }),
  ];

  it('gives THREE projections, and the pessimistic one is allowed to say no', () => {
    const c = caminoA(historial, 'DIAMOND', { ganadas: 24, jugadas: 45 });
    expect(c.central?.partidas).toBeGreaterThan(0);
    expect(c.optimista?.partidas).toBeGreaterThan(0);
    // 53% over 45 games has a lower bound near 39%, and his measured break-even is 45%. The
    // interval STRADDLES the point where the ladder stops moving, which is the whole reason
    // three projections exist instead of one.
    expect(c.pesimista?.partidas).toBeNull();
    // And the optimistic one is a real answer, not a rounding of the central one.
    expect(c.optimista?.partidas).toBeLessThan(c.central?.partidas ?? 0);
  });

  it('never hands back a projection without the caveats that make it honest', () => {
    const c = caminoA(historial, 'DIAMOND', { ganadas: 24, jugadas: 45 });
    expect(c.advertencias.length).toBeGreaterThan(0);
    expect(c.advertencias.join(' ')).toContain('intervalo');
  });

  it('says the win rate is too thin to project from, rather than projecting from it', () => {
    const c = caminoA(historial, 'DIAMOND', { ganadas: 6, jugadas: 10 });
    expect(c.advertencias.join(' ')).toContain('10 partidas');
  });

  it('survives an account with no rank at all instead of inventing a starting point', () => {
    const c = caminoA([], 'DIAMOND', { ganadas: 5, jugadas: 10 });
    expect(c.desde).toBeNull();
    expect(c.faltanLp).toBeNull();
    expect(c.central).toBeNull();
  });
});

describe('la firma del matchup', () => {
  const curva = (matchId: string, oros: [number, number][]): StateCurve => ({
    matchId,
    opponentChampion: 'Zed',
    points: oros.map(([minute, goldDiff]) => ({
      minute,
      goldDiff,
      xpDiff: 0,
      csDiff: 0,
      teamGoldDiff: 0,
    })),
    missing: [],
  });

  it('counts n PER MINUTE, because games end and the tail is a smaller sample', () => {
    const f = firmaDe([
      {
        curve: curva('a', [
          [5, 100],
          [10, 200],
          [20, 300],
        ]),
        win: true,
        at: 1,
      },
      {
        curve: curva('b', [
          [5, -100],
          [10, -200],
        ]),
        win: false,
        at: 2,
      },
    ]);
    expect(f.puntos.find((p) => p.minute === 5)?.n).toBe(2);
    expect(f.puntos.find((p) => p.minute === 20)?.n).toBe(1);
    // A curve drawn over two games at minute 5 and one at minute 20 is two samples in one line.
    expect(f.puntos.find((p) => p.minute === 5)?.goldDiff).toBe(0);
    expect(f.puntos.find((p) => p.minute === 20)?.goldDiff).toBe(300);
  });

  it('leaves a minute nobody reached OUT rather than reporting it as zero gold', () => {
    const f = firmaDe([{ curve: curva('a', [[5, 100]]), win: true, at: 1 }]);
    expect(f.puntos.map((p) => p.minute)).toEqual([5]);
  });

  it('attributes a segment to the SMALLER of its two n', () => {
    // A drop into a thin point is a fact about the thin point, not about the fat one it left.
    const f = firmaDe([
      {
        curve: curva('a', [
          [5, 500],
          [10, 500],
          [20, -1500],
        ]),
        win: false,
        at: 1,
      },
      {
        curve: curva('b', [
          [5, 500],
          [10, 500],
        ]),
        win: true,
        at: 2,
      },
    ]);
    expect(f.peorTramo).toMatchObject({ desde: 10, hasta: 20, n: 1 });
  });

  it('carries every rep, so the spread can be drawn instead of described', () => {
    const f = firmaDe([
      { curve: curva('a', [[5, 2000]]), win: true, at: 1 },
      { curve: curva('b', [[5, -2000]]), win: false, at: 2 },
    ]);
    // The mean is zero and the two games could not be more different. Both facts travel.
    expect(f.puntos[0]?.goldDiff).toBe(0);
    expect(f.puntos[0]?.sd).toBeGreaterThan(1000);
    expect(f.curvas).toHaveLength(2);
  });

  it('refuses to call two games a pattern', () => {
    const dos = firmaDe([
      {
        curve: curva('a', [
          [5, 100],
          [10, -900],
        ]),
        win: false,
        at: 1,
      },
      {
        curve: curva('b', [
          [5, 100],
          [10, -900],
        ]),
        win: false,
        at: 2,
      },
    ]);
    expect(lecturaDe(dos)).toBe('anecdota');
    expect(lecturaDe(firmaDe([]))).toBe('nada');
  });
});
