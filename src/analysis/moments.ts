import type { MatchDto, Position, TimelineDto, TimelineEvent } from '../riot/types.ts';
import {
  championKills,
  clock,
  damagers,
  eliteMonsterKills,
  killers,
  type Participants,
  participantsOf,
  teamGoldDiffAt,
} from './events.ts';

/**
 * The central deliverable: per game, the moments that actually cost him the game, with an exact
 * timestamp he can scrub a replay to.
 *
 * "Min 23:40, you died alone in the enemy jungle with your team 3k up and Baron spawning" is
 * actionable in a way no season aggregate will ever be. Everything else in this repo exists so
 * that line is correct.
 *
 * HOW "EXPENSIVE" IS DEFINED, AND WHY IT IS ONE NUMBER AND NOT A BLEND: cost is the team gold
 * swing over the two minutes after the event. A weighted composite of bounty, objective loss
 * and gold swing would need weights, and weights are exactly the arbitrary knobs G-011 was
 * written about — three of them, none derivable, all invisible in the output. Gold swing is a
 * single measured quantity that answers the question the word "expensive" actually asks. The
 * rest (bounty carried, whether an objective fell, whether he was alone) is reported ALONGSIDE
 * as description, never folded into the ranking.
 */

/** How long after an event its consequences are attributed to it. */
export const COST_WINDOW_MS = 120_000;

/** Kills within this of each other, and this close on the map, are one cluster. */
export const FIGHT_GAP_MS = 20_000;
export const FIGHT_RADIUS = 2500;

/**
 * Kills a cluster needs before it is a FIGHT rather than a pickoff.
 *
 * The plan said "≥3 champion kills within 20s inside a radius" and the first implementation
 * dropped the threshold, which made every isolated 1v1 anywhere on the map its own "fight": a
 * 24-minute game reported 35 of them, and "present in 13 of 35" then read as an indictment for
 * not teleporting to solo kills across the map. Clusters below the threshold are still
 * returned — they are real events — but they are not what a presence rate is about.
 *
 * 3 is the plan's number and it is a judgement call, so `teamfights` takes it as an argument
 * and the report is expected to say which one it used (G-011).
 */
export const TEAMFIGHT_MIN_KILLS = 3;

export type DeathContext = {
  timestamp: number;
  /** `mm:ss`, for the replay scrubber. */
  at: string;
  position: Position | null;
  /** His team's gold minus the enemy's, at the nearest minute frame. */
  teamGoldDiff: number | null;
  /** Distinct enemies who dealt him damage. Exact, from `victimDamageReceived`. */
  enemiesInvolved: number;
  /**
   * True when no ally and no enemy other than his killers died within the fight window — that
   * is, it was not a trade and not a teamfight. Defined from EVENTS, never from ally positions
   * at the nearest minute, which would be up to 60 seconds of walking away (ADR-008).
   */
  alone: boolean;
  /** Gold the enemy collected for the kill, including a shutdown. */
  bounty: number;
  /** An elite monster taken by the enemy within `COST_WINDOW_MS` after the death. */
  objectiveLostAfter: string | null;
  /** Team gold swing over the window after. Negative means it cost him. */
  costGold: number | null;
};

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Every death of his, with exact context.
 *
 * Returns an empty list rather than throwing when the participant mapping fails: a match whose
 * timeline cannot be aligned is a gap in coverage, not an error to propagate.
 */
export function deathsOf(match: MatchDto, timeline: TimelineDto, puuid: string): DeathContext[] {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return [];
  const myId = participants.idOf(puuid);
  if (myId === null) return [];

  const kills = championKills(timeline);
  const monsters = eliteMonsterKills(timeline);
  const out: DeathContext[] = [];

  for (const event of kills) {
    if (event.victimId !== myId) continue;

    const myKillers = new Set(killers(event));
    // Anyone else dying close in time: a trade or a teamfight rather than a solo death.
    const companions = kills.filter(
      (other) =>
        other !== event &&
        Math.abs(other.timestamp - event.timestamp) <= FIGHT_GAP_MS &&
        other.victimId !== undefined &&
        !myKillers.has(other.victimId),
    );

    const goldBefore = teamGoldDiffAt(match, timeline, participants, puuid, event.timestamp);
    const goldAfter = teamGoldDiffAt(
      match,
      timeline,
      participants,
      puuid,
      event.timestamp + COST_WINDOW_MS,
    );

    const lost = monsters.find(
      (m) =>
        m.timestamp > event.timestamp &&
        m.timestamp <= event.timestamp + COST_WINDOW_MS &&
        m.killerId !== undefined &&
        participants.sideOf(m.killerId) === 'enemy',
    );

    out.push({
      timestamp: event.timestamp,
      at: clock(event.timestamp),
      position: event.position ?? null,
      teamGoldDiff: goldBefore,
      enemiesInvolved: damagers(event).filter((id) => participants.sideOf(id) === 'enemy').length,
      alone: companions.length === 0,
      bounty: (event.bounty ?? 0) + (event.shutdownBounty ?? 0),
      objectiveLostAfter: lost?.monsterType ?? null,
      costGold: goldBefore !== null && goldAfter !== null ? goldAfter - goldBefore : null,
    });
  }

  return out;
}

