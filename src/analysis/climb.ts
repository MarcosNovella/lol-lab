import type { RankSnapshot } from './rank.ts';
import { round } from './stats.ts';

/**
 * How far Diamond is, in games, from his own numbers.
 *
 * Every site with a "climb calculator" answers this with a single confident number. This one
 * refuses to, and the refusal is the feature: a win rate measured over fifty games has an
 * interval about fourteen points wide, and at 53% ± 14 the honest answer to "how many games to
 * Diamond" includes "possibly never". A projection that hides that is not optimism, it is a
 * number that will be wrong in a direction he cannot see.
 *
 * What makes it HIS and not a generic table: the LP per win and per loss are MEASURED from his
 * own rank snapshots rather than assumed to be twenty. They depend on the gap between his MMR
 * and his division, they move as he climbs, and they are the whole difference between "45% is
 * break-even" and "you need 52% just to hold". No aggregator knows this about him because none
 * of them samples his rank on a clock — this project does, on every sync, deduplicated on value.
 */

/** Divisions in a tier, and LP in a division. The ladder's own shape, not a guess about it. */
export const DIVISIONES = ['IV', 'III', 'II', 'I'] as const;
export const LP_POR_DIVISION = 100;

/**
 * The tiers, in order. Apex tiers (Master and up) have no divisions and no LP ceiling, which is
 * why the target list stops naming a division above Diamond.
 */
export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_ES: Record<string, string> = {
  IRON: 'Hierro',
  BRONZE: 'Bronce',
  SILVER: 'Plata',
  GOLD: 'Oro',
  PLATINUM: 'Platino',
  EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante',
  MASTER: 'Maestro',
  GRANDMASTER: 'Gran Maestro',
  CHALLENGER: 'Aspirante',
};

/**
 * A rank as one number: total LP from the bottom of the ladder.
 *
 * It exists so "how far is Diamond" is a subtraction instead of a pile of special cases. Null
 * for an unranked or unknown tier — never 0, which would put an unranked account at Iron IV and
 * quietly make every distance wrong.
 */
export function lpAbsoluto(snapshot: {
  tier: string | null;
  division: string | null;
  leaguePoints: number | null;
}): number | null {
  if (snapshot.tier === null) return null;
  const tierIndex = (TIERS as readonly string[]).indexOf(snapshot.tier.toUpperCase());
  if (tierIndex < 0) return null;
  const apex = tierIndex >= TIERS.indexOf('MASTER');
  const divisionIndex = apex
    ? 0
    : (DIVISIONES as readonly string[]).indexOf((snapshot.division ?? '').toUpperCase());
  if (!apex && divisionIndex < 0) return null;
  return (
    tierIndex * DIVISIONES.length * LP_POR_DIVISION +
    divisionIndex * LP_POR_DIVISION +
    (snapshot.leaguePoints ?? 0)
  );
}

export type LpMedido = {
  /** Mean LP gained per win. NaN when nothing could be measured. */
  porVictoria: number;
  /** Mean LP lost per loss, as a POSITIVE number. NaN when nothing could be measured. */
  porDerrota: number;
  /** Snapshot spans the fit rests on. Two is the minimum and it is an exact solve, not a fit. */
  tramos: number;
  /** The win rate at which LP stops moving: perdida / (ganada + perdida). */
  breakEven: number;
  /**
   * Where the numbers came from, because the answer changes what the reader should believe.
   * `medido` is his own ladder; `supuesto` is a stated default and the card must say so.
   */
  origen: 'medido' | 'supuesto';
  /** Why it fell back, when it did. Null when the fit worked. */
  porQueNo: string | null;
};

/**
 * What a win and a loss are worth when his own snapshots cannot say.
 *
 * A STATED ASSUMPTION, never presented as a measurement. Around twenty each is the ladder's
 * ordinary shape for someone whose MMR matches their division, which makes it the least-wrong
 * placeholder and still wrong for anybody who is climbing or stuck. The card labels it, and it
 * is replaced by the real thing as soon as three snapshots exist.
 */
export const LP_SUPUESTO = { porVictoria: 20, porDerrota: 20 };

/**
 * Plausible bounds for LP per game. Outside them the fit found noise, not a ladder.
 *
 * Riot's range is roughly 10 to 40 depending on how far MMR sits from the division. A fit that
 * lands outside is arithmetic that solved the equations and described nothing, and printing it
 * would be worse than the honest default — it would be a wrong number wearing the word "medido".
 */
const LP_MIN = 5;
const LP_MAX = 60;

/**
 * LP per win and per loss, fitted across every span between rank snapshots.
 *
 * The first version of this only used spans where exactly ONE counter moved — a single win, or a
 * single loss — because that is the case with one unknown and one equation. It was correct and
 * useless: the rank clock is sampled on a sync, syncs happen after a session, and a session is
 * several games, so on a real cache almost every span has both counters moving and the honest
 * version measured nothing at all. The feature existed and answered "no pude medir".
 *
 * A span with six wins and one loss is still one equation with two unknowns; THREE such spans
 * are an overdetermined system, and least squares solves it. Same discipline, more of the data:
 * nothing is assumed, the spans just get read together instead of one at a time.
 *
 * Refuses rather than guesses in the two cases where the fit is meaningless: a system whose
 * spans all share the same win-to-loss ratio (collinear, no unique solution), and a solution
 * outside the range LP can actually take.
 */
