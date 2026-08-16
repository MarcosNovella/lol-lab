import { describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import type { RiotClient } from '../src/riot/client.ts';
import type { TimelineDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { matchIdsMissingTimeline, saveMatch, saveTimeline } from '../src/store/matches.ts';
import { backfillTimelines } from '../src/sync.ts';
import { match, participant } from './fixtures.ts';

/**
 * The gap these cover: `syncMatches` fetches a timeline only inside its loop over matches it
 * is downloading for the first time, so a cache filled without `withTimeline` can never gain
 * one — passing the flag on a later sync is a no-op for every match already stored. The 71
 * matches in the real cache were in exactly that state.
 */

function timeline(matchId: string): TimelineDto {
  return {
    metadata: { matchId, participants: ['me', 'enemy-mid'] },
    info: { frameInterval: 60_000, frames: [] },
  };
}

function seed(
  db: Db,
  options: { matchId: string; durationSeconds?: number; queueId?: number; puuid?: string },
): void {
  const puuid = options.puuid ?? 'me';
  const raw = match({
    matchId: options.matchId,
    ...(options.durationSeconds !== undefined ? { durationSeconds: options.durationSeconds } : {}),
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    participants: [
      participant({ puuid, teamId: 100, teamPosition: 'MIDDLE' }),
      participant({ puuid: `${options.matchId}-enemy`, teamId: 200, teamPosition: 'MIDDLE' }),
    ],
  });
  saveMatch(db, flattenMatch(raw), raw);
}

/** Only `getTimeline` is reached, so the rest of the surface stays unbuilt on purpose. */
function stubClient(impl: (matchId: string) => Promise<TimelineDto>): RiotClient {
  return { getTimeline: impl } as unknown as RiotClient;
}

describe('matchIdsMissingTimeline', () => {
  it('returns cached matches that have no timeline, and drops them once they do', () => {
    const db = openDb(':memory:');
    seed(db, { matchId: 'LA2_A' });
    seed(db, { matchId: 'LA2_B' });

    expect(matchIdsMissingTimeline(db).sort()).toEqual(['LA2_A', 'LA2_B']);

    saveTimeline(db, 'LA2_A', timeline('LA2_A'));
    expect(matchIdsMissingTimeline(db)).toEqual(['LA2_B']);
  });

  it('excludes remakes — a four-minute game has nothing to derive', () => {
    const db = openDb(':memory:');
    seed(db, { matchId: 'LA2_REAL', durationSeconds: 1800 });
    seed(db, { matchId: 'LA2_REMAKE', durationSeconds: 200 });

    expect(matchIdsMissingTimeline(db)).toEqual(['LA2_REAL']);
  });

  it('filters by account and by queue', () => {
    const db = openDb(':memory:');
    seed(db, { matchId: 'LA2_SOLO', puuid: 'me', queueId: 420 });
    seed(db, { matchId: 'LA2_FLEX', puuid: 'me', queueId: 440 });
    seed(db, { matchId: 'LA2_OTHER', puuid: 'somebody-else', queueId: 420 });

    expect(matchIdsMissingTimeline(db, { puuid: 'me' }).sort()).toEqual(['LA2_FLEX', 'LA2_SOLO']);
    expect(matchIdsMissingTimeline(db, { queueId: 420 }).sort()).toEqual(['LA2_OTHER', 'LA2_SOLO']);
    expect(matchIdsMissingTimeline(db, { puuid: 'me', queueId: 420 })).toEqual(['LA2_SOLO']);
  });

  it('honours the limit, newest first', () => {
    const db = openDb(':memory:');
    seed(db, { matchId: 'LA2_OLD' });
    seed(db, { matchId: 'LA2_NEW' });
    // Same fixture creation time by default; make the ordering unambiguous.
    db.prepare('UPDATE matches SET game_creation = ? WHERE match_id = ?').run(1, 'LA2_OLD');
    db.prepare('UPDATE matches SET game_creation = ? WHERE match_id = ?').run(2, 'LA2_NEW');

    expect(matchIdsMissingTimeline(db, { limit: 1 })).toEqual(['LA2_NEW']);
  });
});

describe('backfillTimelines', () => {
  it('fetches only what is missing and is idempotent on a second run', async () => {
    const db = openDb(':memory:');
    seed(db, { matchId: 'LA2_A' });
    seed(db, { matchId: 'LA2_B' });
    saveTimeline(db, 'LA2_A', timeline('LA2_A'));

    const asked: string[] = [];
    const client = stubClient(async (matchId) => {
      asked.push(matchId);
      return timeline(matchId);
    });

    const first = await backfillTimelines(client, db);
    expect(asked).toEqual(['LA2_B']);
    expect(first).toMatchObject({ candidates: 1, fetched: 1, errors: [] });

    const second = await backfillTimelines(client, db);
    expect(asked).toEqual(['LA2_B']);
    expect(second).toMatchObject({ candidates: 0, fetched: 0 });
  });

  it('keeps going after a single failure, so one bad match cannot abort a backfill', async () => {
    const db = openDb(':memory:');
    for (const id of ['LA2_A', 'LA2_B', 'LA2_C']) seed(db, { matchId: id });

    const client = stubClient(async (matchId) => {
      if (matchId === 'LA2_B') throw new Error('boom');
      return timeline(matchId);
    });

    const result = await backfillTimelines(client, db);
    expect(result.fetched).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('LA2_B');
    expect(matchIdsMissingTimeline(db)).toEqual(['LA2_B']);
  });

  it('bails out after five failures with nothing fetched — that is a dead key, not noise', async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 20; i += 1) seed(db, { matchId: `LA2_${i}` });

    let calls = 0;
    const client = stubClient(async () => {
      calls += 1;
      throw new Error('401 Unauthorized');
    });

    const result = await backfillTimelines(client, db);
    expect(calls).toBe(5);
    expect(result.fetched).toBe(0);
    expect(result.candidates).toBe(20);
  });
});
