import {
  drift,
  type GrowthCurve,
  type GrowthPoint,
  growthCurve,
  trendSlope,
} from '../analysis/growth.ts';
import { normaliseRole, type Role } from '../analysis/metrics.ts';
import { openDb } from '../store/db.ts';
import { account as accountOf, CliError, labelOf, out } from './shared.ts';

/**
 * `lol growth <account> [metric] [role]` — one account's curve, with the confound drawn.
 *
 * Text, not a dashboard (ADR-007). The two series are rendered on a SHARED scale on purpose:
 * drawing his line and his opponents' line against separate axes would let a flat pair look
 * like divergence, which is the exact misreading the underlay exists to prevent.
 */

/** The curve is soloq-only: flex is three divisions away and would blur the lobby underlay. */
const SOLOQ = 420;

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

function bar(slot: number): string {
  return SPARK[Math.min(SPARK.length - 1, Math.max(0, slot))] ?? SPARK[0];
}

function spark(values: number[], lo: number, hi: number): string {
  // A flat series is drawn flat at the bottom rather than dividing by zero.
  if (hi <= lo) return bar(0).repeat(values.length);
  return values.map((v) => bar(Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1)))).join('');
}

/**
 * Below this the movement is not a movement, it is the third decimal of a rolling mean.
 *
 * A judgement call, like `EVEN_GOLD_BAND`, and it says so: 0.005 CS per game is 0.2 CS over a
 * forty-game season, which nobody would call a trend. The verdict is printed in units of the
 * metric, so the floor lives in them too — and it exists because every other branch is relative
 * to the first slope, which makes them meaningless once that slope is itself noise.
 */
export const FLAT = 0.005;

