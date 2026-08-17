import { describeRank, recordSnapshot, snapshotsFromEntries } from '../src/analysis/rank.ts';
import { createClient } from '../src/riot/client.ts';
import { openDb } from '../src/store/db.ts';
import { listAccounts } from '../src/store/matches.ts';

/**
 * Records where every cached account stands right now.
 *
 * Meant to run alongside each sync. It costs one request per account and deduplicates on
 * value, so running it repeatedly is free of noise. The point is the clock: rank cannot be
 * reconstructed for a game already played (ADR-012), so the series is only as long as the
 * history of having run this.
 */

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const db = openDb();
const client = createClient();
const now = Date.now();

for (const account of listAccounts(db)) {
  const label = account.label ?? account.gameName;
  try {
    const entries = await client.getLeagueEntriesByPuuid(account.puuid);
    const snapshots = snapshotsFromEntries(account.puuid, entries, now);
    if (snapshots.length === 0) {
      out(`${label}: sin entradas de ranked (cuenta sin clasificar)`);
      continue;
    }
    for (const snapshot of snapshots) {
      const wrote = recordSnapshot(db, snapshot);
      out(
        `${label} ${snapshot.queueType}: ${describeRank(snapshot)}` +
          ` (${snapshot.wins ?? 0}W-${snapshot.losses ?? 0}L)` +
          `${wrote ? '  → registrado' : '  → sin cambios, no se registra'}`,
      );
    }
  } catch (error) {
    // One account failing must not lose the other's snapshot.
    out(`${label}: ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
}

db.close();
