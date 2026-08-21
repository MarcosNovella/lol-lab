import { assembleBriefing, PregameError } from '../pregame.ts';
import { exposureOf, gamesSince } from '../store/briefings.ts';
import { openDb } from '../store/db.ts';
import { account, CliError, labelOf, localStamp, out } from './shared.ts';

/**
 * `lol antes [cuenta]` — lo único que el motor tiene para decir ANTES de jugar.
 *
 * El ritual entero vivía después de la sesión: el motor hablaba cuando ya no se podía hacer nada
 * con lo que decía. Esto es la otra mitad, y es deliberadamente CORTA — la pista libre, un solo
 * foco y el reloj. Un briefing que se lee en veinte segundos es un briefing que se lee.
 *
 * Lo que NO hace: inventar consejos. Todo lo que puede decir sale del ledger, y por qué elige
 * una fila y guarda las otras está en `analysis/briefing.ts`.
 */

export function run(argv: string[]): void {
  const cuenta = argv[0] ?? 'smurf';
  if (cuenta.startsWith('-')) {
    // No hay un flag para mirar sin que quede anotado, y no es un olvido: ver el foco es lo que
    // contamina la medición, así que un "mostrámelo pero no lo cuentes" haría que el registro
    // mienta justo cuando haya que creerle o no.
    throw new CliError(
      `'${cuenta}' no es una opción. \`lol antes\` toma una cuenta y nada más, y siempre anota ` +
        'lo que te muestra.',
    );
  }

  const db = openDb();
  try {
    // Se resuelve acá además de adentro para poder contar SUS partidas desde la exposición: el
    // briefing devuelve la etiqueta, y contar partidas necesita el puuid.
    const record = account(db, cuenta);
    const b = assembleBriefing(db, labelOf(record));

    out(`Antes de jugar — cuenta ${b.account}          ${localStamp(b.at)}`);
    out();

    out('  PISTA LIBRE');
    if (b.runway.length === 0) {
      out('    Nada que arreglar. Podés entrar.');
    } else {
      for (const a of b.runway) {
        out(`    ${a.urgencia === 'ahora' ? '▸' : '·'} ${a.que}`);
        out(`      ${a.porque}`);
      }
    }
    out();

    out('  EL FOCO');
    if (b.focus === null) {
      out(`    ${b.noFocusReason ?? 'No hay nada registrado que mostrar.'}`);
    } else {
      out(`    ${b.focus.id}`);
      out(`    ${b.focus.claim}`);
      out(`    cautela: ${b.focus.caveat}`);
      out(`    ${b.focus.why}`);
      // Lo que hace medible la contaminación en vez de dejarla como advertencia: desde cuándo
      // lo sabe, y cuántas partidas jugó sabiéndolo. Esas partidas ya no son ciegas y el
      // veredicto que salga de ellas tiene que decirlo.
      const exposicion = exposureOf(db, b.focus.id);
      if (exposicion === null || !b.focus.alreadyExposed) {
        out('    ANOTADO: desde esta sentada, esta fila arrastra que ya te la había dicho.');
      } else {
        const jugadas = gamesSince(db, record.puuid, exposicion.first);
        out(
          `    expuesta desde ${localStamp(exposicion.first)} · ` +
            `${exposicion.count} sentada(s) · ${jugadas} partida(s) jugadas desde entonces`,
        );
      }
    }
    if (b.withheld.length > 0) {
      out();
      out('    Guardadas (no te las muestro, a propósito):');
      for (const w of b.withheld) {
        out(
          w.reason === 'sin_evaluar'
            ? `      ${w.id} — nunca se evaluó: no sé cuánto acumuló y la exposición no se ` +
                'deshace'
            : `      ${w.id} — le faltan ${w.shortfall}, está al alcance de un veredicto limpio`,
        );
      }
    }
    out();

    out('  EL RELOJ');
    for (const r of b.clock) {
      const wl = r.wins === null || r.losses === null ? '' : ` (${r.wins}W-${r.losses}L)`;
      out(`    ${r.queue.padEnd(16)} ${r.text}${wl}`);
    }
    out();

    if (b.silence !== null) {
      out('  DE QUÉ NO PUEDO HABLAR');
      out(
        `    ${b.silence.muted} de ${b.silence.total} matchups todavía no tienen datos propios ` +
          'suficientes.',
      );
      out('    En champ select: `lol prep <campeón>` para el que te toque.');
    }
  } catch (error) {
    if (error instanceof PregameError) throw new CliError(error.message);
    throw error;
  } finally {
    db.close();
  }
}

export const SUMMARY = 'el briefing de antes de jugar: la pista libre, un foco y el reloj';
export const USAGE = 'lol antes [cuenta]';
