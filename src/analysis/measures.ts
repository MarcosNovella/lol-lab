import type { Db } from '../store/db.ts';
import { getRawMatch, getRawTimeline, queryParticipants } from '../store/matches.ts';
import { collectStates, type StateRow } from './conversion.ts';
import { eventsOfType, participantsOf } from './events.ts';
import { growthCurve, trendSlope } from './growth.ts';
import {
  type AnalysisSpec,
  type GrowthSpec,
  LedgerError,
  type Measure,
  type Measurement,
  type PhaseSpec,
  type Spec,
  type TeamStateSpec,
  type VisionSpec,
  type Window,
} from './hypotheses.ts';
import { deathsOf } from './moments.ts';

/**
 * The one measure function the ledger runs.
 *
 * There is deliberately ONE, dispatching on the spec, rather than a measure passed alongside
 * each hypothesis. The spec is hashed and frozen (G-013); if the choice of computation lived
 * outside it, two evaluations could share a hash and still compute different numbers, and the
 * freeze would guarantee nothing. An unsupported combination throws rather than falling back:
 * a silent wrong number is the failure mode this whole layer exists to prevent.
 *
 * Every effect below is signed so that ZERO IS THE NULL. `verdictFor` reads the sign, so an
 * effect whose null is 0.5 (a win rate) must be centred here, not interpreted later.
 */

/**
 * The lane states in the window, WITH the count of games that could not produce one.
 *
 * `collectStates` has always returned `skipped`, split by cause, under a comment saying these
 * are never dropped silently. Nothing ever read it. The two causes are not the same thing and
 * only one of them is fixable: `endedBeforeMinute` is an honest absence — a game that ended at
 * 11' has no minute-14 state and never will — while `noTimeline` is a hole in the cache that
 * `riot_backfill_timelines` closes. Only the second is reported, because only the second is
 * something he can act on and the first would be noise on every short game.
 */
