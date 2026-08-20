import { CURVE_MINUTES, type StateCurve } from './curve.ts';
import { mean, quantile, round, sampleSd } from './stats.ts';

/**
 * The SHAPE of a matchup across every rep of it, minute by minute.
 *
 * This is the thing an aggregator structurally cannot do. op.gg knows the win rate of Diana into
 * Zed over ten thousand games; it does not know YOUR eight, and it has no timelines at all, so
 * "you are +200 at ten and −400 by twenty in this matchup" is not a sentence it can produce. The
 * win rate says the matchup is hard. This says WHERE it breaks, which is the part you can act on
 * between one game and the next.
 *
 * Three decisions keep it from being the usual lie of a mean:
 *
 * - `n` IS PER MINUTE, not per matchup. Games end. A curve drawn over eight games at minute 10
 *   and two at minute 30 is two different samples in one line, and the tail is where a mean
 *   wanders. Every point carries the count that produced it.
 * - EVERY GAME TRAVELS. The consumer gets the individual curves as well as the mean, so the
 *   spread can be drawn instead of described. A mean of eight games with a 2000-gold spread and
 *   a mean of eight games that all did the same thing are the same number and different facts.
 * - NOTHING IS CALLED A FINDING. There is a `peorTramo`, and it is the largest drop between two
 *   consecutive points of the mean — a description of a drawing, at whatever n it rests on. It
 *   is not registered, not ranked, and the caller is told the n so it can refuse to print it.
 */

export type PuntoFirma = {
  minute: number;
  /** Games that actually reached this minute. The denominator, per point. */
  n: number;
  goldDiff: number;
  csDiff: number;
  xpDiff: number;
  /** Sample sd of the gold gap. NaN below two games — never 0, which reads as "no spread". */
  sd: number;
  /** Quartiles of the gold gap, which survive a small n better than a mean plus an sd. */
  p25: number;
  p75: number;
};

export type Firma = {
  /** Every rep, in the order they were played, so a consumer can draw them behind the mean. */
  curvas: {
    matchId: string;
    win: boolean;
    at: number;
    puntos: { minute: number; goldDiff: number }[];
  }[];
  puntos: PuntoFirma[];
  juegos: number;
  ganadas: number;
  /**
   * The widest drop between two consecutive sampled minutes of the MEAN curve.
   *
   * A description of the drawing and nothing more. Its `n` is the smaller of the two points'
   * counts, because a drop from a point of eight games to a point of two is a fact about two
   * games wearing the authority of eight.
   */
  peorTramo: { desde: number; hasta: number; delta: number; n: number } | null;
  /** The same, upward: where the mean curve gains the most. */
  mejorTramo: { desde: number; hasta: number; delta: number; n: number } | null;
};

export function firmaDe(
  curvas: { curve: StateCurve; win: boolean; at: number }[],
  minutos: readonly number[] = CURVE_MINUTES,
): Firma {
  const puntos: PuntoFirma[] = [];
  for (const minute of minutos) {
    const oros: number[] = [];
    const css: number[] = [];
    const xps: number[] = [];
    for (const { curve } of curvas) {
      const p = curve.points.find((x) => x.minute === minute);
      if (p === undefined) continue;
      oros.push(p.goldDiff);
      css.push(p.csDiff);
      xps.push(p.xpDiff);
    }
    // A minute nobody reached is left OUT rather than reported as zero: an absent sample and a
    // gap of zero gold are different facts and the second is a claim.
    if (oros.length === 0) continue;
    puntos.push({
      minute,
      n: oros.length,
      goldDiff: round(mean(oros), 0),
      csDiff: round(mean(css), 1),
      xpDiff: round(mean(xps), 0),
      sd: round(sampleSd(oros), 0),
      p25: round(quantile(oros, 0.25), 0),
      p75: round(quantile(oros, 0.75), 0),
    });
  }

  let peor: Firma['peorTramo'] = null;
  let mejor: Firma['mejorTramo'] = null;
  for (let i = 1; i < puntos.length; i += 1) {
    const a = puntos[i - 1];
    const b = puntos[i];
    if (a === undefined || b === undefined) continue;
    const delta = b.goldDiff - a.goldDiff;
    // The smaller n of the two, because a drop into a thin point is a fact about the thin point.
    const n = Math.min(a.n, b.n);
    if (peor === null || delta < peor.delta) peor = { desde: a.minute, hasta: b.minute, delta, n };
    if (mejor === null || delta > mejor.delta) {
      mejor = { desde: a.minute, hasta: b.minute, delta, n };
    }
  }

  return {
    curvas: curvas.map(({ curve, win, at }) => ({
      matchId: curve.matchId,
      win,
      at,
      puntos: curve.points.map((p) => ({ minute: p.minute, goldDiff: p.goldDiff })),
    })),
    puntos,
    juegos: curvas.length,
    ganadas: curvas.filter((c) => c.win).length,
    peorTramo: peor,
    mejorTramo: mejor,
  };
}

/**
 * How much of the shape is worth reading, in one word.
 *
 * The panel needs a floor somewhere or it will print "the matchup breaks between 14 and 20" over
 * two games. These thresholds are a JUDGEMENT CALL and say so: they are about how many reps make
 * a drawing worth looking at, not about significance, and nothing downstream of them is
 * registered as a prediction.
 */
export type Lectura = 'nada' | 'anecdota' | 'forma' | 'patron';

export function lecturaDe(firma: Firma): Lectura {
  const n = firma.peorTramo?.n ?? 0;
  if (firma.juegos === 0) return 'nada';
  if (n < 3) return 'anecdota';
  if (n < 8) return 'forma';
  return 'patron';
}

export const LECTURA_ES: Record<Lectura, string> = {
  nada: 'sin partidas',
  anecdota: 'anécdota — una o dos partidas, no leas una forma acá',
  forma: 'se empieza a ver una forma, todavía con pocas reps',
  patron: 'suficientes reps para que la forma no sea una casualidad',
};
