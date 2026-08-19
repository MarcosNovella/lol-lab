import type { Db } from '../store/db.ts';
import { getRawMatch, queryParticipants } from '../store/matches.ts';
import { flattenMatch } from './flatten.ts';
import { METRICS_BY_KEY, type Metric, type Role } from './metrics.ts';

/**
 * Growth, one account at a time.
 *
 * The merged cross-account curve was withdrawn (roadmap §5b): the smurf is Platinum 2 and the
 * main starts from nothing, so a curve crossing the boundary measures the boundary. This one
 * cannot span accounts by construction — it takes a single puuid and queries for it, so there
 * is no argument that could make it merge.
 *
 * THE HARD PART IS THE CONFOUND, AND IT IS NOT SOLVED, IT IS DRAWN.
 *
 * No growth metric is elo-invariant. Absolute numbers rise against weaker opponents with no
 * improvement at all, and the peer-relative gap has the same flaw plus an inverse one: as he
 * climbs, opponents get better and the gap SHRINKS while he is genuinely improving. Real
 * progress and MMR movement arrive mixed and cannot be separated from this data.
 *
 * §5b's mitigation was "draw rank/MMR underneath so a jump can be attributed". Measured
 * 2026-08-16: match-v5 carries NO rank, tier, LP or MMR field — 156 participant keys, none of
 * them rank — so that underlay is not derivable retroactively at all. league-v4 gives the
 * account's CURRENT standing only, which starts a series today and says nothing about the past.
 *
 * So the underlay here is the lane opponent's ABSOLUTE value of the same metric, game by game.
 * It is not rank, and it is measured rather than looked up: if his opponents' CS@10 climbs, the
 * lobbies got harder, which is precisely the confound §5b was worried about, made visible from
 * data that already exists. Arguably it is the better underlay, because it tracks the thing
 * that actually contaminates the comparison rather than a label correlated with it.
 */

export type GrowthPoint = {
  /** 1-based position within this account's history, so the x-axis is games, not dates. */
  index: number;
  matchId: string;
  gameCreation: number;
  champion: string;
  win: boolean;
  mine: number;
  /** The lane opponent's value of the SAME metric — the lobby-strength underlay. */
  theirs: number;
  mineRolling: number;
  theirsRolling: number;
};

export type GrowthCurve = {
  account: string;
  metricKey: string;
  metricLabel: string;
  window: number;
  points: GrowthPoint[];
  /** Games dropped because the metric or the lane opponent was missing. Never silent. */
  skipped: number;
};

export class GrowthError extends Error {}

export const DEFAULT_WINDOW = 10;

