import { drift, type GrowthCurve, growthCurve } from '../analysis/growth.ts';
import { normaliseRole } from '../analysis/metrics.ts';
import { openDb } from '../store/db.ts';
import { account as accountOf, CliError, labelOf, out } from './shared.ts';

/**
 * `lol growth <account> [metric] [role]` — one account's curve, with the confound drawn.
 *
 * Text, not a dashboard (ADR-007). The two series are rendered on a SHARED scale on purpose:
 * drawing his line and his opponents' line against separate axes would let a flat pair look
 * like divergence, which is the exact misreading the underlay exists to prevent.
 */

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Below this the drift is not a movement, it is the third decimal of a rolling mean.
 *
 * A judgement call, like `EVEN_GOLD_BAND`, and it says so: 0.005 CS per game is 0.2 CS over a
 * forty-game season, which nobody would call a trend. The verdict is printed in units of the
 * metric, so the floor lives in them too — and it exists because every other branch is relative
 * to `dMine`, which makes them meaningless once `dMine` is itself noise.
 */
export const FLAT = 0.005;

function bar(slot: number): string {
  return SPARK[Math.min(SPARK.length - 1, Math.max(0, slot))] ?? SPARK[0];
}

function spark(values: number[], lo: number, hi: number): string {
  // A flat series is drawn flat at the bottom rather than dividing by zero.
  if (hi <= lo) return bar(0).repeat(values.length);
  return values.map((v) => bar(Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1)))).join('');
}

/**
 * The honest reading of the two drifts, spelled out rather than left to the reader.
 *
 * Pure and exported so it can be tested: it is a chain of comparisons where the LAST branch is
 * the one that makes a claim, which is the shape that hides a degenerate case until it prints
 * one. It did. With both drifts at zero, `abs(0) > abs(0)` is false and `abs(0) < abs(0) / 2`
 * is false, so two curves that never moved fell to the final branch, where `net >= 0` reads
 * true and printed "tu línea se movió MÁS que la de los rivales (neto +0.000)". A claim of
 * progress out of a pair of flat lines. Zero has no sign (G-012), and the degenerate case has
 * to be REFUSED here rather than ranked with the others.
 *
 * `FLAT` is a floor under the whole verdict and not only a zero check, because every branch
 * below the first is relative to `dMine`: once `dMine` is itself noise, the classification is
 * reading the third decimal of a rolling mean and printing it as a finding.
 */
export function growthVerdict(dMine: number, dTheirs: number): string[] {
  if (!Number.isFinite(dMine) || !Number.isFinite(dTheirs)) {
    return ['  No se pudo medir la deriva de una de las dos curvas, así que no hay lectura.'];
  }
  if (Math.abs(dMine) < FLAT && Math.abs(dTheirs) < FLAT) {
    return [
      `  Ninguna de las dos curvas se movió (deriva por debajo de ${FLAT} por partida`,
      '  en las dos). No hay nada que leer todavía.',
    ];
  }
  if (Math.abs(dTheirs) > Math.abs(dMine)) {
    return [
      '  LEER CON CUIDADO: la línea de los rivales se movió MÁS que la tuya.',
      '  Lo que cambió sobre todo es contra quién jugás, no cómo jugás.',
    ];
  }
  const net = dMine - dTheirs;
  if (Math.abs(net) < Math.abs(dMine) / 2) {
    return [
      '  Tu línea y la de los rivales se movieron juntas: buena parte de tu cambio',
      '  es el nivel del lobby, no tuyo.',
    ];
  }
  return [
    `  Tu línea se movió ${net >= 0 ? 'más' : 'menos'} que la de los rivales`,
    `  (neto ${net >= 0 ? '+' : ''}${net.toFixed(3)} por partida).`,
  ];
}

function render(curve: GrowthCurve): void {
  const { points } = curve;
  out(`${curve.metricLabel} — cuenta ${curve.account}`);
  out(`${points.length} partidas · media móvil de ${curve.window} · ${curve.skipped} descartadas`);
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

  const dMine = drift(points, (p) => p.mineRolling);
  const dTheirs = drift(points, (p) => p.theirsRolling);
  out(
    `  deriva por partida: vos ${dMine >= 0 ? '+' : ''}${dMine.toFixed(3)} · ` +
      `rivales ${dTheirs >= 0 ? '+' : ''}${dTheirs.toFixed(3)}`,
  );
  out('');

  for (const line of growthVerdict(dMine, dTheirs)) out(line);
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
        queueId: 420,
      }),
    );
  } finally {
    db.close();
  }
}

export const SUMMARY = 'tu curva en una cuenta, con el nivel del rival dibujado debajo';
export const USAGE = 'lol growth [cuenta] [métrica] [rol]';
