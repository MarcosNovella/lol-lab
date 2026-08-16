import type { MatchDto, TimelineDto, TimelineFrame } from '../riot/types.ts';

/**
 * Game state at a fixed minute, measured against the lane opponent.
 *
 * This exists because of G-008. Almost every post-game statistic is downstream of who won:
 * comparing season means told us he was ahead of his lane opponent in 17 of 18 metrics while
 * his win rate was 52.8%, because the mean was dominated by the games he snowballed. The way
 * out is to freeze the game at a minute where the result is still open and ask what he does
 * from there — which is also the question he actually has, since his own CS@10 is identical
 * in wins and losses and only his OPPONENT's differs.
 */

/**
 * Laning phase is over: turret plates have fallen, junglers rotate full time, and the first
 * grouped fights start. Late enough that laning has resolved, early enough that most games
 * are still live — a 14-minute floor keeps 36 of 36 of his ranked games in scope.
 */
export const STATE_MINUTE = 14;

/**
 * Gold swing that counts as a real lead rather than a couple of waves.
 *
 * 500 is a JUDGEMENT CALL, not a discovered threshold, and the code says so because the data
 * does not support anything stronger: across his 36 ranked games |goldDiff| at minute 14 is
 * smooth from 0 to ~2250 with no natural gap to cut at, so any band in that range is defensible
 * and none is derived. 500 is about one component item — the smallest gap a player would call
 * a lead.
 *
 * Because the choice is arbitrary, every report built on it MUST show its sensitivity across
 * a range of bands (see `conversionByBand`). A conclusion that only survives at one band is
 * not a conclusion.
 */
export const EVEN_GOLD_BAND = 500;

/** Bands the sensitivity check sweeps, so no finding can rest on one arbitrary cut. */
export const SENSITIVITY_BANDS = [300, 500, 750, 1000] as const;

export type StateBucket = 'atrás' | 'pareja' | 'arriba';

export type LaneState = {
  minute: number;
  /** Positive means HE is ahead. Same orientation for every field here. */
  goldDiff: number;
  xpDiff: number;
  csDiff: number;
  /** His team's total gold minus the enemy team's, at the same frame. */
  teamGoldDiff: number;
  opponentPuuid: string;
  opponentChampion: string;
  bucket: StateBucket;
};

/**
 * Maps a puuid to its timeline `participantId`.
 *
 * Two routes because Riot populates `info.participants` on most matches but not all; the
 * fallback is the metadata ordering, where index 0 is participantId 1.
 */
export function participantIdOf(
  timeline: TimelineDto,
  match: MatchDto,
  puuid: string,
): number | null {
  const listed = timeline.info.participants?.find((p) => p.puuid === puuid);
  if (listed) return listed.participantId;
  const index = match.metadata.participants.indexOf(puuid);
  return index >= 0 ? index + 1 : null;
}

/**
 * The frame closest to `minute`, or null when the game ended before it.
 *
 * Never extrapolates: a game that ended at 12 minutes has no minute-14 state, and inventing
 * one by reusing the last frame would silently file a short stomp as an even game.
 */
export function frameAtMinute(timeline: TimelineDto, minute: number): TimelineFrame | null {
  const wanted = minute * 60_000;
  let best: TimelineFrame | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const frame of timeline.info.frames) {
    const gap = Math.abs(frame.timestamp - wanted);
    if (gap < bestGap) {
      best = frame;
      bestGap = gap;
    }
  }
  if (best === null) return null;
  // Half a frame interval of tolerance. Beyond that the game simply did not reach the minute.
  return bestGap <= 30_000 ? best : null;
}

function csOf(frame: TimelineFrame, participantId: number): number {
  const pf = frame.participantFrames[String(participantId)];
  return (pf?.minionsKilled ?? 0) + (pf?.jungleMinionsKilled ?? 0);
}

export function bucketOf(goldDiff: number, band: number = EVEN_GOLD_BAND): StateBucket {
  if (goldDiff > band) return 'arriba';
  if (goldDiff < -band) return 'atrás';
  return 'pareja';
}

/**
 * His state versus the enemy player in the SAME role, at a given minute.
 *
 * The opponent is picked by `teamPosition` (G-004), which is the same peer definition the
 * benchmark uses (ADR-002): Riot already MMR-matched them, so the comparison needs no
 * external rank average. Returns null when the role is blank, the mirror is missing, or the
 * game never reached the minute — all three are honest "no state" answers, not zeroes.
 */
export function laneStateAt(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
  minute: number = STATE_MINUTE,
): LaneState | null {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (!me || me.teamPosition === '') return null;

  const opponent = match.info.participants.find(
    (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
  );
  if (!opponent) return null;

  const frame = frameAtMinute(timeline, minute);
  if (!frame) return null;

  const myId = participantIdOf(timeline, match, puuid);
  const oppId = participantIdOf(timeline, match, opponent.puuid);
  if (myId === null || oppId === null) return null;

  const mine = frame.participantFrames[String(myId)];
  const theirs = frame.participantFrames[String(oppId)];
  if (!mine || !theirs) return null;

  let myTeamGold = 0;
  let enemyTeamGold = 0;
  for (const participant of match.info.participants) {
    const id = participantIdOf(timeline, match, participant.puuid);
    if (id === null) continue;
    const gold = frame.participantFrames[String(id)]?.totalGold ?? 0;
    if (participant.teamId === me.teamId) myTeamGold += gold;
    else enemyTeamGold += gold;
  }

  const goldDiff = (mine.totalGold ?? 0) - (theirs.totalGold ?? 0);
  return {
    minute,
    goldDiff,
    xpDiff: (mine.xp ?? 0) - (theirs.xp ?? 0),
    csDiff: csOf(frame, myId) - csOf(frame, oppId),
    teamGoldDiff: myTeamGold - enemyTeamGold,
    opponentPuuid: opponent.puuid,
    opponentChampion: opponent.championName,
    bucket: bucketOf(goldDiff),
  };
}