function rowsFor(
  db: Db,
  spec: AnalysisSpec,
  window: Window,
  minute: number,
): { rows: StateRow[]; unreadable: number } {
  const { rows, skipped } = collectStates(db, {
    puuid: spec.puuid,
    role: spec.role,
    queueId: spec.queueId,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
    minute,
  });
  return {
    rows: spec.champion === null ? rows : rows.filter((r) => r.champion === spec.champion),
    unreadable: skipped.noTimeline,
  };
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * His win rate from a lane lead minus his opponents' from the same state.
 *
 * The opponents' rate is derived, not measured: when he is behind the opponent is ahead by
 * construction and wins exactly the games he loses. Valid under symmetry, but it means there
 * is no independent measurement of the opponent in this number at all — the opponent-quality
 * confound is carried whole, and the caveat on the hypothesis says so.
 */
function conversionGapBinary(rows: StateRow[], band: number): Measurement {
  const ahead = rows.filter((r) => r.goldDiff > band);
  const behind = rows.filter((r) => r.goldDiff < -band);
  const n = ahead.length + behind.length;
  if (ahead.length === 0 || behind.length === 0) return { n, effect: Number.NaN };
  const his = ahead.filter((r) => r.win).length / ahead.length;
  const theirs = behind.filter((r) => !r.win).length / behind.length;
  return { n, effect: his - theirs };
}

/**
 * The same comparison with a continuous outcome: gold swing over the six minutes after the
 * state, his from his lead minus the opponent's from theirs (mirrored, since the differential
 * is antisymmetric).
 *
 * Registered because roadmap §4.2 argued a continuous outcome would extract more signal from
 * the same games. Measured on the baseline it does not: the standardised effect is d = −0.14,
 * so it needs MORE games than the binary version, not fewer. Registering both settles that
 * argument with data instead of reasoning.
 */
function conversionGapDeltaGold(
  db: Db,
  spec: AnalysisSpec,
  window: Window,
  band: number,
): Measurement {
  const start = rowsFor(db, spec, window, spec.minute);
  const later = new Map(
    rowsFor(db, spec, window, spec.minute + 6).rows.map((r) => [r.matchId, r] as const),
  );

  const his: number[] = [];
  const theirs: number[] = [];
  for (const row of start.rows) {
    const end = later.get(row.matchId);
    if (!end) continue; // the game ended before the window closed — never extrapolated
    const delta = end.goldDiff - row.goldDiff;
    if (row.goldDiff > band) his.push(delta);
    if (row.goldDiff < -band) theirs.push(-delta);
  }
  const n = his.length + theirs.length;
  const unreadable = start.unreadable;
  if (his.length === 0 || theirs.length === 0) return { n, effect: Number.NaN, unreadable };
  return { n, effect: mean(his) - mean(theirs), unreadable };
}

/**
 * Win rate from a neutral-or-behind lane state, centred on a coin flip.
 *
 * Centred on 0.5 because that is both the structural null and, empirically, his baseline rate
 * in the even bucket (3/6). Direction is read from the sign, so the centring has to happen
 * here — a raw rate would make `verdictFor` treat every losing champion as "consistent".
 */
function fromNeutralOrBehind(rows: StateRow[], band: number): Measurement {
  const set = rows.filter((r) => r.goldDiff <= band);
  if (set.length === 0) return { n: 0, effect: Number.NaN };
  return { n: set.length, effect: set.filter((r) => r.win).length / set.length - 0.5 };
}

/**
 * Does a ward of his in the seconds before an epic monster go with his team taking it?
 *
 * Measured over OBJECTIVES, not games, which is why this hypothesis has an n worth having: 364
 * epic monsters across 39 games rather than 20 lane states. One objective changing sides moves
 * the warded rate by about a point, against ten points per game in the conversion finding.
 *
 * `onlyUncredited` is the confound control and the reason the spec carries it. Warding near an
 * objective correlates with being near it, and being near it correlates with the team winning
 * it, so the unrestricted version measures rotation as much as vision. Restricting to
 * objectives he was NOT credited on removes the tautological part — being credited means his
 * team took it — and leaves the question that is actually interesting.
 */
function wardBeforeObjective(db: Db, spec: VisionSpec, window: Window): Measurement {
  const rows = queryParticipants(db, {
    puuid: spec.puuid,
    role: spec.role,
    queueId: spec.queueId,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
  }).filter((r) => (Number.isFinite(window.until) ? r.gameCreation < window.until : true));

  let wardedTaken = 0;
  let wardedTotal = 0;
  let bareTaken = 0;
  let bareTotal = 0;

  for (const row of rows) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    if (!match || !timeline) continue;
    const participants = participantsOf(match, timeline, spec.puuid);
    if (participants === null) continue;
    const myId = participants.idOf(spec.puuid);
    if (myId === null) continue;

    const wards = eventsOfType(timeline, 'WARD_PLACED').filter(
      (e) => e.creatorId === myId && e.wardType !== 'TEEMO_MUSHROOM',
    );

    for (const monster of eventsOfType(timeline, 'ELITE_MONSTER_KILL')) {
      const credited = [
        ...(monster.killerId !== undefined && monster.killerId > 0 ? [monster.killerId] : []),
        ...(monster.assistingParticipantIds ?? []),
      ].includes(myId);
      if (spec.onlyUncredited && credited) continue;

      const ours =
        monster.killerId !== undefined && participants.sideOf(monster.killerId) === 'ally';
      const warded = wards.some(
        (x) =>
          x.timestamp <= monster.timestamp &&
          monster.timestamp - x.timestamp <= spec.windowSeconds * 1000,
      );
      if (warded) {
        wardedTotal += 1;
        if (ours) wardedTaken += 1;
      } else {
        bareTotal += 1;
        if (ours) bareTaken += 1;
      }
    }
  }

  const n = wardedTotal + bareTotal;
  if (wardedTotal === 0 || bareTotal === 0) return { n, effect: Number.NaN };
  return { n, effect: wardedTaken / wardedTotal - bareTaken / bareTotal };
}

/**
 * Among the games he is AHEAD in lane, his win rate when the rest of his team is ahead minus
 * his win rate when the rest of his team is behind.
 *
 * The variable is `restOfTeamGoldDiff`, his own lane pair removed. `teamGoldDiff` correlates
 * with `goldDiff` at r = 0.65, so the earlier version of this comparison put part of his own
 * lane state on both sides of the question (roadmap §0/A3).
 *
 * What it still does NOT settle: the remaining gold is not exogenous either. A mid who converts
 * a lead by roaming makes his teammates richer, so "team ahead" partly measures him. This
 * measures whether the two states go with different results; it does not say which causes which,
 * and the caveat on the row has to say so.
 *
 * Centred at 0 — it is a difference of two rates, so the null is no difference, not 0.5.
 */
