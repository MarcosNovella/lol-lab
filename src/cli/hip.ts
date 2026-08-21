import {
  evaluateHypothesis,
  evaluationsOf,
  listHypotheses,
  type Spec,
  verdictLabel,
} from '../analysis/hypotheses.ts';
import { standardMeasure } from '../analysis/measures.ts';
import { exposureOf, gamesSince } from '../store/briefings.ts';
import { openDb } from '../store/db.ts';
import { CliError, out } from './shared.ts';

/**
 * `lol hip [ver|evaluar]` — the ledger, from the terminal.
 *
 * Registration is deliberately NOT here. Registering a hypothesis is a dated, one-off act with
 * a frozen spec and a hand-written caveat (ADR-010); putting it behind a convenient subcommand
 * would make it a thing done casually, which is exactly how a ledger fills up with claims
 * nobody meant to freeze. It stays in `scripts/register-hypotheses.ts`, where each registration
 * is written down and reviewed before it runs.
 */

function describeSpec(spec: Spec): string {
  if ('windowSeconds' in spec) {
    return `visión: ventana ${spec.windowSeconds}s, solo-sin-crédito=${spec.onlyUncredited}`;
  }
  if ('teamBand' in spec) {
    return `equipo: minuto ${spec.minute}, banda ${spec.band}, banda-equipo ${spec.teamBand}`;
  }
  if ('rollingGames' in spec) {
    return `deriva: ${spec.metricKey}, ventana ${spec.rollingGames} partidas`;
  }
  if ('deathsPer10Threshold' in spec) {
    return (
      `fase ${spec.fromMinute}-${spec.toMinute}: muertes/10min ≥ ${spec.deathsPer10Threshold}, ` +
      `con ventaja > ${spec.band} al minuto ${spec.gateMinute}`
    );
  }
  return (
    `línea: minuto ${spec.minute}, banda ${spec.band}, outcome ${spec.outcome}, ` +
    `stratum ${spec.stratum}, champion ${spec.champion ?? 'cualquiera'}`
  );
}

export function run(argv: string[]): void {
  const mode = argv[0] ?? 'ver';
  if (mode !== 'ver' && mode !== 'evaluar') {
    throw new CliError(`no existe '${mode}': usá 'ver' o 'evaluar'`);
  }

  const db = openDb();
  try {
    const live = listHypotheses(db);
    if (live.length === 0) {
      out('El ledger está vacío. Se registra desde scripts/register-hypotheses.ts.');
      return;
    }

    const measure = mode === 'evaluar' ? standardMeasure(db) : null;

    for (const h of live) {
      out(h.id);
      out(`  ${h.claim}`);
      out(`  spec ${h.specHash} — ${describeSpec(h.spec)}`);
      out(
        `  registrada ${new Date(h.registeredAt).toISOString()} · ` +
          `baseline ${h.baselineEffect.toFixed(3)} sobre n=${h.baselineN} · ` +
          `${h.gapGames} partida(s) en el hueco declarado`,
      );
      out(`  cautela: ${h.caveat}`);

      // El asterisco, donde se lee el veredicto. Una fila que le mostramos antes de jugar dejó
      // de tener una ventana ciega, y eso no puede vivir solo en la tabla de exposiciones: si
      // hay que creerle o no a un veredicto, se decide acá (ADR-022).
      const exposicion = exposureOf(db, h.id);
      if (exposicion !== null) {
        const jugadas = gamesSince(db, h.spec.puuid, exposicion.first);
        out(
          `  EXPUESTA desde ${new Date(exposicion.first).toISOString().slice(0, 10)} · ` +
            `${exposicion.count} sentada(s) · ${jugadas} partida(s) jugadas sabiéndola`,
        );
      }

      if (measure !== null) {
        // The spec is handed back explicitly so a drifted call site fails loudly (G-013) rather
        // than quietly measuring something the hypothesis never claimed.
        const evaluation = evaluateHypothesis(db, h.id, h.spec, measure);
        const shortfall = Math.max(0, h.nNeeded - evaluation.n);
        const effect = Number.isFinite(evaluation.effect)
          ? evaluation.effect.toFixed(3)
          : 'todavía no medible';
        out(`  fuera de muestra: n=${evaluation.n}, efecto ${effect}`);
        // The number that used to be computed and thrown away. A game with no timeline has no
        // lane state, so it is not in `n` and not anywhere else either — and the fix is one
        // command, which is why the line names it.
        if (evaluation.unreadable > 0) {
          out(
            `  ${evaluation.unreadable} partida(s) de la ventana quedaron sin leer por falta de ` +
              'timeline — corré `lol backfill` y volvé a evaluar.',
          );
        }
        out(
          `  veredicto: ${evaluation.verdict} (${verdictLabel(evaluation.verdict)})` +
            `${shortfall > 0 ? ` — faltan ${shortfall} partidas` : ''}`,
        );
        const history = evaluationsOf(db, h.id);
        if (history.length > 1) out(`  historia: ${history.map((x) => `n=${x.n}`).join(' → ')}`);
      } else {
        const history = evaluationsOf(db, h.id);
        const last = history[0];
        out(
          last === undefined
            ? '  sin evaluar todavía'
            : `  última evaluación: ${last.verdict} (${verdictLabel(last.verdict)}), n=${last.n}`,
        );
      }
      out();
    }

    if (mode === 'ver') {
      out('`lol hip evaluar` corre la evaluación y la registra. `insufficient_n` durante meses');
      out('es la respuesta correcta, no una herramienta rota.');
    }
  } finally {
    db.close();
  }
}

export const SUMMARY = 'el ledger de hipótesis: qué está registrado y cómo va';
export const USAGE = 'lol hip [ver|evaluar]';
