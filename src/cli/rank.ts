import { describeRank, recordSnapshot, snapshotsFromEntries } from '../analysis/rank.ts';
import { createClient } from '../riot/client.ts';
import type { Db } from '../store/db.ts';
import { openDb } from '../store/db.ts';
import { listAccounts } from '../store/matches.ts';
import { labelOf, out } from './shared.ts';

/**
 * `lol rank` — records where every cached account stands right now.
 *
 * Also runs inside `lol cerrar`, which is where it matters: rank cannot be reconstructed for a
 * game already played (ADR-012, verified — match-v5 carries no rank, tier, LP or MMR on any of
 * its 156 participant keys), so the series is only ever as long as the history of having run
 * this. Every evening it does not run is a day of curve that can never be annotated.
 *
 * One request per account, and `recordSnapshot` deduplicates on VALUE — syncing four times on an
 * evening he did not play writes one row, and a row therefore means something moved.
 */

export type SnapshotReport = { lines: string[]; failed: string | null };

export async function snapshotAll(db: Db, now: number = Date.now()): Promise<SnapshotReport> {
  const lines: string[] = [];
  let failed: string | null = null;
  const client = createClient();

  for (const account of listAccounts(db)) {
    const label = labelOf(account);
    try {
      const entries = await client.getLeagueEntriesByPuuid(account.puuid);
      const snapshots = snapshotsFromEntries(account.puuid, entries, now);
      if (snapshots.length === 0) {
        lines.push(`${label}: sin entradas de ranked (cuenta sin clasificar)`);
        continue;
      }
      for (const snapshot of snapshots) {
        const wrote = recordSnapshot(db, snapshot);
        lines.push(
          `${label} ${snapshot.queueType}: ${describeRank(snapshot)}` +
            ` (${snapshot.wins ?? 0}W-${snapshot.losses ?? 0}L)` +
            `${wrote ? '  → registrado' : '  → sin cambios, no se registra'}`,
        );
      }
    } catch (error) {
      // One account failing must not lose the other's snapshot — that is a whole day of clock.
      const why = error instanceof Error ? error.message : String(error);
      failed ??= why;
      lines.push(`${label}: ERROR ${why}`);
    }
  }
  return { lines, failed };
}

export async function run(_argv: string[]): Promise<void> {
  const db = openDb();
  try {
    const report = await snapshotAll(db);
    if (report.lines.length === 0) out('No hay cuentas en la caché.');
    for (const line of report.lines) out(line);
  } finally {
    db.close();
  }
}

export const SUMMARY = 'anota el rango actual de cada cuenta (el reloj sólo corre si esto corre)';
export const USAGE = 'lol rank';
