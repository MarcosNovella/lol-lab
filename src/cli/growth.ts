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

function bar(slot: number): string {
  return SPARK[Math.min(SPARK.length - 1, Math.max(0, slot))] ?? SPARK[0];
}

function spark(values: number[], lo: number, hi: number): string {
  // A flat series is drawn flat at the bottom rather than dividing by zero.
  if (hi <= lo) return bar(0).repeat(values.length);
  return values.map((v) => bar(Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1)))).join('');
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

  // The honest reading, spelled out rather than left to the reader.
  const net = dMine - dTheirs;
  if (Math.abs(dTheirs) > Math.abs(dMine)) {
    out('  LEER CON CUIDADO: la línea de los rivales se movió MÁS que la tuya.');
    out('  Lo que cambió sobre todo es contra quién jugás, no cómo jugás.');
  } else if (Math.abs(net) < Math.abs(dMine) / 2) {
    out('  Tu línea y la de los rivales se movieron juntas: buena parte de tu cambio');
    out('  es el nivel del lobby, no tuyo.');
  } else {
    out(`  Tu línea se movió ${net >= 0 ? 'más' : 'menos'} que la de los rivales`);
    out(`  (neto ${net >= 0 ? '+' : ''}${net.toFixed(3)} por partida).`);
  }
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