/** A slope always carries its sign, so a positive one cannot be skimmed as a negative one. */
function signed(value: number): string {
  if (!Number.isFinite(value)) return 'sin medir';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

/**
 * The honest reading of two slopes, spelled out rather than left to the reader.
 *
 * Pure and exported so it can be tested: it is a chain of comparisons where the LAST branch is
 * the one that makes a claim, which is the shape that hides a degenerate case until it prints
 * one. It did. With both slopes at zero, `abs(0) > abs(0)` is false and `abs(0) < abs(0) / 2`
 * is false, so two curves that never moved fell to the final branch, where `net >= 0` reads
 * true and printed "tu línea se movió MÁS que la de los rivales (neto +0.000)". A claim of
 * progress out of a pair of flat lines. Zero has no sign (G-012), and the degenerate case has
 * to be REFUSED here rather than ranked with the others.
 *
 * `FLAT` is a floor under the whole verdict and not only a zero check, because every branch
 * below the first is relative to `mine`: once `mine` is itself noise, the classification is
 * reading the third decimal of a rolling mean and printing it as a finding.
 *
 * It takes two slopes rather than reading them itself, so `slopeLines` can feed it the FIT
 * (G-052) — the only number allowed to state a direction — without this refusal being written
 * twice, or worse, written once and left on the side nobody reads.
 */
export function growthVerdict(mine: number, theirs: number, suffix = ''): string[] {
  if (!Number.isFinite(mine) || !Number.isFinite(theirs)) {
    return ['  No se pudo medir la pendiente de una de las dos curvas, así que no hay lectura.'];
  }
  if (Math.abs(mine) < FLAT && Math.abs(theirs) < FLAT) {
    return [
      `  Ninguna de las dos curvas se movió (movimiento por debajo de ${FLAT} por partida`,
      '  en las dos). No hay nada que leer todavía.',
    ];
  }
  if (Math.abs(theirs) > Math.abs(mine)) {
    return [
      '  LEER CON CUIDADO: la línea de los rivales se movió MÁS que la tuya.',
      '  Lo que cambió sobre todo es contra quién jugás, no cómo jugás.',
    ];
  }
  const net = mine - theirs;
  if (Math.abs(net) < Math.abs(mine) / 2) {
    return [
      '  Tu línea y la de los rivales se movieron juntas: buena parte de tu cambio',
      '  es el nivel del lobby, no tuyo.',
    ];
  }
  return [
    `  Tu línea se movió ${net >= 0 ? 'más' : 'menos'} que la de los rivales`,
    `  (neto ${signed(net)} por partida${suffix}).`,
  ];
}

/**
 * The slope block, as lines — pure, so a test can read exactly what the terminal will show.
 *
 * TWO numbers, never one (G-052). `drift` reads the two ends of the rolling mean and describes
 * where the curve started and stopped; `trendSlope` fits a line over every point and is the only
 * one allowed to state a direction (G-025). They ship together because the distance between them
 * IS the reading: when they disagree, the endpoints are the ones that are wrong.
 */
export function slopeLines(points: GrowthPoint[]): string[] {
  const dMine = drift(points, (p) => p.mineRolling);
  const dTheirs = drift(points, (p) => p.theirsRolling);
  const tMine = trendSlope(points, (p) => p.mineRolling);
  const tTheirs = trendSlope(points, (p) => p.theirsRolling);
  const lines = [
    `  deriva punta a punta:  vos ${signed(dMine)} · rivales ${signed(dTheirs)}   ` +
      '(dos puntos, descripción)',
    `  tendencia ajustada:    vos ${signed(tMine)} · rivales ${signed(tTheirs)}   ` +
      `(sobre los ${points.length} puntos)`,
    '',
  ];

  // ONE implementation of the verdict, fed by the FIT instead of the endpoints. `growthVerdict`
  // carries the refusals G-038 was born from — a pair of flat curves, an unmeasurable one — and
  // rewriting the branch chain here would have dropped both of them on the surface he reads.
  const net = tMine - tTheirs;
  const netDrift = dMine - dTheirs;
  lines.push(...growthVerdict(tMine, tTheirs, ', ajustado'));

  // The disagreement is louder than either number, because it is what makes both untrustworthy
  // as a story about him. Stated only when the SIGNS differ: a size difference is expected,
  // since a fit and a subtraction of two endpoints are not the same measurement.
  if (Number.isFinite(net) && Number.isFinite(netDrift) && Math.sign(net) !== Math.sign(netDrift)) {
    lines.push('');
    lines.push(`  OJO: las dos puntas dicen ${signed(netDrift)} y el ajuste dice ${signed(net)} —`);
    lines.push('  SIGNO OPUESTO. Con las puntas en desacuerdo con la recta, no hay tendencia que');
    lines.push('  contar: dónde paró la serie está mandando más que cómo jugaste (G-025).');
  }
  return lines;
}

function render(curve: GrowthCurve, scope: { role: Role; queue: string }): void {
  const { points } = curve;
  out(`${curve.metricLabel} — cuenta ${curve.account}`);
  out(`${points.length} partidas · media móvil de ${curve.window} · ${curve.skipped} descartadas`);
  // Every other command declares its scope; this one filtered to soloq in silence.
  out(`  alcance: sólo ${scope.queue} · rol ${scope.role} · una cuenta, nunca mezcladas`);
  out('');

  if (points.length < 2) {
    out('  Muy pocas partidas para una curva.');
    return;
  }

  const mine = points.map((p) => p.mineRolling);
  const theirs = points.map((p) => p.theirsRolling);
  // One scale for both series. Separate axes would be a lie of presentation.
  const lo = Math.min(...mine, ...theirs);
  const hi = Math.max(...mine, ...theirs);

  out(`  vos     ${spark(mine, lo, hi)}`);
  out(`  rivales ${spark(theirs, lo, hi)}`);
  out(`          escala compartida ${lo.toFixed(1)} — ${hi.toFixed(1)}`);
  out('');

  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined) return;
  out(`  vos:     ${first.mineRolling.toFixed(1)} → ${last.mineRolling.toFixed(1)}`);
  out(`  rivales: ${first.theirsRolling.toFixed(1)} → ${last.theirsRolling.toFixed(1)}`);

  for (const line of slopeLines(points)) out(line);
  out('');
  out('  Nada de esto separa progreso real de movimiento de MMR: llegan mezclados y esta');
  out('  fuente no los distingue. match-v5 no trae rango ni LP en ninguno de sus 156 campos,');
  out('  así que el subrayado es el nivel ABSOLUTO del rival, medido, no su división.');
}

export function run(argv: string[]): void {
  const [accountArg = 'smurf', metricArg = 'cs_first_10', roleArg = 'mid'] = argv;
  const db = openDb();
  try {
    const account = accountOf(db, accountArg);
    const role = normaliseRole(roleArg);
    if (role === null) throw new CliError(`no existe el rol '${roleArg}'`);

    render(
      growthCurve(db, {
        puuid: account.puuid,
        accountLabel: labelOf(account),
        metricKey: metricArg,
        role,
        queueId: SOLOQ,
      }),
      { role, queue: 'soloq' },
    );
  } finally {
    db.close();
  }
}

export const SUMMARY = 'tu curva en una cuenta, con el nivel del rival dibujado debajo';
export const USAGE = 'lol growth [cuenta] [métrica] [rol]';
