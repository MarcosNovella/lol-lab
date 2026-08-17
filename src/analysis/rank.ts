import type { LeagueEntryDto } from '../riot/types.ts';
import type { Db } from '../store/db.ts';

/**
 * Rank over time, recorded because it cannot be recovered.
 *
 * match-v5 does not carry rank on a played game, and league-v4 only answers "where is this
 * account now" (ADR-012). So the series starts the day something writes it down and there is
 * no way to backfill a single earlier point. That asymmetry is the whole reason this is a
 * table rather than a lookup at read time.
 *
 * `tier` is nullable and NULL means unranked. Not 'UNRANKED', not 'IRON' — absence, so that
 * anything ordering by tier skips the row rather than sorting an unranked account below Iron
 * as if it had been measured.
 */

export type RankSnapshot = {
  puuid: string;
  observedAt: number;
  queueType: string;
  tier: string | null;
  division: string | null;
  leaguePoints: number | null;
  wins: number | null;
  losses: number | null;
};

/** The two queues worth tracking. Riot also returns TFT and arena entries on this endpoint. */
export const TRACKED_QUEUES = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'] as const;

export function snapshotsFromEntries(
  puuid: string,
  entries: LeagueEntryDto[],
  observedAt: number,
): RankSnapshot[] {
  return entries
    .filter((e) => (TRACKED_QUEUES as readonly string[]).includes(e.queueType))
    .map((e) => ({
      puuid,
      observedAt,
      queueType: e.queueType,
      tier: e.tier ?? null,
      division: e.rank ?? null,
      leaguePoints: e.leaguePoints ?? null,
      wins: e.wins ?? null,
      losses: e.losses ?? null,
    }));
}

/**
 * Records a snapshot unless it is identical to the most recent one for the same queue.
 *
 * Deduplicating on VALUE rather than on time: syncing four times in an evening he did not play
 * would otherwise write four identical rows and make the series look like activity. A row
 * therefore means "this changed", which is what a reader of the series wants.
 */
export function recordSnapshot(db: Db, snapshot: RankSnapshot): boolean {
  const latest = latestSnapshot(db, snapshot.puuid, snapshot.queueType);
  if (
    latest !== null &&
    latest.tier === snapshot.tier &&
    latest.division === snapshot.division &&
    latest.leaguePoints === snapshot.leaguePoints &&
    latest.wins === snapshot.wins &&
    latest.losses === snapshot.losses
  ) {
    return false;
  }
  db.prepare(
    `INSERT INTO rank_snapshots (puuid, observed_at, queue_type, tier, division, league_points, wins, losses)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.puuid,
    snapshot.observedAt,
    snapshot.queueType,
    snapshot.tier,
    snapshot.division,
    snapshot.leaguePoints,
    snapshot.wins,
    snapshot.losses,
  );
  return true;
}

function rowToSnapshot(r: Record<string, unknown>): RankSnapshot {
  const nullable = (k: string): number | null => (r[k] === null ? null : Number(r[k]));
  return {
    puuid: String(r['puuid']),
    observedAt: Number(r['observed_at']),
    queueType: String(r['queue_type']),
    tier: r['tier'] === null ? null : String(r['tier']),
    division: r['division'] === null ? null : String(r['division']),
    leaguePoints: nullable('league_points'),
    wins: nullable('wins'),
    losses: nullable('losses'),
  };
}

export function latestSnapshot(db: Db, puuid: string, queueType: string): RankSnapshot | null {
  const row = db
    .prepare(
      `SELECT * FROM rank_snapshots WHERE puuid = ? AND queue_type = ?
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .get(puuid, queueType) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function snapshotHistory(db: Db, puuid: string, queueType: string): RankSnapshot[] {
  const rows = db
    .prepare(
      `SELECT * FROM rank_snapshots WHERE puuid = ? AND queue_type = ?
       ORDER BY observed_at`,
    )
    .all(puuid, queueType) as Record<string, unknown>[];
  return rows.map(rowToSnapshot);
}

/**
 * The snapshot in force when a game was played — the most recent observation at or before it.
 *
 * Returns null for a game older than the first snapshot instead of reaching forward to the
 * nearest one. A division recorded after the fact is not evidence about the game: it is what
 * happened later, and using it would annotate 39 past games with a rank that postdates them.
 */
export function rankAt(snapshots: RankSnapshot[], gameCreation: number): RankSnapshot | null {
  let best: RankSnapshot | null = null;
  for (const s of snapshots) {
    if (s.observedAt <= gameCreation && (best === null || s.observedAt > best.observedAt)) {
      best = s;
    }
  }
  return best;
}

/** 'Platinum II 45 LP', or 'sin rango' when the account has not placed. */
export function describeRank(snapshot: RankSnapshot | null): string {
  if (snapshot === null || snapshot.tier === null) return 'sin rango';
  const parts = [snapshot.tier];
  if (snapshot.division !== null) parts.push(snapshot.division);
  if (snapshot.leaguePoints !== null) parts.push(`${snapshot.leaguePoints} LP`);
  return parts.join(' ');
}
