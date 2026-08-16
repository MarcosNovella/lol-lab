import { flattenMatch } from './analysis/flatten.ts';
import type { RiotClient } from './riot/client.ts';
import type { Platform } from './riot/routing.ts';
import type { Db } from './store/db.ts';
import {
  type AccountRecord,
  finishSyncLog,
  knownMatchIds,
  listAccounts,
  markSynced,
  matchIdsMissingTimeline,
  saveMatch,
  saveTimeline,
  startSyncLog,
  upsertAccount,
} from './store/matches.ts';

/** Backfill and incremental pull. Idempotent: a match already cached is never re-fetched. */

export type ResolvedAccount = AccountRecord & {
  ranked: {
    queue: string;
    tier: string;
    division: string;
    lp: number;
    wins: number;
    losses: number;
  }[];
};

export async function resolveAccount(
  client: RiotClient,
  db: Db,
  gameName: string,
  tagLine: string,
  label?: string,
): Promise<ResolvedAccount> {
  const account = await client.getAccountByRiotId(gameName, tagLine);
  let level: number | null = null;
  try {
    const summoner = await client.getSummonerByPuuid(account.puuid);
    level = summoner.summonerLevel ?? null;
  } catch {
    // summoner-v4 is a nicety here; a missing level must not fail the whole resolve.
  }

  upsertAccount(db, {
    puuid: account.puuid,
    gameName: account.gameName ?? gameName,
    tagLine: account.tagLine ?? tagLine,
    platform: client.platform as Platform,
    summonerLevel: level,
    ...(label !== undefined ? { label } : {}),
  });

  let ranked: ResolvedAccount['ranked'] = [];
  try {
    const entries = await client.getLeagueEntriesByPuuid(account.puuid);
    ranked = entries.map((e) => ({
      queue:
        e.queueType === 'RANKED_SOLO_5x5'
          ? 'soloq'
          : e.queueType === 'RANKED_FLEX_SR'
            ? 'flex'
            : e.queueType,
      tier: e.tier ?? 'UNRANKED',
      division: e.rank ?? '',
      lp: e.leaguePoints ?? 0,
      wins: e.wins ?? 0,
      losses: e.losses ?? 0,
    }));
  } catch {
    // Unranked accounts return an empty list, but a transient failure looks the same;
    // the tool output says "sin datos de ranked" rather than claiming he is unranked.
  }

  const stored = listAccounts(db).find((a) => a.puuid === account.puuid);
  return {
    puuid: account.puuid,
    gameName: account.gameName ?? gameName,
    tagLine: account.tagLine ?? tagLine,
    platform: client.platform,
    summonerLevel: level,
    label: stored?.label ?? label ?? null,
    lastSyncedAt: stored?.lastSyncedAt ?? null,
    ranked,
  };
}

export type SyncOptions = {
  puuid: string;
  queueId?: number;
  /** Epoch seconds. Riot's `startTime` is in SECONDS, not milliseconds. */
  startTime?: number;
  /** Hard cap on matches fetched this run, so a first backfill cannot run away. */
  max?: number;
  withTimeline?: boolean;
  onProgress?: (done: number, total: number) => void;
};

export type SyncResult = {
  idsSeen: number;
  fetched: number;
  skipped: number;
  timelines: number;
  remakes: number;
  errors: string[];
  elapsedMs: number;
};

export type BackfillOptions = {
  puuid?: string;
  queueId?: number;
  /** Hard cap on timelines fetched this run. */
  max?: number;
  onProgress?: (done: number, total: number) => void;
};

export type BackfillResult = {
  candidates: number;
  fetched: number;
  errors: string[];
  elapsedMs: number;
};

/**
 * Fetches the timelines of matches ALREADY in the cache.
 *
 * Deliberately separate from `syncMatches`: that one walks Riot's match-id list and only
 * ever touches matches it is downloading, so it cannot repair a cache filled before
 * timelines mattered. This walks the cache instead. Idempotent — a match that gains a
 * timeline drops out of the candidate list on the next run, so it is safe to re-run after a
 * rate-limit stall or an expired key.
 */
export async function backfillTimelines(
  client: RiotClient,
  db: Db,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const started = Date.now();
  const ids = matchIdsMissingTimeline(db, {
    ...(options.puuid !== undefined ? { puuid: options.puuid } : {}),
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    ...(options.max !== undefined ? { limit: options.max } : {}),
  });
  const result: BackfillResult = { candidates: ids.length, fetched: 0, errors: [], elapsedMs: 0 };

  for (const [index, matchId] of ids.entries()) {
    try {
      const timeline = await client.getTimeline(matchId);
      saveTimeline(db, matchId, timeline);
      result.fetched += 1;
    } catch (error) {
      result.errors.push(`${matchId}: ${error instanceof Error ? error.message : String(error)}`);
      // Same bail-out as syncMatches: one bad match is noise, but five with nothing fetched
      // is a dead key or a dead endpoint, and burning the rate limit on it helps nobody.
      if (result.errors.length >= 5 && result.fetched === 0) break;
    }
    options.onProgress?.(index + 1, ids.length);
  }

  result.elapsedMs = Date.now() - started;
  return result;
}

export async function syncMatches(
  client: RiotClient,
  db: Db,
  options: SyncOptions,
): Promise<SyncResult> {
  const started = Date.now();
  const max = options.max ?? 200;
  const logId = startSyncLog(db, options.puuid, options.queueId ?? null);
  const result: SyncResult = {
    idsSeen: 0,
    fetched: 0,
    skipped: 0,
    timelines: 0,
    remakes: 0,
    errors: [],
    elapsedMs: 0,
  };

  try {
    // 1. Page through match ids (100 per request, Riot's cap) until we have enough.
    const ids: string[] = [];
    for (let start = 0; ids.length < max; start += 100) {
      const page = await client.getMatchIds(options.puuid, {
        count: Math.min(100, max - ids.length),
        start,
        ...(options.queueId !== undefined ? { queue: options.queueId } : {}),
        ...(options.startTime !== undefined ? { startTime: options.startTime } : {}),
      });
      if (page.length === 0) break;
      ids.push(...page);
      if (page.length < 100) break;
    }
    result.idsSeen = ids.length;

    // 2. Skip what the cache already has. Matches are immutable, so this is always safe.
    const known = knownMatchIds(db, ids);
    const missing = ids.filter((id) => !known.has(id));
    result.skipped = ids.length - missing.length;

    // 3. Fetch the rest. The limiter paces this; at 100 req/2min it is ~50 matches a minute.
    for (const [index, matchId] of missing.entries()) {
      try {
        const match = await client.getMatch(matchId);
        const flat = flattenMatch(match);
        saveMatch(db, flat, match);
        result.fetched += 1;
        if (flat.isRemake) result.remakes += 1;

        if (options.withTimeline === true && !flat.isRemake) {
          const timeline = await client.getTimeline(matchId);
          saveTimeline(db, matchId, timeline);
          result.timelines += 1;
        }
      } catch (error) {
        result.errors.push(`${matchId}: ${error instanceof Error ? error.message : String(error)}`);
        // A single bad match must not abort a 200-match backfill, but a broken key would
        // fail every one of them, so bail out once it is clearly not a one-off.
        if (result.errors.length >= 5 && result.fetched === 0) break;
      }
      options.onProgress?.(index + 1, missing.length);
    }

    markSynced(db, options.puuid);
    finishSyncLog(db, logId, result, result.errors.length > 0 ? result.errors.join(' | ') : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    finishSyncLog(db, logId, result, message);
    throw error;
  }

  result.elapsedMs = Date.now() - started;
  return result;
}