export function lpMedido(snapshots: RankSnapshot[]): LpMedido {
  const orden = [...snapshots].sort((a, b) => a.observedAt - b.observedAt);
  const spans: { w: number; l: number; delta: number }[] = [];

  for (let i = 1; i < orden.length; i += 1) {
    const antes = orden[i - 1];
    const ahora = orden[i];
    if (antes === undefined || ahora === undefined) continue;
    const a = lpAbsoluto(antes);
    const b = lpAbsoluto(ahora);
    if (a === null || b === null) continue;
    // Apex LP is not division LP and the two cannot be subtracted from each other.
    const apex = (t: string | null) =>
      t !== null && TIERS.indexOf(t.toUpperCase() as Tier) >= TIERS.indexOf('MASTER');
    if (apex(antes.tier) || apex(ahora.tier)) continue;

    const w = (ahora.wins ?? 0) - (antes.wins ?? 0);
    const l = (ahora.losses ?? 0) - (antes.losses ?? 0);
    // A span with no games in it carries no information about what a game is worth, and a
    // negative one means the counters were reset — a new season, not a game.
    if (w < 0 || l < 0 || w + l === 0) continue;
    spans.push({ w, l, delta: b - a });
  }

  const fallback = (porQue: string): LpMedido => ({
    ...LP_SUPUESTO,
    tramos: spans.length,
    breakEven: round(
      LP_SUPUESTO.porDerrota / (LP_SUPUESTO.porVictoria + LP_SUPUESTO.porDerrota),
      3,
    ),
    origen: 'supuesto',
    porQueNo: porQue,
  });

  if (spans.length < 2) {
    return fallback(
      `Hacen falta al menos dos tramos del reloj de rango y hay ${spans.length}. ` +
        'Cada sync anota uno cuando algo cambió.',
    );
  }

  // Least squares on delta = w*G - l*L, through the origin: a span with no games moves no LP.
  let A = 0;
  let B = 0;
  let C = 0;
  let P = 0;
  let Q = 0;
  for (const { w, l, delta } of spans) {
    A += w * w;
    B += w * l;
    C += l * l;
    P += w * delta;
    Q += l * delta;
  }
  const det = B * B - A * C;
  // Collinear spans — every one with the same win-to-loss ratio — leave the two unknowns
  // indistinguishable. There is no unique answer and inventing one is the whole thing this
  // module refuses to do.
  if (Math.abs(det) < 1e-9) {
    return fallback(
      'Todos los tramos tienen la misma proporción de victorias y derrotas, así que no se ' +
        'puede separar cuánto vale una de cuánto vale la otra.',
    );
  }
  const G = (-P * C + B * Q) / det;
  const L = (A * Q - B * P) / det;

  if (!Number.isFinite(G) || !Number.isFinite(L)) return fallback('El ajuste no dio un número.');
  if (G < LP_MIN || G > LP_MAX || L < LP_MIN || L > LP_MAX) {
    return fallback(
      `El ajuste dio ${G.toFixed(0)} LP por victoria y ${L.toFixed(0)} por derrota, que está ` +
        'fuera de lo que el LP puede valer. Con más tramos se acomoda.',
    );
  }

  return {
    porVictoria: round(G, 1),
    porDerrota: round(L, 1),
    tramos: spans.length,
    breakEven: round(L / (G + L), 3),
    origen: 'medido',
    porQueNo: null,
  };
}

/**
 * Wilson score interval for a win rate.
 *
 * Wilson rather than the textbook normal approximation because the normal one is wrong exactly
 * where it matters here: at small n and at rates near 0 or 1 it produces bounds outside [0,1],
 * and a lower bound of −4% would make the honest half of this card look like a bug.
 *
 * It is an interval and NOT a p-value: this project reports effect and n, never p (ADR-002's
 * honesty rule), and an interval answers the question actually being asked — how wrong could
 * this rate be — rather than a question about a null hypothesis nobody stated.
 */
export function intervaloWilson(
  ganadas: number,
  jugadas: number,
  z = 1.96,
): { bajo: number; alto: number } {
  if (jugadas === 0) return { bajo: Number.NaN, alto: Number.NaN };
  const p = ganadas / jugadas;
  const z2 = z * z;
  const denominador = 1 + z2 / jugadas;
  const centro = (p + z2 / (2 * jugadas)) / denominador;
  const margen =
    (z * Math.sqrt((p * (1 - p)) / jugadas + z2 / (4 * jugadas * jugadas))) / denominador;
  return { bajo: Math.max(0, centro - margen), alto: Math.min(1, centro + margen) };
}

export type Proyeccion = {
  /** Games at this win rate, or null when the rate does not climb at all. */
  partidas: number | null;
  winRate: number;
};

