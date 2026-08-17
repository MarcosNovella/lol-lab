import type { MatchDto, TimelineDto } from '../riot/types.ts';
import { allEvents, championKills, eventsOfType, participantsOf } from './events.ts';
import { MAP_MAX } from './render.ts';

/**
 * Objectives, vision timing, tempo and roams — the rest of the M2 event layer.
 *
 * Every one of these was cut down to what the API actually carries, measured over the corpus
 * before being written rather than after:
 *
 * - Elite monsters: DRAGON 162, HORDE 117 (grubs), BARON_NASHOR 46, RIFTHERALD 39. Assists are
 *   present on 268 of 364, so credited participation is a real signal, not a rarity.
 * - Wards: `wardType` is UNDEFINED on 2088 of 7838 placements across the corpus — 27% — but
 *   checked per player, ALL of those belong to other participants and none to him, so the gap
 *   limits nothing here. The field is still counted (`unknownType`) rather than assumed empty,
 *   because that is a fact about this account's champion pool and not a guarantee. The 27%
 *   figure was originally written into this comment as a limit on HIS analysis, which was a
 *   corpus statistic carried onto a subset it did not describe (G-015). TEEMO_MUSHROOM also
 *   arrives through this event and is not vision, so it is excluded rather than inflating a count.
 * - Positions on wards do not exist at all (ADR-008), so vision is timing only.
 * - Item completion timings are CUT, not deferred: ITEM_PURCHASED carries an `itemId` and
 *   nothing else, and this repo caches no Data Dragon, so there is no way to tell a component
 *   from a legendary or to price either. Claiming "you finish your second item 90s after him"
 *   would require inventing the item table.
 */

/** Non-vision "wards" Riot reports through the same event. */
const NOT_VISION = new Set(['TEEMO_MUSHROOM']);

export type ObjectiveTaken = {
  timestamp: number;
  minute: number;
  /** DRAGON | HORDE | BARON_NASHOR | RIFTHERALD, or a tower descriptor. */
  kind: string;
  lane: string | null;
  byOwnTeam: boolean;
  /** He is credited as killer or assist. Credited participation, not proximity. */
  participated: boolean;
  /**
   * He died in the 30 seconds before it. Measured, unlike "was he alive", which would need
   * the respawn-timer formula — a model, not data.
   */
  diedJustBefore: boolean;
};

export function objectivesOf(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
): ObjectiveTaken[] {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return [];
  const myId = participants.idOf(puuid);
  if (myId === null) return [];
  const myDeaths = championKills(timeline).filter((e) => e.victimId === myId);

  const rows: ObjectiveTaken[] = [];
  const push = (
    timestamp: number,
    kind: string,
    lane: string | null,
    byOwnTeam: boolean,
    credited: number[],
  ): void => {
    rows.push({
      timestamp,
      minute: Math.floor(timestamp / 60_000),
      kind,
      lane,
      byOwnTeam,
      participated: credited.includes(myId),
      diedJustBefore: myDeaths.some(
        (d) => d.timestamp < timestamp && timestamp - d.timestamp <= 30_000,
      ),
    });
  };

  for (const event of eventsOfType(timeline, 'ELITE_MONSTER_KILL')) {
    const credited = [
      ...(event.killerId !== undefined && event.killerId > 0 ? [event.killerId] : []),
      ...(event.assistingParticipantIds ?? []),
    ];
    const byOwnTeam =
      event.killerId !== undefined && participants.sideOf(event.killerId) === 'ally';
    push(
      event.timestamp,
      event.monsterSubType ?? event.monsterType ?? 'MONSTER',
      null,
      byOwnTeam,
      credited,
    );
  }

  for (const event of eventsOfType(timeline, 'BUILDING_KILL')) {
    // `teamId` on a building event is the team that LOST it, so ours falling means they took it.
    const lostByAlly = event.teamId !== undefined && participants.teamOf(myId) === event.teamId;
    const credited = [
      ...(event.killerId !== undefined && event.killerId > 0 ? [event.killerId] : []),
      ...(event.assistingParticipantIds ?? []),
    ];
    push(
      event.timestamp,
      event.towerType ?? event.buildingType ?? 'BUILDING',
      event.laneType ?? null,
      !lostByAlly,
      credited,
    );
  }

  return rows.sort((a, b) => a.timestamp - b.timestamp);
}

export type VisionTiming = {
  wardsPlaced: number;
  controlWards: number;
  /** Placements whose type Riot did not report. Stated, because it is ~27% of them. */
  unknownType: number;
  wardsKilled: number;
  /** Wards he placed in the 60s before an elite monster fell, either side. */
  beforeObjectives: number;
  /** Elite monsters he set no vision for in the preceding 60s. */
  objectivesWithoutVision: number;
  /** Median gap between his control wards, in minutes. NaN with fewer than two. */
  controlWardGapMinutes: number;
};

