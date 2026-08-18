import type { Db } from '../store/db.ts';
import { getRawMatch, getRawTimeline, queryParticipants } from '../store/matches.ts';
import type { Role } from './metrics.ts';
import {
  bucketOf,
  EVEN_GOLD_BAND,
  laneStateAt,
  SENSITIVITY_BANDS,
  STATE_MINUTE,
  type StateBucket,
} from './state.ts';

/**
 * "Given the game state at minute 14, what do I do from there?"
 *
 * The metric that replaces the season-mean benchmark as the headline (G-008). Freezing the
 * game at a minute where the result is still open is what makes a comparison mean anything:
 * his own CS@10 is identical in wins and losses, so nothing measured over a whole game can
 * tell him what to change.
 *
 * The peer comparison keeps ADR-002's shape — his own lane opponents, already MMR-matched by
 * Riot — but applies it to a STATE rather than to a season average. Note it is not paired:
 * his conversion from ahead is measured over the games where HE was ahead, the opponents'
 * over the games where THEY were, and those are different games with different n.
 */

export type StateRow = {
  matchId: string;
  gameCreation: number;
  win: boolean;
  champion: string;
  opponentChampion: string;
  /** Positive = he is ahead. Versus his direct lane opponent. */
  goldDiff: number;
  xpDiff: number;
  csDiff: number;
  teamGoldDiff: number;
  /** Team gold difference net of his own lane pair. See `LaneState.restOfTeamGoldDiff`. */
  restOfTeamGoldDiff: number;
};

export type CollectOptions = {
  puuid: string;
  role?: Role;
  queueId?: number;
  since?: number;
  /** Exclusive upper bound on `gameCreation`. Lets the baseline and the out-of-sample window
   *  be measured by the SAME function, which is the only way the two numbers are comparable. */
  until?: number;
  minute?: number;
};

export type CollectResult = {
  rows: StateRow[];
  /** Games dropped because no state could be read, split by cause — never silently. */
  skipped: { noTimeline: number; endedBeforeMinute: number };
};

export function collectStates(db: Db, options: CollectOptions): CollectResult {
  const minute = options.minute ?? STATE_MINUTE;
  const all = queryParticipants(db, {
    puuid: options.puuid,
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
  });
  // `until` is exclusive, unlike the store's inclusive `until`, so that [a, b) and [b, ∞)
  // partition the timeline with no game landing on both sides.
  const until = options.until;
  const mine = until === undefined ? all : all.filter((r) => r.gameCreation < until);

  const rows: StateRow[] = [];
  const skipped = { noTimeline: 0, endedBeforeMinute: 0 };

  for (const row of mine) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    if (!match || !timeline) {
      skipped.noTimeline += 1;
      continue;
    }
    const state = laneStateAt(match, timeline, options.puuid, minute);
    if (!state) {
      skipped.endedBeforeMinute += 1;
      continue;
    }
    rows.push({
      matchId: row.matchId,
      gameCreation: row.gameCreation,
      win: row.win === 1,
      champion: row.champion,
      opponentChampion: state.opponentChampion,
      goldDiff: state.goldDiff,
      xpDiff: state.xpDiff,
      csDiff: state.csDiff,
      teamGoldDiff: state.teamGoldDiff,
      restOfTeamGoldDiff: state.restOfTeamGoldDiff,
    });
  }

  return { rows, skipped };
}

export type BucketOutcome = {
  bucket: StateBucket;
  games: number;
  wins: number;
  /** NaN when the bucket is empty — never 0, which would read as "he always loses". */
  rate: number;
};

export type ConversionAtBand = {
  band: number;
  buckets: BucketOutcome[];
  /**
   * What his lane opponents did from the SAME state, over the games where they held it.
   *
   * Derived, not measured separately: in a game where he is behind, the opponent is ahead by
   * construction, and the opponent wins exactly when he loses. The even bucket is deliberately
   * absent — there the two rates are complements of each other, so comparing them says
   * nothing at all.
   */
  opponentFromAhead: BucketOutcome;
  opponentFromBehind: BucketOutcome;
};

function outcome(bucket: StateBucket, games: number, wins: number): BucketOutcome {
  return { bucket, games, wins, rate: games > 0 ? wins / games : Number.NaN };
}

export function conversionAtBand(rows: StateRow[], band: number): ConversionAtBand {
  const of = (bucket: StateBucket): StateRow[] =>
    rows.filter((r) => bucketOf(r.goldDiff, band) === bucket);

  const ahead = of('arriba');
  const even = of('pareja');
  const behind = of('atrás');
  const wins = (set: StateRow[]): number => set.filter((r) => r.win).length;

  return {
    band,
    buckets: [
      outcome('atrás', behind.length, wins(behind)),
      outcome('pareja', even.length, wins(even)),
      outcome('arriba', ahead.length, wins(ahead)),
    ],
    // He was behind => the opponent was ahead, and they won the games he lost.
    opponentFromAhead: outcome('arriba', behind.length, behind.length - wins(behind)),
    opponentFromBehind: outcome('atrás', ahead.length, ahead.length - wins(ahead)),
  };
}

/**
 * The same conversion at several bands.
 *
 * Mandatory rather than optional: `EVEN_GOLD_BAND` is a judgement call over a smooth
 * distribution with no natural cut, so a finding that only holds at one band is an artefact
 * of the cut. Reports must show the sweep, not just the headline band.
 */
export function conversionByBand(
  rows: StateRow[],
  bands: readonly number[] = SENSITIVITY_BANDS,
): ConversionAtBand[] {
  return bands.map((band) => conversionAtBand(rows, band));
}

/**
 * True when every band in the sweep agrees on a NON-ZERO sign of (his conversion − theirs).
 *
 * Named for the one knob it actually turns. It used to be called `conversionIsRobust`, which
 * overclaimed twice over (G-011, G-012):
 *
 * - The band is not the only arbitrary parameter, and it is the weak one. Sweeping 300→1000
 *   moves the sample from 22 games to 15; sweeping the MINUTE genuinely re-shuffles which
 *   games land in which bucket. The minute-14 finding passed this check and then failed a
 *   minute sweep, flipping sign at 12 and 16, its two immediate neighbours. Passing here means
 *   "the gold cut did not manufacture this" and nothing more.
 * - It returned true for a gap of exactly zero, because `Math.sign(0)` is 0 and a one-element
 *   set passes an agreement test. Agreement on nothing is not evidence, so zero is now
 *   rejected explicitly.
 */
export function conversionSurvivesBandSweep(sweep: ConversionAtBand[]): boolean {
  if (sweep.length === 0) return false;
  const signs = sweep
    .map((s) => {
      const mine = s.buckets.find((b) => b.bucket === 'arriba');
      if (!mine || !Number.isFinite(mine.rate) || !Number.isFinite(s.opponentFromAhead.rate)) {
        return null;
      }
      return Math.sign(mine.rate - s.opponentFromAhead.rate);
    })
    .filter((s): s is number => s !== null);
  if (signs.length !== sweep.length) return false;
  if (new Set(signs).size !== 1) return false;
  return signs[0] !== 0;
}

export const DEFAULT_BAND = EVEN_GOLD_BAND;