export type Camino = {
  desde: { tier: string; division: string | null; lp: number; texto: string } | null;
  hasta: { tier: string; texto: string };
  /** LP between the two, or null when the current rank is unknown. */
  faltanLp: number | null;
  lp: LpMedido;
  winRate: { valor: number; jugadas: number; ganadas: number; bajo: number; alto: number } | null;
  /**
   * Three projections from the SAME data: the measured rate, and each end of its interval.
   *
   * Three because one is a lie. The optimistic and pessimistic ends are not decoration — at
   * fifty games the interval is about fourteen points wide, which is the difference between
   * "sixty games away" and "this win rate does not climb".
   */
  central: Proyeccion | null;
  optimista: Proyeccion | null;
  pesimista: Proyeccion | null;
  /** Everything that stops this from being a promise, in the order it should be read. */
  advertencias: string[];
};

/** Games to cover `faltanLp` at a win rate, or null when the rate loses ground or breaks even. */
export function partidasPara(faltanLp: number, winRate: number, lp: LpMedido): number | null {
  if (!Number.isFinite(lp.porVictoria) || !Number.isFinite(lp.porDerrota)) return null;
  const neto = winRate * lp.porVictoria - (1 - winRate) * lp.porDerrota;
  // Zero is not "a very large number of games", it is a different answer: at this rate the
  // ladder is a treadmill. Saying "infinity" would be arithmetic; saying null is the truth.
  if (neto <= 0) return null;
  // Rounded before the ceiling, and not for tidiness: at 60% with +22/−18 the net is
  // 5.999999999999999 in binary floating point, so 300/neto is 50.00000000000001 and the
  // ceiling turns an exact fifty into fifty-one. One game of error nobody could explain, in a
  // number presented as a count.
  return Math.ceil(round(faltanLp / neto, 6));
}

export function caminoA(
  snapshots: RankSnapshot[],
  objetivo: Tier,
  registro: { ganadas: number; jugadas: number },
): Camino {
  const orden = [...snapshots].sort((a, b) => b.observedAt - a.observedAt);
  const actual = orden[0] ?? null;
  const lp = lpMedido(snapshots);
  const desdeLp = actual === null ? null : lpAbsoluto(actual);
  const hastaLp = lpAbsoluto({ tier: objetivo, division: 'IV', leaguePoints: 0 });

  const advertencias: string[] = [];
  const winRate =
    registro.jugadas === 0
      ? null
      : {
          valor: registro.ganadas / registro.jugadas,
          jugadas: registro.jugadas,
          ganadas: registro.ganadas,
          ...intervaloWilson(registro.ganadas, registro.jugadas),
        };

  if (lp.origen === 'supuesto') {
    // Loudly, and first: with an assumed ±20 the break-even is exactly 50%, and at 52.6% that
    // is barely one LP a game — four hundred games to Diamond. Measured at +24/−17 the same win
    // rate is three LP a game and ninety-six games. The label is not a formality: the assumption
    // changes the answer by a factor of four.
    advertencias.push(
      `El LP por partida es un SUPUESTO de ±${lp.porVictoria}, no una medición. ${lp.porQueNo ?? ''} ` +
        'Con el número real esta cuenta puede cambiar por un factor de cuatro, así que leelo ' +
        'como un orden de magnitud y no como un plan.',
    );
  } else if (lp.tramos < 4) {
    advertencias.push(
      `El LP por partida se ajustó sobre ${lp.tramos} tramos del reloj de rango, que es poco. ` +
        'Cada sync anota uno cuando algo cambió, así que se afina solo a medida que jugás.',
    );
  }
  if (winRate !== null && winRate.jugadas < 30) {
    advertencias.push(
      `El winrate sale de ${winRate.jugadas} partidas y su intervalo es enorme. Cualquier ` +
        'proyección de acá es una cuenta, no un pronóstico.',
    );
  }
  advertencias.push(
    'Nada de esto sabe de rachas, de MMR ni de que subir cambia contra quién jugás. Es ' +
      'aritmética sobre tus propios números, y el intervalo está justamente porque la ' +
      'aritmética sola miente.',
  );

  const faltanLp = desdeLp === null || hastaLp === null ? null : Math.max(0, hastaLp - desdeLp);
  const proy = (rate: number | undefined): Proyeccion | null =>
    faltanLp === null || rate === undefined || !Number.isFinite(rate)
      ? null
      : { partidas: partidasPara(faltanLp, rate, lp), winRate: round(rate, 3) };

  return {
    desde:
      actual === null || actual.tier === null
        ? null
        : {
            tier: actual.tier,
            division: actual.division,
            lp: actual.leaguePoints ?? 0,
            texto:
              `${TIER_ES[actual.tier.toUpperCase()] ?? actual.tier} ${actual.division ?? ''} ${actual.leaguePoints ?? 0} LP`.replace(
                /\s+/g,
                ' ',
              ),
          },
    hasta: { tier: objetivo, texto: TIER_ES[objetivo] ?? objetivo },
    faltanLp,
    lp,
    winRate,
    central: proy(winRate?.valor),
    optimista: proy(winRate?.alto),
    pesimista: proy(winRate?.bajo),
    advertencias,
  };
}