export type Fight = {
  timestamp: number;
  at: string;
  /** Kills in the cluster, all sides. */
  kills: number;
  /** Deaths on his side. */
  alliesDown: number;
  enemiesDown: number;
  /** He dealt or received damage in it — exact, via `victimDamageReceived` (ADR-008). */
  present: boolean;
  /**
   * He was the first of his side to die in it.
   *
   * Only meaningful inside a real fight: in a cluster where he is the only death, "died first"
   * is trivially true and says nothing, so read it through `teamfights`.
   */
  diedFirst: boolean;
  /** Elite monster taken within 60s after, and by whom. */
  objectiveAfter: { monster: string; by: 'ally' | 'enemy' } | null;
};

/**
 * Clusters champion kills into fights by time AND space.
 *
 * Exact, not approximate: CHAMPION_KILL carries its own timestamp and position on every row, so
 * this does not depend on the one-minute frame sampling at all — which retires the risk the
 * plan carried in §8.
 */
export function fightsOf(match: MatchDto, timeline: TimelineDto, puuid: string): Fight[] {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return [];
  const myId = participants.idOf(puuid);
  if (myId === null) return [];

  const kills = championKills(timeline);
  const clusters: TimelineEvent[][] = [];

  for (const event of kills) {
    const last = clusters.at(-1);
    const previous = last?.at(-1);
    const closeInTime =
      previous !== undefined && event.timestamp - previous.timestamp <= FIGHT_GAP_MS;
    const closeInSpace =
      previous?.position === undefined ||
      event.position === undefined ||
      distance(previous.position, event.position) <= FIGHT_RADIUS;

    if (last !== undefined && closeInTime && closeInSpace) last.push(event);
    else clusters.push([event]);
  }

  return clusters.map((cluster) => {
    const first = cluster[0];
    const timestamp = first?.timestamp ?? 0;
    const monsters = eliteMonsterKills(timeline);
    const monster = monsters.find(
      (m) => m.timestamp > timestamp && m.timestamp <= timestamp + 60_000,
    );

    const myDeaths = cluster.filter((e) => e.victimId === myId);
    const firstAllyDeath = cluster.find(
      (e) => e.victimId !== undefined && participants.sideOf(e.victimId) === 'ally',
    );

    return {
      timestamp,
      at: clock(timestamp),
      kills: cluster.length,
      alliesDown: cluster.filter(
        (e) => e.victimId !== undefined && participants.sideOf(e.victimId) === 'ally',
      ).length,
      enemiesDown: cluster.filter(
        (e) => e.victimId !== undefined && participants.sideOf(e.victimId) === 'enemy',
      ).length,
      present: cluster.some(
        (e) => e.victimId === myId || damagers(e).includes(myId) || killers(e).includes(myId),
      ),
      diedFirst: myDeaths.length > 0 && firstAllyDeath?.victimId === myId,
      objectiveAfter:
        monster?.monsterType !== undefined && monster.killerId !== undefined
          ? {
              monster: monster.monsterType,
              by: participants.sideOf(monster.killerId) === 'ally' ? 'ally' : 'enemy',
            }
          : null,
    };
  });
}

/**
 * The clusters big enough to be fights. Everything smaller is a pickoff and is counted
 * separately rather than dropped.
 */
export function teamfights(fights: Fight[], minKills: number = TEAMFIGHT_MIN_KILLS): Fight[] {
  return fights.filter((f) => f.kills >= minKills);
}

export type Moment = {
  at: string;
  timestamp: number;
  costGold: number;
  /** One line, already phrased for a human. */
  line: string;
};

export function describeDeath(death: DeathContext): string {
  const bits: string[] = [];
  bits.push(death.alone ? 'moriste solo' : `moriste en pelea de ${death.enemiesInvolved}`);
  if (death.teamGoldDiff !== null) {
    const sign = death.teamGoldDiff >= 0 ? '+' : '';
    bits.push(`con el equipo ${sign}${(death.teamGoldDiff / 1000).toFixed(1)}k`);
  }
  if (death.bounty > 0) bits.push(`entregando ${death.bounty} de oro`);
  if (death.objectiveLostAfter !== null) {
    bits.push(`y perdieron ${death.objectiveLostAfter.toLowerCase()} en los 2 min siguientes`);
  }
  return bits.join(' ');
}

/**
 * The N most expensive moments of a game, worst first.
 *
 * Only deaths whose cost could actually be measured are ranked. A death two minutes before the
 * game ended has no window after it, and ranking it as cost 0 would put the least measurable
 * event at the top of a list sorted ascending — so it is dropped and counted instead.
 */
export function expensiveMoments(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
  limit = 3,
): { moments: Moment[]; unmeasurable: number } {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return { moments: [], unmeasurable: 0 };

  const deaths = deathsOf(match, timeline, puuid);
  const measurable = deaths.filter((d) => d.costGold !== null);

  const moments = measurable
    .map((death) => ({
      at: death.at,
      timestamp: death.timestamp,
      costGold: death.costGold ?? 0,
      line: describeDeath(death),
    }))
    .sort((a, b) => a.costGold - b.costGold)
    .slice(0, limit);

  return { moments, unmeasurable: deaths.length - measurable.length };
}
