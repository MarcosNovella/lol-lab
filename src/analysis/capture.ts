import type { Db } from '../store/db.ts';

/**
 * The REPORTED layer — the ~30 seconds a session that ADR-007 bought, and the only input to this
 * project that Riot cannot supply.
 *
 * Why it exists: every defeat weighs the same in the cache. "I threw a 6k lead" and "my jungler
 * went 0/9 while I was even" are the same row, so any rate computed over defeats mixes two
 * populations that want opposite advice. One tap per game separates them.
 *
 * Why it is fenced off from everything else: the tag is REPORTED, not measured. Three properties
 * follow, and each one is enforced below rather than remembered:
 *
 * 1. **It has no opponent counterpart.** ADR-002's entire trick is that every match ships nine
 *    other players Riot already MMR-matched, so a peer baseline is free. None of them tagged
 *    anything. A tag-conditioned rate compared against "his peers" compares against nothing at
 *    all, so `splitByTag` returns populations and there is deliberately no peer function beside
 *    it — the same shape as `matchups.ts`, where no `winsAcrossAccounts` exists because `pool`
 *    refuses to build one.
 * 2. **It is self-assessment, and self-assessment correlates with the result.** Losing puts you
 *    in a bad mood, and a bad mood re-reads the game. The tag is therefore a way to SPLIT
 *    populations of defeat, never a cause of them. Any analysis that regresses the result on the
 *    tag is wrong by construction, and no amount of n fixes it.
 * 3. **It decays.** A tag typed twenty minutes after the game is observation; one typed on
 *    Thursday about Monday is memory. `tagged_at` is stored always and `splitByTag` reports the
 *    lag, so a reader can never silently treat the two as the same measurement.
 */

/**
 * Whose result was this?
 *
 * Deliberately phrased so it reads the same after a win and after a defeat — `mía` is "I produced
 * this result", not "I lost this". A defeat-only questionnaire is one that quietly stops being
 * filled in during a good week, and then the missing rows are not missing at random.
 */
export type Tag = 'mía' | 'igual' | 'pareja';

export const TAGS: readonly Tag[] = ['mía', 'igual', 'pareja'] as const;

/** The single keystroke each tag is bound to in the ritual. */
export const TAG_KEYS: Record<string, Tag> = { y: 'mía', i: 'igual', p: 'pareja' };

export class CaptureError extends Error {}

// --------------------------------------------------------------------------- provenance

/**
 * Where a field came from. `derived` is anything Riot returned or anything computed from it;
 * `reported` is anything a human typed.
 *
 * The distinction is not bookkeeping. Every guardrail this project has about contamination,
 * peer pools and elo assumes the number was produced by the game; a reported field breaks all
 * of them at once, because its distribution is a property of the reporter.
 */
export type Provenance = 'derived' | 'reported';

/**
 * One tagged game, joined to the facts about it that ARE measured.
 *
 * `TAG_PROVENANCE` below classifies every field, and the mapped type is the enforcement: adding
 * a field here fails `tsc` until it is classified, so a reported quantity cannot enter the row
 * unlabelled the way `vision_per_min` once entered the metric catalogue unlabelled (G-007).
 */
export type TaggedRow = {
  matchId: string;
  puuid: string;
  tag: Tag;
  taggedAt: number;
  /** When the game ENDED — creation plus duration. The lag is measured against this, not against
   *  the start, because a 40-minute game tagged at its own end time would read as 40 minutes of
   *  decay that never happened. */
  endedAt: number;
  win: boolean;
  champion: string;
};

export const TAG_PROVENANCE: Record<keyof TaggedRow, Provenance> = {
  matchId: 'derived',
  puuid: 'derived',
  tag: 'reported',
  taggedAt: 'reported',
  endedAt: 'derived',
  win: 'derived',
  champion: 'derived',
};

/**
 * Refuses to hand a reported field to anything that compares him against other players.
 *
 * This is the `pool()` of this module: the refusal is structural, not a convention at the call
 * site. There is no opponent tag, so a peer comparison over `tag` has an empty other side and
 * will happily return a number anyway.
 */
export function peerComparable<K extends keyof TaggedRow>(field: K): K {
  if (TAG_PROVENANCE[field] === 'reported') {
    throw new CaptureError(
      `'${field}' is reported, not measured, so it has no counterpart among the nine other ` +
        'players in the match. There is no peer baseline for it and there cannot be one — ' +
        'split populations by it instead of benchmarking against it.',
    );
  }
  return field;
}

// --------------------------------------------------------------------------- writing

/** Opens a sitting. Returns its id, which every tag typed during it carries. */
export function openSession(db: Db, puuid: string, now: number = Date.now()): number {
  const row = db
    .prepare('INSERT INTO play_sessions (puuid, opened_at) VALUES (?, ?) RETURNING id')
    .get(puuid, now) as { id: number } | undefined;
  if (row === undefined) throw new CaptureError(`could not open a session for ${puuid}`);
  return Number(row.id);
}

/**
 * Closes a sitting, with the tilt if it was given.
 *
 * `tilt` is `number | null` and never optional: a caller that forgot to ask and a session where
 * he declined to answer must produce the same stored value, and it must be NULL rather than a
 * middling 3 (G-005 — a missing measurement reported as a plausible number is the worst case).
 */
export function closeSession(
  db: Db,
  sessionId: number,
  tilt: number | null,
  now: number = Date.now(),
): void {
  if (tilt !== null && (!Number.isInteger(tilt) || tilt < 1 || tilt > 5)) {
    throw new CaptureError(`tilt must be an integer 1-5 or null, got ${tilt}`);
  }
  const changed = db
    .prepare('UPDATE play_sessions SET closed_at = ?, tilt = ? WHERE id = ?')
    .run(now, tilt, sessionId);
  if (Number(changed.changes) === 0) throw new CaptureError(`no session ${sessionId}`);
}

