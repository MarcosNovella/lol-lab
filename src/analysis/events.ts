import type { MatchDto, TimelineDto, TimelineEvent } from '../riot/types.ts';
import { participantIdOf } from './state.ts';

/**
 * Typed primitives over the raw timeline.
 *
 * ADR-008 measured what the timeline actually contains before anything was designed on it, and
 * the shape of this module follows that measurement exactly:
 *
 * - Kill-type events carry their OWN timestamp and position (CHAMPION_KILL 4364/4364,
 *   ELITE_MONSTER_KILL 619/619), so anything built on them is exact and does not inherit the
 *   one-minute frame sampling.
 * - `victimDamageReceived` is populated on every champion kill, one entry per participant who
 *   dealt damage, which answers "who was actually in this" exactly — including for a player who
 *   neither killed, assisted nor died.
 * - Ward events carry NO position (0 of 13457), so nothing positional about vision is buildable.
 *
 * THE ONE RULE THIS MODULE ENFORCES: a quantity read from a frame is at most half a frame away
 * in time, which is fine for something that changes slowly and NOT fine for something that
 * moves. Gold at the nearest minute is a reasonable reading of gold. A player's POSITION at the
 * nearest minute is up to 60 seconds of walking away from where they were, and ADR-008 rejected
 * exactly that substitution once already. So positions come only from events that carry one.
 */

export type Side = 'ally' | 'enemy';

export type Participants = {
  /** participantId (1-10) for a puuid, or null when the mapping is unavailable. */
  idOf: (puuid: string) => number | null;
  teamOf: (participantId: number) => number | null;
  championOf: (participantId: number) => string | null;
  sideOf: (participantId: number) => Side | null;
};

/** Builds the id/team/champion lookups for one match, oriented around `puuid`. */
export function participantsOf(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
): Participants | null {
  const myId = participantIdOf(timeline, match, puuid);
  if (myId === null) return null;
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;

  const teamById = new Map<number, number>();
  const championById = new Map<number, string>();
  for (const participant of match.info.participants) {
    const id = participantIdOf(timeline, match, participant.puuid);
    if (id === null) continue;
    teamById.set(id, participant.teamId);
    championById.set(id, participant.championName);
  }

  return {
    idOf: (p) => participantIdOf(timeline, match, p),
    teamOf: (id) => teamById.get(id) ?? null,
    championOf: (id) => championById.get(id) ?? null,
    sideOf: (id) => {
      const team = teamById.get(id);
      if (team === undefined) return null;
      return team === me.teamId ? 'ally' : 'enemy';
    },
  };
}

/** Every event in the timeline, flattened out of its frame, in timestamp order. */
export function allEvents(timeline: TimelineDto): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const frame of timeline.info.frames) {
    for (const event of frame.events ?? []) events.push(event);
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export function eventsOfType(timeline: TimelineDto, type: string): TimelineEvent[] {
  return allEvents(timeline).filter((e) => e.type === type);
}

export const championKills = (timeline: TimelineDto): TimelineEvent[] =>
  eventsOfType(timeline, 'CHAMPION_KILL');

export const eliteMonsterKills = (timeline: TimelineDto): TimelineEvent[] =>
  eventsOfType(timeline, 'ELITE_MONSTER_KILL');

/**
 * Who dealt damage to the victim of a kill, as participant ids.
 *
 * This is the exact answer to "was he in this fight", and it is strictly better than a
 * positional proxy: a player who did damage was there, and one who did none was not
 * participating even if he happened to be standing nearby.
 */
export function damagers(event: TimelineEvent): number[] {
  const ids = new Set<number>();
  for (const entry of event.victimDamageReceived ?? []) {
    if (typeof entry.participantId === 'number') ids.add(entry.participantId);
  }
  return [...ids];
}

/** Everyone credited with a kill: the killer plus assists. Excludes id 0 (neutral/execute). */
export function killers(event: TimelineEvent): number[] {
  const ids = new Set<number>();
  if (typeof event.killerId === 'number' && event.killerId > 0) ids.add(event.killerId);
  for (const id of event.assistingParticipantIds ?? []) if (id > 0) ids.add(id);
  return [...ids];
}

/**
 * A slowly-varying quantity read at the frame nearest `timestamp`.
 *
 * Returns the frame plus how far away it was, so a caller can decide rather than be misled.
 * Never used for position — see the module note.
 */
export function nearestFrame(
  timeline: TimelineDto,
  timestamp: number,
): { index: number; gapMs: number } | null {
  let best: { index: number; gapMs: number } | null = null;
  for (const [index, frame] of timeline.info.frames.entries()) {
    const gapMs = Math.abs(frame.timestamp - timestamp);
    if (best === null || gapMs < best.gapMs) best = { index, gapMs };
  }
  return best;
}

/** His team's gold minus the enemy team's, at the frame nearest `timestamp`. */
export function teamGoldDiffAt(
  match: MatchDto,
  timeline: TimelineDto,
  participants: Participants,
  puuid: string,
  timestamp: number,
): number | null {
  const at = nearestFrame(timeline, timestamp);
  if (at === null) return null;
  const frame = timeline.info.frames[at.index];
  if (frame === undefined) return null;

  let mine = 0;
  let theirs = 0;
  for (const participant of match.info.participants) {
    const id = participants.idOf(participant.puuid);
    if (id === null) continue;
    const gold = frame.participantFrames[String(id)]?.totalGold ?? 0;
    if (participants.sideOf(id) === 'ally') mine += gold;
    else theirs += gold;
  }
  return mine - theirs;
}

/** `mm:ss` from a timeline timestamp, which is what a replay scrubber wants. */
export function clock(timestampMs: number): string {
  const total = Math.floor(timestampMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