function rollingMean(values: number[], end: number, window: number): number {
  const from = Math.max(0, end - window + 1);
  const slice = values.slice(from, end + 1);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export type GrowthOptions = {
  puuid: string;
  accountLabel: string;
  metricKey: string;
  role?: Role;
  queueId?: number;
  window?: number;
  /** Epoch ms floor on `gameCreation`, inclusive. */
  since?: number;
  /** Epoch ms ceiling on `gameCreation`, EXCLUSIVE — so [a, b) and [b, ∞) partition the history
   *  with no game landing on both sides, the same convention `collectStates` uses. Windowing
   *  matters here because the ledger measures a baseline and an out-of-sample stretch with the
   *  same function, and a rolling mean that quietly spanned both would carry the baseline into
   *  the test. */
  until?: number;
};

/**
 * Builds the curve for one account.
 *
 * Refuses a metric that is not `causal` (G-008). A curve over a contaminated metric would
 * measure how often he snowballed, not whether he improved — the season mean already made that
 * mistake once and reported him ahead in 17 of 18 metrics at a 52.8% win rate.
 */
export function growthCurve(db: Db, options: GrowthOptions): GrowthCurve {
  const metric: Metric | undefined = METRICS_BY_KEY.get(options.metricKey);
  if (metric === undefined) throw new GrowthError(`no metric '${options.metricKey}'`);
  if (metric.contamination !== 'causal') {
    throw new GrowthError(
      `'${metric.key}' is ${metric.contamination}, not causal. A growth curve over a metric ` +
        'that is downstream of winning measures how often he snowballed, not whether he ' +
        'improved (G-008).',
    );
  }

  const window = options.window ?? DEFAULT_WINDOW;
  const until = options.until;
  const mine = queryParticipants(db, {
    puuid: options.puuid,
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
  })
    .filter((r) => until === undefined || r.gameCreation < until)
    .sort((a, b) => a.gameCreation - b.gameCreation);

  const mineValues: number[] = [];
  const theirValues: number[] = [];
  const partial: Omit<GrowthPoint, 'mineRolling' | 'theirsRolling'>[] = [];
  let skipped = 0;

  for (const row of mine) {
    const match = getRawMatch(db, row.matchId);
    if (!match) {
      skipped += 1;
      continue;
    }
    const me = match.info.participants.find((p) => p.puuid === options.puuid);
    if (!me || me.teamPosition === '') {
      skipped += 1;
      continue;
    }
    const opponent = match.info.participants.find(
      (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
    );
    if (!opponent) {
      skipped += 1;
      continue;
    }

    // Flatten the opponent through the same path as him, so both sides of the comparison are
    // computed identically rather than one from a stored column and the other from raw JSON.
    const theirRow = flattenMatch(match).participants.find((p) => p.puuid === opponent.puuid);
    if (theirRow === undefined) {
      skipped += 1;
      continue;
    }
    const mineValue = metric.get(row);
    const theirValue = metric.get({
      ...theirRow,
      queueId: row.queueId,
      gameCreation: row.gameCreation,
      gameDuration: row.gameDuration,
      patch: row.patch,
    });
    if (mineValue === null || theirValue === null) {
      skipped += 1;
      continue;
    }

    mineValues.push(mineValue);
    theirValues.push(theirValue);
    partial.push({
      index: partial.length + 1,
      matchId: row.matchId,
      gameCreation: row.gameCreation,
      champion: row.champion,
      win: row.win === 1,
      mine: mineValue,
      theirs: theirValue,
    });
  }

  const points: GrowthPoint[] = partial.map((p, i) => ({
    ...p,
    mineRolling: rollingMean(mineValues, i, window),
    theirsRolling: rollingMean(theirValues, i, window),
  }));

  return {
    account: options.accountLabel,
    metricKey: metric.key,
    metricLabel: metric.label,
    window,
    points,
    skipped,
  };
}

/**
 * Slope of the rolling series between its first and last point, per game.
 *
 * Deliberately not a regression: at this n a fitted line invites a p-value, and the project
 * reports effect and n, never p. This is a description of the curve's endpoints and is labelled
 * as such.
 */
export function drift(points: GrowthPoint[], pick: (p: GrowthPoint) => number): number {
  if (points.length < 2) return Number.NaN;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return Number.NaN;
  return (pick(last) - pick(first)) / (last.index - first.index);
}

/**
 * Least-squares slope of the rolling series against the game index, per game.
 *
 * `drift` above reads two points and throws the rest away, which is fine for a caption under a
 * drawing and NOT fine for a number that gets frozen into the ledger. Measured on his real
 * cache 2026-08-18: the CS@10 gap drifts −0.040 per game over 36 games and −0.147 over 39 — the
 * same series plus three games, a 3.7x swing, because the last point moved. A number a single
 * game can quadruple cannot carry a dated prediction (G-025).
 *
 * The original objection to fitting a line stands and is answered rather than ignored: a
 * regression invites a p-value, and this project reports effect and n, never p. So this returns
 * the SLOPE as an effect size in the metric's own units per game, and nothing here computes a
 * standard error. The rolling means are autocorrelated by construction, which would make any
 * such error wrong anyway — one more reason there is none.
 */
export function trendSlope(points: GrowthPoint[], pick: (p: GrowthPoint) => number): number {
  if (points.length < 2) return Number.NaN;
  const xs = points.map((p) => p.index);
  const ys = points.map(pick);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (const [i, x] of xs.entries()) {
    const y = ys[i];
    if (y === undefined) return Number.NaN;
    covariance += (x - meanX) * (y - meanY);
    variance += (x - meanX) ** 2;
  }
  // Every x identical means there is no axis to fit against. Returning 0 would report "no
  // trend" for "no measurement", which is the confusion G-014 exists to prevent.
  if (variance === 0) return Number.NaN;
  return covariance / variance;
}
