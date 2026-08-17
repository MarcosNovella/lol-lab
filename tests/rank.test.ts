import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeRank,
  latestSnapshot,
  type RankSnapshot,
  rankAt,
  recordSnapshot,
  snapshotHistory,
  snapshotsFromEntries,
} from '../src/analysis/rank.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { upsertAccount } from '../src/store/matches.ts';

const snap = (over: Partial<RankSnapshot> = {}): RankSnapshot => ({
  puuid: 'p-smurf',
  observedAt: 1000,
  queueType: 'RANKED_SOLO_5x5',
  tier: 'PLATINUM',
  division: 'II',
  leaguePoints: 45,
  wins: 20,
  losses: 18,
  ...over,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertAccount(db, {
    puuid: 'p-smurf',
    gameName: 'LegendofTorcuato',
    tagLine: 'LAS',
    platform: 'la2',
    label: 'smurf',
  });
});

describe('reading league-v4 entries', () => {
  it('keeps only the two ranked Summoners Rift queues', () => {
    const rows = snapshotsFromEntries(
      'p-smurf',
      [
        { queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'II', leaguePoints: 45 },
        { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: 12 },
        { queueType: 'RANKED_TFT_DOUBLE_UP', tier: 'DIAMOND' },
      ],
      1000,
    );
    expect(rows.map((r) => r.queueType)).toEqual(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']);
  });

  it('records an unplaced account as null tier, never as a fake bottom rank', () => {
    const rows = snapshotsFromEntries('p-main', [{ queueType: 'RANKED_SOLO_5x5' }], 1000);
    expect(rows[0]?.tier).toBeNull();
    expect(describeRank(rows[0] ?? null)).toBe('sin rango');
  });
});

describe('recording', () => {
  it('writes a row when something changed', () => {
    expect(recordSnapshot(db, snap())).toBe(true);
    expect(recordSnapshot(db, snap({ observedAt: 2000, leaguePoints: 68 }))).toBe(true);
    expect(snapshotHistory(db, 'p-smurf', 'RANKED_SOLO_5x5')).toHaveLength(2);
  });

  it('skips a snapshot identical to the last, so syncing twice is not activity', () => {
    expect(recordSnapshot(db, snap())).toBe(true);
    expect(recordSnapshot(db, snap({ observedAt: 2000 }))).toBe(false);
    expect(snapshotHistory(db, 'p-smurf', 'RANKED_SOLO_5x5')).toHaveLength(1);
  });

  it('keeps the two queues on separate series', () => {
    recordSnapshot(db, snap());
    recordSnapshot(db, snap({ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', leaguePoints: 12 }));
    expect(latestSnapshot(db, 'p-smurf', 'RANKED_SOLO_5x5')?.tier).toBe('PLATINUM');
    expect(latestSnapshot(db, 'p-smurf', 'RANKED_FLEX_SR')?.tier).toBe('GOLD');
  });
});

describe('attributing a rank to a past game', () => {
  const history = [
    snap({ observedAt: 1000, leaguePoints: 10 }),
    snap({ observedAt: 3000, leaguePoints: 50 }),
  ];

  it('uses the most recent observation at or before the game', () => {
    expect(rankAt(history, 2000)?.leaguePoints).toBe(10);
    expect(rankAt(history, 3000)?.leaguePoints).toBe(50);
    expect(rankAt(history, 9000)?.leaguePoints).toBe(50);
  });

  it('returns null for a game older than the first snapshot, never the nearest one', () => {
    // Reaching forward would annotate 39 already-played games with a division recorded after
    // them, which is what happened later, not evidence about the game.
    expect(rankAt(history, 500)).toBeNull();
  });

  it('formats a rank the way it is spoken', () => {
    expect(describeRank(snap())).toBe('PLATINUM II 45 LP');
    expect(describeRank(null)).toBe('sin rango');
  });
});