function teamStateGivenLane(db: Db, spec: TeamStateSpec, window: Window): Measurement {
  const { rows, skipped } = collectStates(db, {
    puuid: spec.puuid,
    role: spec.role,
    queueId: spec.queueId,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
    minute: spec.minute,
  });

  const laneAhead = rows.filter((r) => r.goldDiff > spec.band);
  const teamAhead = laneAhead.filter((r) => r.restOfTeamGoldDiff > spec.teamBand);
  const teamBehind = laneAhead.filter((r) => r.restOfTeamGoldDiff < -spec.teamBand);

  const n = teamAhead.length + teamBehind.length;
  const unreadable = skipped.noTimeline;
  if (teamAhead.length === 0 || teamBehind.length === 0) {
    return { n, effect: Number.NaN, unreadable };
  }
  return {
    n,
    effect:
      teamAhead.filter((r) => r.win).length / teamAhead.length -
      teamBehind.filter((r) => r.win).length / teamBehind.length,
    unreadable,
  };
}

/**
 * Drift of the GAP between his rolling mean and his lane opponents', per game.
 *
 * The gap rather than his own line, because his own line moves with lobby strength and says
 * nothing on its own: a curve that falls while his opponents' falls faster is improvement. That
 * is the whole argument of ADR-012, applied to a number instead of to a drawing.
 *
 * `n` is games, and the honest reading is that it needs a lot of them.
 *
 * It fits a LINE over every point (`trendSlope`) instead of subtracting the two endpoints the
 * way the growth report does. The endpoint version of this exact number moved from −0.040 to
 * −0.147 when three games were added to a 36-game series, so freezing it into a dated
 * prediction would have frozen an artefact of where the series happened to stop (G-025). The
 * report keeps `drift`, because "how much did the curve move end to end" is a description and
 * says so.
 */
function growthDrift(db: Db, spec: GrowthSpec, window: Window): Measurement {
  const curve = growthCurve(db, {
    puuid: spec.puuid,
    accountLabel: spec.puuid,
    metricKey: spec.metricKey,
    role: spec.role,
    queueId: spec.queueId,
    window: spec.rollingGames,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
  });
  // Two points cannot describe a trend, and one game certainly cannot. `trendSlope` returns
  // NaN below two, which the ledger reads as "not measurable" rather than as zero (G-014).
  const mine = trendSlope(curve.points, (p) => p.mineRolling);
  const theirs = trendSlope(curve.points, (p) => p.theirsRolling);
  return { n: curve.points.length, effect: mine - theirs };
}

/**
 * Deaths per ten minutes of a PHASE, among games that reach it from a lane lead: his win rate
 * in the low-death games minus his win rate in the high-death ones.
 *
 * The exposure denominator is the whole reason this is a different function from "count his
 * deaths between 14 and 25". Measured 2026-08-19 over 43 mid soloq games, his deaths per ten
 * minutes run 1.48 while his team is 3k up, 1.47 while even and 2.99 while 3k down — the raw
 * count of deaths in a phase is largely a count of how long the phase lasted and how badly it
 * was going, both of which are downstream of the result (G-008). Dividing by the minutes the
 * game actually reached removes the first; the lane gate limits the second; nothing removes
 * reverse causality, and the caveat on the row says so.
 *
 * Centred at 0 — a difference of two win rates, so the null is "no difference", not 0.5.
 */
