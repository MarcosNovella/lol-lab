import { beforeEach, describe, expect, it } from 'vitest';
import {
  CaptureError,
  closeSession,
  openSession,
  peerComparable,
  splitByTag,
  TAG_PROVENANCE,
  type TaggedRow,
  tagGame,
  taggedRows,
  tagOf,
  untaggedGames,
} from '../src/analysis/capture.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch, upsertAccount } from '../src/store/matches.ts';
import { match, participant } from './fixtures.ts';

/**
 * What these pin: the capture layer is the only REPORTED input in the project, and every
 * property that makes reported data different from measured data is enforced here rather than
 * described in a comment.
 */

const MINUTE = 60_000;
const CREATION = 1_760_000_000_000;

function seed(db: Db, matchId: string, options: { win?: boolean; at?: number } = {}): void {
  const raw = match({
    matchId,
    gameCreation: options.at ?? CREATION,
    durationSeconds: 1800,
    participants: [
      participant({ puuid: 'me', teamId: 100, teamPosition: 'MIDDLE', win: options.win ?? true }),
      participant({
        puuid: `${matchId}-enemy`,
        teamId: 200,
        teamPosition: 'MIDDLE',
        win: !(options.win ?? true),
      }),
    ],
  });
  saveMatch(db, flattenMatch(raw), raw);
}

/** The moment a 30-minute game starting at CREATION actually ended. */
const ENDED = CREATION + 1800 * 1000;

describe('capture', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
    });
    seed(db, 'LA2_A');
  });

  it('records a tag and reads it back', () => {
    tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'mía' }, ENDED + 10 * MINUTE);
    expect(tagOf(db, 'LA2_A', 'me')).toBe('mía');
  });

  it('retagging updates in place instead of duplicating', () => {
    tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'mía' }, ENDED + MINUTE);
    tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'pareja' }, ENDED + 5 * MINUTE);

    const rows = taggedRows(db, 'me');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tag).toBe('pareja');
    // The correction carries its own timestamp: the lag must describe when he actually decided,
    // not when he first guessed.
    expect(rows[0]?.taggedAt).toBe(ENDED + 5 * MINUTE);
  });

  it('refuses a tag from an account that did not play the game', () => {
    upsertAccount(db, { puuid: 'main', gameName: 'LaMarso', tagLine: 'LAS', platform: 'la2' });
    expect(() => tagGame(db, { matchId: 'LA2_A', puuid: 'main', tag: 'mía' })).toThrow(
      CaptureError,
    );
  });

  it('refuses a tag for a match that is not cached', () => {
    expect(() => tagGame(db, { matchId: 'LA2_NOPE', puuid: 'me', tag: 'mía' })).toThrow(
      CaptureError,
    );
  });

  it('lists untagged games and stops listing them once tagged', () => {
    seed(db, 'LA2_B', { at: CREATION + 60 * MINUTE });
    expect(untaggedGames(db, 'me').map((g) => g.matchId)).toEqual(['LA2_B', 'LA2_A']);

    tagGame(db, { matchId: 'LA2_B', puuid: 'me', tag: 'igual' });
    expect(untaggedGames(db, 'me').map((g) => g.matchId)).toEqual(['LA2_A']);
  });

  it('measures the lag against the END of the game, not its start', () => {
    tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'mía' }, ENDED + 10 * MINUTE);
    const split = splitByTag(taggedRows(db, 'me'), 0);
    const mine = split.populations.find((p) => p.tag === 'mía');
    // A 30-minute game tagged 10 minutes after it finished is 10 minutes of decay, not 40.
    expect(mine?.medianLagMs).toBe(10 * MINUTE);
  });

  it('never folds untagged games into a population', () => {
    tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'mía' }, ENDED + MINUTE);
    const split = splitByTag(taggedRows(db, 'me'), 7);
    expect(split.tagged).toBe(1);
    expect(split.untagged).toBe(7);
    expect(split.populations.reduce((n, p) => n + p.n, 0)).toBe(1);
  });

  it('reports an empty population as NaN, never as zero', () => {
    const split = splitByTag([], 0);
    for (const p of split.populations) {
      expect(p.n).toBe(0);
      // G-005: a lag of 0 would read as "tagged instantly", which is the opposite of "no data".
      expect(Number.isNaN(p.medianLagMs)).toBe(true);
      expect(Number.isNaN(p.maxLagMs)).toBe(true);
    }
  });

  describe('sessions', () => {
    it('stores tilt when given and NULL when not', () => {
      const withTilt = openSession(db, 'me', 1000);
      closeSession(db, withTilt, 4, 2000);
      const without = openSession(db, 'me', 3000);
      closeSession(db, without, null, 4000);

      const rows = db.prepare('SELECT id, tilt FROM play_sessions ORDER BY id').all() as {
        id: number;
        tilt: number | null;
      }[];
      expect(rows[0]?.tilt).toBe(4);
      // Not 0, not 3: a session closed without a tilt has no tilt measurement (G-005/G-014).
      expect(rows[1]?.tilt).toBeNull();
    });

    it('rejects a tilt outside 1-5 rather than clamping it', () => {
      const id = openSession(db, 'me', 1000);
      expect(() => closeSession(db, id, 0, 2000)).toThrow(CaptureError);
      expect(() => closeSession(db, id, 6, 2000)).toThrow(CaptureError);
      expect(() => closeSession(db, id, 3.5, 2000)).toThrow(CaptureError);
    });

    it('carries the session onto every tag typed during it', () => {
      const id = openSession(db, 'me', 1000);
      tagGame(db, { matchId: 'LA2_A', puuid: 'me', tag: 'mía', sessionId: id });
      const row = db.prepare('SELECT session_id FROM game_tags WHERE match_id = ?').get('LA2_A') as
        | { session_id: number }
        | undefined;
      expect(row?.session_id).toBe(id);
    });
  });

  describe('provenance', () => {
    it('classifies every field of the row', () => {
      // The mapped type already fails `tsc` on an unclassified field; this pins the two that
      // carry the whole distinction, so a later edit cannot quietly relabel them as measured.
      expect(TAG_PROVENANCE.tag).toBe('reported');
      expect(TAG_PROVENANCE.taggedAt).toBe('reported');
      expect(TAG_PROVENANCE.win).toBe('derived');
    });

    it('refuses to hand a reported field to a peer comparison', () => {
      expect(() => peerComparable('tag')).toThrow(CaptureError);
      expect(() => peerComparable('taggedAt')).toThrow(CaptureError);
    });

    it('allows a derived field through', () => {
      const field: keyof TaggedRow = peerComparable('win');
      expect(field).toBe('win');
    });
  });
});
