import type { FlatMatch, ParticipantRow } from '../analysis/flatten.ts';
import type { Platform } from '../riot/routing.ts';
import type { MatchDto, TimelineDto } from '../riot/types.ts';
import { type Db, transaction } from './db.ts';

/** Everything that touches the cache. Upserts are idempotent, keyed on match_id. */

export type AccountRecord = {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  summonerLevel: number | null;
  label: string | null;
  lastSyncedAt: number | null;
};

export type MatchQuery = {
  puuid?: string;
  queueId?: number;
  champion?: string;
  role?: string;
  since?: number;
  until?: number;
  includeRemakes?: boolean;
  limit?: number;
};

export type MatchListRow = ParticipantRow & {
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  patch: string | null;
};

export function upsertAccount(
  db: Db,
  account: {
    puuid: string;
    gameName: string;
    tagLine: string;
    platform: Platform;
    summonerLevel?: number | null;
    label?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO accounts (puuid, game_name, tag_line, platform, summoner_level, label)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(puuid) DO UPDATE SET
       game_name      = excluded.game_name,
       tag_line       = excluded.tag_line,
       platform       = excluded.platform,
       summoner_level = coalesce(excluded.summoner_level, accounts.summoner_level),
       label          = coalesce(excluded.label, accounts.label)`,
  ).run(
    account.puuid,
    account.gameName,
    account.tagLine,
    account.platform,
    account.summonerLevel ?? null,
    account.label ?? null,
  );
}

export function listAccounts(db: Db): AccountRecord[] {
  const rows = db
    .prepare(
      `SELECT puuid, game_name, tag_line, platform, summoner_level, label, last_synced_at
       FROM accounts ORDER BY game_name`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    puuid: String(r['puuid']),
    gameName: String(r['game_name']),
    tagLine: String(r['tag_line']),
    platform: String(r['platform']),
    summonerLevel: r['summoner_level'] === null ? null : Number(r['summoner_level']),
    label: r['label'] === null ? null : String(r['label']),
    lastSyncedAt: r['last_synced_at'] === null ? null : Number(r['last_synced_at']),
  }));
}

/** Resolves an account from a `name#tag` string, a bare name, or a puuid already in cache. */
export function findAccount(db: Db, needle: string): AccountRecord | null {
  const accounts = listAccounts(db);
  const wanted = needle.trim().toLowerCase();
  const [namePart, tagPart] = wanted.split('#');
  return (
    accounts.find((a) => a.puuid.toLowerCase() === wanted) ??
    accounts.find(
      (a) =>
        a.gameName.toLowerCase() === namePart &&
        (tagPart === undefined || a.tagLine.toLowerCase() === tagPart),
    ) ??
    accounts.find((a) => a.label?.toLowerCase() === wanted) ??
    null
  );
}

export function markSynced(db: Db, puuid: string, at: number = Date.now()): void {
  db.prepare('UPDATE accounts SET last_synced_at = ? WHERE puuid = ?').run(at, puuid);
}

export function hasMatch(db: Db, matchId: string): boolean {
  const row = db.prepare('SELECT 1 AS present FROM matches WHERE match_id = ?').get(matchId);
  return row !== undefined;
}

export function knownMatchIds(db: Db, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT match_id FROM matches WHERE match_id IN (${placeholders})`)
    .all(...ids) as Record<string, unknown>[];
  return new Set(rows.map((r) => String(r['match_id'])));
}

export function saveMatch(db: Db, flat: FlatMatch, raw: MatchDto): void {
  transaction(db, () => {
    db.prepare(
      `INSERT INTO matches (match_id, queue_id, game_creation, game_duration, game_version, patch, map_id, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         queue_id = excluded.queue_id, game_creation = excluded.game_creation,
         game_duration = excluded.game_duration, game_version = excluded.game_version,
         patch = excluded.patch, map_id = excluded.map_id, raw = excluded.raw`,
    ).run(
      flat.match.matchId,
      flat.match.queueId,
      flat.match.gameCreation,
      flat.match.gameDuration,
      flat.match.gameVersion,
      flat.match.patch,
      flat.match.mapId,
      JSON.stringify(raw),
    );

    const insert = db.prepare(
      `INSERT INTO participants (
         match_id, puuid, team_id, team_position, champion_id, champion, win,
         kills, deaths, assists, cs, gold, damage_champions, damage_taken, damage_objectives,
         vision_score, control_wards, wards_placed, wards_killed, time_ccing, duration_minutes,
         cs_per_min, gold_per_min, damage_per_min, damage_taken_per_min, vision_per_min,
         deaths_per_min, kda, kill_participation, team_damage_share, solo_kills, turret_plates,
         cs_first_10, max_cs_adv_on_lane, early_lane_adv, lane_adv
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id, puuid) DO UPDATE SET
         team_position = excluded.team_position, champion = excluded.champion, win = excluded.win`,
    );
    for (const p of flat.participants) {
      insert.run(
        p.matchId,
        p.puuid,
        p.teamId,
        p.teamPosition,
        p.championId,
        p.champion,
        p.win,
        p.kills,
        p.deaths,
        p.assists,
        p.cs,
        p.gold,
        p.damageChampions,
        p.damageTaken,
        p.damageObjectives,
        p.visionScore,
        p.controlWards,
        p.wardsPlaced,
        p.wardsKilled,
        p.timeCcing,
        p.durationMinutes,
        p.csPerMin,
        p.goldPerMin,
        p.damagePerMin,
        p.damageTakenPerMin,
        p.visionPerMin,
        p.deathsPerMin,
        p.kda,
        p.killParticipation,
        p.teamDamageShare,
        p.soloKills,
        p.turretPlates,
        p.csFirst10,
        p.maxCsAdvOnLane,
        p.earlyLaneAdv,
        p.laneAdv,
      );
    }
  });
}

export function saveTimeline(db: Db, matchId: string, raw: TimelineDto): void {
  db.prepare(
    `INSERT INTO timelines (match_id, raw) VALUES (?, ?)
     ON CONFLICT(match_id) DO UPDATE SET raw = excluded.raw`,
  ).run(matchId, JSON.stringify(raw));
}

export function getRawMatch(db: Db, matchId: string): MatchDto | null {
  const row = db.prepare('SELECT raw FROM matches WHERE match_id = ?').get(matchId) as
    | Record<string, unknown>
    | undefined;
  return row ? (JSON.parse(String(row['raw'])) as MatchDto) : null;
}

export function getRawTimeline(db: Db, matchId: string): TimelineDto | null {
  const row = db.prepare('SELECT raw FROM timelines WHERE match_id = ?').get(matchId) as
    | Record<string, unknown>
    | undefined;
  return row ? (JSON.parse(String(row['raw'])) as TimelineDto) : null;
}

function rowToMatchListRow(r: Record<string, unknown>): MatchListRow {
  const num = (k: string): number => Number(r[k] ?? 0);
  const nullable = (k: string): number | null => (r[k] === null ? null : Number(r[k]));
  return {
    matchId: String(r['match_id']),
    puuid: String(r['puuid']),
    teamId: num('team_id'),
    teamPosition: String(r['team_position']),
    championId: num('champion_id'),
    champion: String(r['champion']),
    win: num('win'),
    kills: num('kills'),
    deaths: num('deaths'),
    assists: num('assists'),
    cs: num('cs'),
    gold: num('gold'),
    damageChampions: num('damage_champions'),
    damageTaken: num('damage_taken'),
    damageObjectives: nullable('damage_objectives'),
    visionScore: num('vision_score'),
    controlWards: nullable('control_wards'),
    wardsPlaced: nullable('wards_placed'),
    wardsKilled: nullable('wards_killed'),
    timeCcing: nullable('time_ccing'),
    durationMinutes: num('duration_minutes'),
    csPerMin: num('cs_per_min'),
    goldPerMin: num('gold_per_min'),
    damagePerMin: num('damage_per_min'),
    damageTakenPerMin: num('damage_taken_per_min'),
    visionPerMin: num('vision_per_min'),
    deathsPerMin: num('deaths_per_min'),
    kda: num('kda'),
    killParticipation: nullable('kill_participation'),
    teamDamageShare: nullable('team_damage_share'),
    soloKills: nullable('solo_kills'),
    turretPlates: nullable('turret_plates'),
    csFirst10: nullable('cs_first_10'),
    maxCsAdvOnLane: nullable('max_cs_adv_on_lane'),
    earlyLaneAdv: nullable('early_lane_adv'),
    laneAdv: nullable('lane_adv'),
    queueId: num('queue_id'),
    gameCreation: num('game_creation'),
    gameDuration: num('game_duration'),
    patch: r['patch'] === null ? null : String(r['patch']),
  };
}

export function queryParticipants(db: Db, q: MatchQuery): MatchListRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (q.puuid !== undefined) {
    where.push('p.puuid = ?');
    args.push(q.puuid);
  }
  if (q.queueId !== undefined) {
    where.push('m.queue_id = ?');
    args.push(q.queueId);
  }
  if (q.champion !== undefined) {
    where.push('lower(p.champion) = ?');
    args.push(q.champion.toLowerCase());
  }
  if (q.role !== undefined) {
    where.push('p.team_position = ?');
    args.push(q.role.toUpperCase());
  }
  if (q.since !== undefined) {
    where.push('m.game_creation >= ?');
    args.push(q.since);
  }
  if (q.until !== undefined) {
    where.push('m.game_creation <= ?');
    args.push(q.until);
  }
  if (q.includeRemakes !== true) {
    // Same rule as the flattener, applied at read time so the raw rows stay in the cache.
    where.push('m.game_duration >= 300');
    where.push("p.team_position <> ''");
  }

  const sql = `SELECT p.*, m.queue_id, m.game_creation, m.game_duration, m.patch
     FROM participants p JOIN matches m ON m.match_id = p.match_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.game_creation DESC
     ${q.limit !== undefined ? 'LIMIT ?' : ''}`;
  if (q.limit !== undefined) args.push(q.limit);

  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];
  return rows.map(rowToMatchListRow);
}

export type CacheStats = {
  matches: number;
  participants: number;
  timelines: number;
  perAccount: {
    gameName: string;
    tagLine: string;
    label: string | null;
    matches: number;
    oldest: number | null;
    newest: number | null;
    lastSyncedAt: number | null;
  }[];
  perQueue: { queueId: number; matches: number }[];
};

export function cacheStats(db: Db): CacheStats {
  const count = (sql: string): number => {
    const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
    return row ? Number(row['n'] ?? 0) : 0;
  };
  const perAccount = listAccounts(db).map((a) => {
    const row = db
      .prepare(
        `SELECT count(*) AS n, min(m.game_creation) AS oldest, max(m.game_creation) AS newest
         FROM participants p JOIN matches m ON m.match_id = p.match_id WHERE p.puuid = ?`,
      )
      .get(a.puuid) as Record<string, unknown> | undefined;
    return {
      gameName: a.gameName,
      tagLine: a.tagLine,
      label: a.label,
      matches: row ? Number(row['n'] ?? 0) : 0,
      oldest: row?.['oldest'] === null || row === undefined ? null : Number(row['oldest']),
      newest: row?.['newest'] === null || row === undefined ? null : Number(row['newest']),
      lastSyncedAt: a.lastSyncedAt,
    };
  });
  const perQueue = (
    db
      .prepare('SELECT queue_id, count(*) AS n FROM matches GROUP BY queue_id ORDER BY n DESC')
      .all() as Record<string, unknown>[]
  ).map((r) => ({ queueId: Number(r['queue_id']), matches: Number(r['n']) }));

  return {
    matches: count('SELECT count(*) AS n FROM matches'),
    participants: count('SELECT count(*) AS n FROM participants'),
    timelines: count('SELECT count(*) AS n FROM timelines'),
    perAccount,
    perQueue,
  };
}

export function startSyncLog(db: Db, puuid: string, queueId: number | null): number {
  db.prepare('INSERT INTO sync_log (puuid, queue_id, started_at) VALUES (?, ?, ?)').run(
    puuid,
    queueId,
    Date.now(),
  );
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as Record<string, unknown>;
  return Number(row['id']);
}

export function finishSyncLog(
  db: Db,
  id: number,
  stats: { idsSeen: number; fetched: number; skipped: number; timelines: number },
  error: string | null,
): void {
  db.prepare(
    `UPDATE sync_log SET finished_at = ?, ids_seen = ?, fetched = ?, skipped = ?, timelines = ?, error = ?
     WHERE id = ?`,
  ).run(Date.now(), stats.idsSeen, stats.fetched, stats.skipped, stats.timelines, error, id);
}