function phaseDeathRate(db: Db, spec: PhaseSpec, window: Window): Measurement {
  const { rows, skipped } = collectStates(db, {
    puuid: spec.puuid,
    role: spec.role,
    queueId: spec.queueId,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
    minute: spec.gateMinute,
  });

  const low: StateRow[] = [];
  const high: StateRow[] = [];
  for (const row of rows) {
    if (row.goldDiff <= spec.band) continue;
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    if (match === null || timeline === null) continue;

    // The phase ends where the GAME ends, read from the last frame's timestamp rather than from
    // how many frames there are (G-017). A game that surrenders at 19' offers five minutes of a
    // 14-25 phase, not eleven, and pretending otherwise halves its rate.
    const lastFrame = timeline.info.frames.at(-1);
    if (lastFrame === undefined) continue;
    const to = Math.min(spec.toMinute, Math.floor(lastFrame.timestamp / 60_000));
    const minutes = to - spec.fromMinute;
    if (minutes <= 0) continue;

    const deaths = deathsOf(match, timeline, spec.puuid).filter(
      (death) => death.timestamp >= spec.fromMinute * 60_000 && death.timestamp < to * 60_000,
    ).length;
    const per10 = (10 * deaths) / minutes;
    if (per10 >= spec.deathsPer10Threshold) high.push(row);
    else low.push(row);
  }

  const n = low.length + high.length;
  const unreadable = skipped.noTimeline;
  if (low.length === 0 || high.length === 0) return { n, effect: Number.NaN, unreadable };
  return {
    n,
    effect:
      low.filter((r) => r.win).length / low.length - high.filter((r) => r.win).length / high.length,
    unreadable,
  };
}

export function standardMeasure(db: Db): Measure {
  return (spec: Spec, window: Window): Measurement => {
    // Each shape is told apart by a field only it carries. Checked before the lane-state path,
    // which is the one with the most fields and would otherwise swallow the others.
    if ('windowSeconds' in spec) return wardBeforeObjective(db, spec, window);
    if ('teamBand' in spec) return teamStateGivenLane(db, spec, window);
    if ('rollingGames' in spec) return growthDrift(db, spec, window);
    if ('deathsPer10Threshold' in spec) return phaseDeathRate(db, spec, window);
    if (spec.stratum === 'none' && spec.outcome === 'binary_win') {
      const read = rowsFor(db, spec, window, spec.minute);
      return { ...conversionGapBinary(read.rows, spec.band), unreadable: read.unreadable };
    }
    if (spec.stratum === 'none' && spec.outcome === 'delta_gold_6min') {
      return conversionGapDeltaGold(db, spec, window, spec.band);
    }
    if (spec.stratum === 'lane_even_or_behind' && spec.outcome === 'binary_win') {
      const read = rowsFor(db, spec, window, spec.minute);
      return { ...fromNeutralOrBehind(read.rows, spec.band), unreadable: read.unreadable };
    }
    throw new LedgerError(
      `no measure for stratum '${spec.stratum}' with outcome '${spec.outcome}'. ` +
        'Add one deliberately rather than falling back to a number that means something else.',
    );
  };
}

/**
 * Games in the declared hole between the frozen baseline and the out-of-sample window.
 *
 * Counted rather than assumed, so a hole can never be silent: three games arrived hours after
 * the Fase 0 finding existed and before it was registered, and they belong to neither side.
 */
export function countGapGames(db: Db, spec: Spec, baselineUntil: number, testFrom: number): number {
  // A vision spec has no lane state to read, so the unit is the GAME. Sending it through the
  // lane-state path silently returned 0 — `spec.champion` is undefined there, which matches no
  // row — and a declared hole that reports itself as empty is worse than no hole at all.
  // A vision or growth spec has no lane state to read, so the unit is the GAME.
  if ('windowSeconds' in spec || 'rollingGames' in spec) {
    return queryParticipants(db, {
      puuid: spec.puuid,
      role: spec.role,
      queueId: spec.queueId,
      since: baselineUntil,
    }).filter((r) => r.gameCreation >= baselineUntil && r.gameCreation < testFrom).length;
  }
  // A team-state spec DOES read a lane state, and the hole must be counted in the same unit the
  // measure uses, so it goes through `collectStates` exactly as the lane-state path does.
  if ('teamBand' in spec) {
    return collectStates(db, {
      puuid: spec.puuid,
      role: spec.role,
      queueId: spec.queueId,
      since: baselineUntil,
      until: testFrom,
      minute: spec.minute,
    }).rows.length;
  }
  // A phase spec reads its lane state at `gateMinute`, which is not necessarily the 14 the
  // others use. Counting the hole at the wrong minute would count a different set of games.
  if ('deathsPer10Threshold' in spec) {
    return collectStates(db, {
      puuid: spec.puuid,
      role: spec.role,
      queueId: spec.queueId,
      since: baselineUntil,
      until: testFrom,
      minute: spec.gateMinute,
    }).rows.length;
  }
  return rowsFor(db, spec, { from: baselineUntil, until: testFrom }, spec.minute).rows.length;
}