export function visionOf(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
): VisionTiming | null {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return null;
  const myId = participants.idOf(puuid);
  if (myId === null) return null;

  const placed = eventsOfType(timeline, 'WARD_PLACED').filter(
    (e) => e.creatorId === myId && !NOT_VISION.has(e.wardType ?? ''),
  );
  const controls = placed.filter((e) => e.wardType === 'CONTROL_WARD');
  const monsters = eventsOfType(timeline, 'ELITE_MONSTER_KILL');

  let beforeObjectives = 0;
  let objectivesWithoutVision = 0;
  for (const monster of monsters) {
    const covered = placed.filter(
      (w) => w.timestamp <= monster.timestamp && monster.timestamp - w.timestamp <= 60_000,
    ).length;
    beforeObjectives += covered;
    if (covered === 0) objectivesWithoutVision += 1;
  }

  const gaps: number[] = [];
  for (let i = 1; i < controls.length; i += 1) {
    const previous = controls[i - 1];
    const current = controls[i];
    if (previous === undefined || current === undefined) continue;
    gaps.push((current.timestamp - previous.timestamp) / 60_000);
  }
  gaps.sort((a, b) => a - b);
  const median =
    gaps.length === 0 ? Number.NaN : (gaps[Math.floor((gaps.length - 1) / 2)] ?? Number.NaN);

  return {
    wardsPlaced: placed.length,
    controlWards: controls.length,
    unknownType: placed.filter((e) => (e.wardType ?? 'UNDEFINED') === 'UNDEFINED').length,
    wardsKilled: eventsOfType(timeline, 'WARD_KILL').filter((e) => e.killerId === myId).length,
    beforeObjectives,
    objectivesWithoutVision,
    controlWardGapMinutes: median,
  };
}

/**
 * How long after the start a purchase stops being the opening buy.
 *
 * The fountain buy does NOT sit at timestamp 0 — measured, it lands around 2000-2500ms — so
 * filtering on `timestamp > 0` returns the opening purchase and reports every first back as
 * minute 0, which is what the first implementation did. Minions spawn at 65s and nobody has
 * walked back from lane before then, so anything inside the first 30 seconds is the opening buy.
 * Still a judgement call, hence a named constant rather than a literal in a filter.
 */
export const PREGAME_MS = 30_000;

export type Tempo = {
  /**
   * Minute of his first trip back to the shop — a PROXY for the first back, not the back
   * itself, because Riot emits no back event. Purchases inside `PREGAME_MS` are the opening buy.
   */
  firstShopMinute: number | null;
  purchases: number;
  /** Same proxy for his lane opponent, so the number is a comparison and not an absolute. */
  opponentFirstShopMinute: number | null;
};

export function tempoOf(match: MatchDto, timeline: TimelineDto, puuid: string): Tempo | null {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return null;
  const myId = participants.idOf(puuid);
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (myId === null || me === undefined) return null;
  const opponent = match.info.participants.find(
    (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
  );
  const oppId = opponent ? participants.idOf(opponent.puuid) : null;

  const purchases = eventsOfType(timeline, 'ITEM_PURCHASED');
  const firstAfterStart = (id: number | null): number | null => {
    if (id === null) return null;
    const hit = purchases.find((e) => e.participantId === id && e.timestamp > PREGAME_MS);
    return hit === undefined ? null : Math.floor(hit.timestamp / 60_000);
  };

  return {
    firstShopMinute: firstAfterStart(myId),
    purchases: purchases.filter((e) => e.participantId === myId).length,
    opponentFirstShopMinute: firstAfterStart(oppId),
  };
}

export type Zone = 'mid' | 'lado-top' | 'lado-bot';

export type RoamSplit = {
  /** Minutes sampled — one per frame, which is all the resolution that exists (ADR-008). */
  minutes: number;
  /** Share of sampled minutes spent in each zone, 0..1. */
  byZone: Record<Zone, number>;
  /** Share of sampled minutes spent on the enemy side of the halfway line. */
  enemyHalf: number;
};

/** Which third of the map a position sits in, relative to the mid lane axis. */
export function zoneOf(x: number, y: number, laneWidth = 2200): Zone {
  const offMid = (y - x) / Math.SQRT2;
  if (Math.abs(offMid) <= laneWidth) return 'mid';
  return offMid > 0 ? 'lado-top' : 'lado-bot';
}

/**
 * Where he spent the game, from the per-minute position samples.
 *
 * This is the ONE legitimate use of frame positions: it describes occupancy over a minute,
 * which is exactly what a once-a-minute sample measures. It is not used to place an event in
 * space — that is what ADR-008 rejected, and the reason ward heatmaps do not exist here.
 */
export function roamsOf(match: MatchDto, timeline: TimelineDto, puuid: string): RoamSplit | null {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return null;
  const myId = participants.idOf(puuid);
  const teamId = myId === null ? null : participants.teamOf(myId);
  if (myId === null || teamId === null) return null;

  const counts: Record<Zone, number> = { mid: 0, 'lado-top': 0, 'lado-bot': 0 };
  let enemyHalf = 0;
  let minutes = 0;

  for (const frame of timeline.info.frames) {
    const position = frame.participantFrames[String(myId)]?.position;
    if (position === undefined) continue;
    minutes += 1;
    counts[zoneOf(position.x, position.y)] += 1;
    const belowMidline = position.x + position.y < MAP_MAX;
    const own = teamId === 100 ? belowMidline : !belowMidline;
    if (!own) enemyHalf += 1;
  }

  if (minutes === 0) return null;
  return {
    minutes,
    byZone: {
      mid: counts.mid / minutes,
      'lado-top': counts['lado-top'] / minutes,
      'lado-bot': counts['lado-bot'] / minutes,
    },
    enemyHalf: enemyHalf / minutes,
  };
}

/** Event-type census, for checking what a timeline actually contains before trusting it. */
export function eventCensus(timeline: TimelineDto): Map<string, number> {
  const census = new Map<string, number>();
  for (const event of allEvents(timeline)) {
    census.set(event.type, (census.get(event.type) ?? 0) + 1);
  }
  return census;
}
