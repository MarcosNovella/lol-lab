import { createClient } from '../riot/client.ts';
import { openDb } from '../store/db.ts';
import { matchIdsMissingTimeline } from '../store/matches.ts';
import { backfillTimelines } from '../sync.ts';
import { account as accountOf, CliError, labelOf, out } from './shared.ts';

/**
 * `lol backfill` — fetches the timelines of matches already in the cache.
 *
 * It exists because the repair for a hole in the cache lived ONLY behind the MCP tool
 * `riot_backfill_timelines`, which meant it could only be reached by talking to Claude. The
 * hole is not exotic: `riot_sync` defaults to `withTimeline: false`, and `syncMatches` only
 * ever fetches a timeline for a match it is downloading right now, so any game cached without
 * one stays without one forever no matter how many syncs run afterwards.
 *
 * A match with no timeline has no minute data, which means no lane state, no conversion, no
 * expensive moments, no build timings and no death map — it silently leaves every one of those
 * analyses. That is most of what the engine is for, so the repair belongs where the rituals
 * are, not one layer away.
 *
 * Same rate limit as everything else: about 50 timelines a minute, and it is idempotent, so a
 * run cut short by an expired key is resumed by running it again.
 */

export async function run(argv: string[]): Promise<void> {
  const db = openDb();
  try {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const maxArg = argv.find((a) => a.startsWith('--max='));
    const max = maxArg === undefined ? 100 : Number(maxArg.slice('--max='.length));
    if (!Number.isInteger(max) || max <= 0) throw new CliError(`--max inválido: '${maxArg}'`);

    // No account means every account: a hole is a hole, and making him run this once per
    // account is how one of them stays broken.
    const target = positional[0];
    const record = target === undefined ? null : accountOf(db, target);

    const pending = matchIdsMissingTimeline(db, {
      ...(record !== null ? { puuid: record.puuid } : {}),
    });

    if (pending.length === 0) {
      out(
        record === null
          ? 'Todas las partidas de la caché tienen timeline. No hay nada que reparar.'
          : `Todas las partidas de ${labelOf(record)} tienen timeline.`,
      );
      return;
    }

    out(
      `${pending.length} partida(s) sin timeline${record === null ? '' : ` en ${labelOf(record)}`}.` +
        ` Bajo hasta ${Math.min(max, pending.length)} en esta corrida.`,
    );
    out('  Sin timeline no hay minuto: ni estado de línea, ni conversión, ni momentos caros,');
    out('  ni ítems, ni mapa de muertes. Esas partidas no están en NINGÚN número de arriba.');
    out('');

    const client = createClient();
    let lastShown = -1;
    const result = await backfillTimelines(client, db, {
      max,
      ...(record !== null ? { puuid: record.puuid } : {}),
      onProgress: (done, total) => {
        // One line per ten so a seven-minute backfill shows it is alive without scrolling.
        const step = Math.max(1, Math.floor(total / 10));
        if (done === total || done - lastShown >= step) {
          lastShown = done;
          out(`  ${done}/${total}`);
        }
      },
    });

    out('');
    out(
      `Listo: ${result.fetched} timeline(s) en ${(result.elapsedMs / 1000).toFixed(0)}s` +
        (result.errors.length > 0 ? ` · ${result.errors.length} error(es)` : ''),
    );
    for (const error of result.errors.slice(0, 3)) out(`  ${error}`);

    const left = matchIdsMissingTimeline(db, {
      ...(record !== null ? { puuid: record.puuid } : {}),
    }).length;
    // Said explicitly rather than left to subtraction: the limiter caps a run, so "finished"
    // and "there is nothing left" are different facts and only the second one is done.
    if (left > 0) out(`Quedan ${left} sin timeline — volvé a correrlo, es idempotente.`);
  } finally {
    db.close();
  }
}

export const SUMMARY = 'baja los timelines que faltan de partidas que ya están en la caché';
export const USAGE = 'lol backfill [cuenta] [--max=100]';