/**
 * Records one tag, replacing any earlier tag for the same game and account.
 *
 * Retagging overwrites on purpose — unlike the hypothesis ledger, which is append-only because
 * its whole value is that a prediction cannot be edited after the fact. A tag is a description of
 * something he watched; correcting it is the system working. `tagged_at` moves with the
 * correction, so the lag stays honest.
 */
export function tagGame(
  db: Db,
  input: { matchId: string; puuid: string; tag: Tag; sessionId?: number | null },
  now: number = Date.now(),
): void {
  if (!TAGS.includes(input.tag)) throw new CaptureError(`unknown tag '${input.tag}'`);

  // He can only speak for games he was in. Without this a typo in the account label silently
  // files the smurf's opinion under the main, which is the exact leak ADR-011 closed on the
  // vault side.
  const played = db
    .prepare('SELECT 1 FROM participants WHERE match_id = ? AND puuid = ?')
    .get(input.matchId, input.puuid);
  if (played === undefined) {
    throw new CaptureError(
      `${input.puuid} did not play ${input.matchId} (or the match is not cached), so there is ` +
        'nothing for this account to attribute',
    );
  }

  db.prepare(
    `INSERT INTO game_tags (match_id, puuid, session_id, tag, tagged_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (match_id, puuid) DO UPDATE SET
       session_id = excluded.session_id,
       tag        = excluded.tag,
       tagged_at  = excluded.tagged_at`,
  ).run(input.matchId, input.puuid, input.sessionId ?? null, input.tag, now);
}

// --------------------------------------------------------------------------- reading

/** The games this account has played that carry no tag yet, newest first. */
export function untaggedGames(
  db: Db,
  puuid: string,
  options: { since?: number; limit?: number } = {},
): { matchId: string; endedAt: number; win: boolean; champion: string }[] {
  const since = options.since ?? 0;
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT p.match_id, p.win, p.champion,
              m.game_creation + m.game_duration * 1000 AS ended_at
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id
        WHERE p.puuid = ?
          AND m.game_creation >= ?
          AND NOT EXISTS (
                SELECT 1 FROM game_tags t
                 WHERE t.match_id = p.match_id AND t.puuid = p.puuid)
        ORDER BY m.game_creation DESC
        LIMIT ?`,
    )
    .all(puuid, since, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    matchId: String(r['match_id']),
    endedAt: Number(r['ended_at']),
    win: Number(r['win']) === 1,
    champion: String(r['champion']),
  }));
}

export function tagOf(db: Db, matchId: string, puuid: string): Tag | null {
  const row = db
    .prepare('SELECT tag FROM game_tags WHERE match_id = ? AND puuid = ?')
    .get(matchId, puuid) as { tag: string } | undefined;
  return row === undefined ? null : (String(row.tag) as Tag);
}

export function taggedRows(db: Db, puuid: string, options: { since?: number } = {}): TaggedRow[] {
  const rows = db
    .prepare(
      `SELECT t.match_id, t.puuid, t.tag, t.tagged_at, p.win, p.champion,
              m.game_creation + m.game_duration * 1000 AS ended_at
         FROM game_tags t
         JOIN participants p ON p.match_id = t.match_id AND p.puuid = t.puuid
         JOIN matches m      ON m.match_id = t.match_id
        WHERE t.puuid = ? AND m.game_creation >= ?
        ORDER BY m.game_creation DESC`,
    )
    .all(puuid, options.since ?? 0) as Record<string, unknown>[];
  return rows.map((r) => ({
    matchId: String(r['match_id']),
    puuid: String(r['puuid']),
    tag: String(r['tag']) as Tag,
    taggedAt: Number(r['tagged_at']),
    endedAt: Number(r['ended_at']),
    win: Number(r['win']) === 1,
    champion: String(r['champion']),
  }));
}

// --------------------------------------------------------------------------- the split

export type Population = {
  tag: Tag;
  n: number;
  wins: number;
  /**
   * Median and worst delay between the game ending and the tag being typed, in ms.
   *
   * Reported as measurements rather than classified into "fresh" and "stale". A threshold here
   * would be an arbitrary cut with no outcome to sweep it against, which is exactly the knob
   * G-011 exists to catch — and unlike the gold band, there is no sweep that could rescue it.
   * `NaN` when the population is empty, never 0 (G-005).
   */
  medianLagMs: number;
  maxLagMs: number;
};

/**
 * The legitimate operation on a tag: separating populations of games.
 *
 * `untagged` is returned beside them and is never folded in. Dropping untagged games silently
 * would make every rate here conditional on "games he bothered to tag", and whether he bothers
 * is not independent of how the game went.
 */
export type TagSplit = {
  populations: Population[];
  tagged: number;
  untagged: number;
};

export function splitByTag(rows: TaggedRow[], untagged: number): TagSplit {
  const populations = TAGS.map((tag) => {
    const mine = rows.filter((r) => r.tag === tag);
    const lags = mine.map((r) => r.taggedAt - r.endedAt).sort((a, b) => a - b);
    return {
      tag,
      n: mine.length,
      wins: mine.filter((r) => r.win).length,
      medianLagMs: median(lags),
      maxLagMs: lags.at(-1) ?? Number.NaN,
    } satisfies Population;
  });
  return { populations, tagged: rows.length, untagged };
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? Number.NaN) + upper) / 2;
}
