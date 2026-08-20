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
  /** Mean LP gained per win, measured from his snapshots. NaN when nothing could be measured. */
  porVictoria: number;
  /** Mean LP lost per loss, as a POSITIVE number. NaN when nothing could be measured. */
  porDerrota: number;
  /** Snapshot pairs the measurement rests on. Small n here means the numbers are provisional. */
  tramos: number;
  /** The win rate at which LP stops moving: perdida / (ganada + perdida). */
  breakEven: number;
};

/**
 * LP per win and per loss, read off consecutive rank snapshots.
 *
 * The rank clock deduplicates on VALUE, so two consecutive rows differ in something, and between
 * them `wins` and `losses` say how many games happened. A pair where BOTH counters moved cannot
 * be attributed — three wins and two losses over one LP gap is four unknowns and one equation —
 * so those pairs are dropped rather than averaged into the answer.
 *
 * Pairs that cross a DIVISION are kept, because `lpAbsoluto` makes the gap continuous; pairs
 * that cross into an apex tier are dropped, since LP there is a different quantity.
 */
export function lpMedido(snapshots: RankSnapshot[]): LpMedido {
  const orden = [...snapshots].sort((a, b) => a.observedAt - b.observedAt);
  const ganancias: number[] = [];
  const perdidas: number[] = [];
  let tramos = 0;

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

    const dW = (ahora.wins ?? 0) - (antes.wins ?? 0);
    const dL = (ahora.losses ?? 0) - (antes.losses ?? 0);
    const delta = b - a;
    tramos += 1;
    // Attributable only when exactly one side moved. Anything else is more unknowns than
    // equations, and averaging it in is how a made-up number gets an honest-looking mean.
    if (dW > 0 && dL === 0) ganancias.push(delta / dW);
    else if (dL > 0 && dW === 0) perdidas.push(-delta / dL);
  }

  const media = (xs: number[]): number =>
    xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length;
  const porVictoria = media(ganancias);
  const porDerrota = media(perdidas);
  return {
    porVictoria: round(porVictoria, 1),
    porDerrota: round(porDerrota, 1),
    tramos,
    breakEven:
      Number.isFinite(porVictoria) && Number.isFinite(porDerrota) && porVictoria + porDerrota > 0
        ? round(porDerrota / (porVictoria + porDerrota), 3)
        : Number.NaN,
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

  if (lp.tramos < 3) {
    advertencias.push(
      `El LP por partida sale de ${lp.tramos} tramo(s) del reloj de rango. Corré \`lol rank\` ` +
        'seguido: con pocos tramos estos números son provisorios.',
    );
  }
  if (!Number.isFinite(lp.porVictoria) || !Number.isFinite(lp.porDerrota)) {
    advertencias.push(
      'No pude medir tu LP por victoria o por derrota: hacen falta dos snapshots donde se haya ' +
        'movido sólo el contador de ganadas, o sólo el de perdidas.',
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
