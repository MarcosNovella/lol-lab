import { describe, expect, it } from 'vitest';
import { clock, damagers, killers } from '../src/analysis/events.ts';
import {
  deathsOf,
  expensiveMoments,
  FIGHT_GAP_MS,
  fightsOf,
  teamfights,
} from '../src/analysis/moments.ts';
import type { MatchDto, TimelineDto, TimelineEvent } from '../src/riot/types.ts';
import { match, participant } from './fixtures.ts';

/** Him as participant 1 on team 100, one enemy mid as 2, plus an ally and an enemy to fight. */
function lobby(): MatchDto {
  return match({
    matchId: 'LA2_M',
    participants: [
      participant({ puuid: 'me', championName: 'Locke', teamId: 100, teamPosition: 'MIDDLE' }),
      participant({
        puuid: 'enemy-mid',
        championName: 'Akali',
        teamId: 200,
        teamPosition: 'MIDDLE',
      }),
      participant({ puuid: 'ally-jg', championName: 'Nunu', teamId: 100, teamPosition: 'JUNGLE' }),
      participant({ puuid: 'enemy-jg', championName: 'Kayn', teamId: 200, teamPosition: 'JUNGLE' }),
    ],
  });
}

const ID = { me: 1, enemyMid: 2, allyJg: 3, enemyJg: 4 } as const;

type Frame = { minute: number; myTeamGold: number; enemyGold: number; events?: TimelineEvent[] };

function timeline(frames: Frame[]): TimelineDto {
  return {
    metadata: { matchId: 'LA2_M', participants: ['me', 'enemy-mid', 'ally-jg', 'enemy-jg'] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: 'enemy-mid' },
        { participantId: 3, puuid: 'ally-jg' },
        { participantId: 4, puuid: 'enemy-jg' },
      ],
      frames: frames.map((f) => ({
        timestamp: f.minute * 60_000,
        participantFrames: {
          '1': { participantId: 1, totalGold: f.myTeamGold / 2 },
          '3': { participantId: 3, totalGold: f.myTeamGold / 2 },
          '2': { participantId: 2, totalGold: f.enemyGold / 2 },
          '4': { participantId: 4, totalGold: f.enemyGold / 2 },
        },
        events: f.events ?? [],
      })),
    },
  };
}

function kill(
  over: Partial<TimelineEvent> & { timestamp: number; victimId: number },
): TimelineEvent {
  return {
    type: 'CHAMPION_KILL',
    position: { x: 7000, y: 7000 },
    killerId: ID.enemyMid,
    victimDamageReceived: [{ participantId: ID.enemyMid, magicDamage: 900 }],
    ...over,
  };
}

describe('death context', () => {
  it('reads an exact timestamp and position off the kill event', () => {
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 23,
        myTeamGold: 40000,
        enemyGold: 37000,
        events: [kill({ timestamp: 23 * 60_000 + 40_000, victimId: ID.me })],
      },
      { minute: 25, myTeamGold: 41000, enemyGold: 41000 },
    ]);
    const [death] = deathsOf(lobby(), tl, 'me');
    expect(death?.at).toBe('23:40');
    expect(death?.position).toEqual({ x: 7000, y: 7000 });
  });

  it('calls a death alone when nobody else died near it in time', () => {
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 20,
        myTeamGold: 30000,
        enemyGold: 30000,
        events: [kill({ timestamp: 20 * 60_000, victimId: ID.me })],
      },
      { minute: 22, myTeamGold: 30000, enemyGold: 30000 },
    ]);
    expect(deathsOf(lobby(), tl, 'me')[0]?.alone).toBe(true);
  });

  it('does NOT call it alone when an ally went down in the same window', () => {
    const at = 20 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 20,
        myTeamGold: 30000,
        enemyGold: 30000,
        events: [
          kill({ timestamp: at, victimId: ID.me }),
          kill({ timestamp: at + FIGHT_GAP_MS - 1000, victimId: ID.allyJg }),
        ],
      },
      { minute: 22, myTeamGold: 30000, enemyGold: 30000 },
    ]);
    expect(deathsOf(lobby(), tl, 'me')[0]?.alone).toBe(false);
  });

  it('costs the death by the team gold swing over the two minutes after', () => {
    const at = 20 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 20,
        myTeamGold: 33000,
        enemyGold: 30000,
        events: [kill({ timestamp: at, victimId: ID.me })],
      },
      { minute: 22, myTeamGold: 34000, enemyGold: 35000 },
    ]);
    const [death] = deathsOf(lobby(), tl, 'me');
    expect(death?.teamGoldDiff).toBe(3000);
    expect(death?.costGold).toBe(-4000); // +3000 -> -1000
  });

  it('records an objective the enemy took right after', () => {
    const at = 20 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 20,
        myTeamGold: 30000,
        enemyGold: 30000,
        events: [
          kill({ timestamp: at, victimId: ID.me }),
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: at + 40_000,
            killerId: ID.enemyJg,
            monsterType: 'BARON_NASHOR',
          },
        ],
      },
      { minute: 22, myTeamGold: 30000, enemyGold: 32000 },
    ]);
    expect(deathsOf(lobby(), tl, 'me')[0]?.objectiveLostAfter).toBe('BARON_NASHOR');
  });
});

describe('fights', () => {
  it('clusters kills close in time and space into one fight', () => {
    const at = 25 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          kill({ timestamp: at, victimId: ID.me }),
          kill({ timestamp: at + 5000, victimId: ID.allyJg }),
          kill({ timestamp: at + 9000, victimId: ID.enemyJg, killerId: ID.allyJg }),
        ],
      },
    ]);
    const fights = fightsOf(lobby(), tl, 'me');
    expect(fights).toHaveLength(1);
    expect(fights[0]?.kills).toBe(3);
    expect(fights[0]?.alliesDown).toBe(2);
    expect(fights[0]?.enemiesDown).toBe(1);
    expect(fights[0]?.diedFirst).toBe(true);
  });

  it('splits kills that are far apart on the map even when close in time', () => {
    const at = 25 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          kill({ timestamp: at, victimId: ID.me, position: { x: 1000, y: 1000 } }),
          kill({ timestamp: at + 3000, victimId: ID.allyJg, position: { x: 13000, y: 13000 } }),
        ],
      },
    ]);
    expect(fightsOf(lobby(), tl, 'me')).toHaveLength(2);
  });

  it('detects presence from damage dealt, not from position (ADR-008)', () => {
    const at = 25 * 60_000;
    // He neither kills, assists nor dies — but he damaged the victim, so he was there.
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          kill({
            timestamp: at,
            victimId: ID.enemyJg,
            killerId: ID.allyJg,
            victimDamageReceived: [
              { participantId: ID.allyJg, physicalDamage: 500 },
              { participantId: ID.me, magicDamage: 700 },
            ],
          }),
        ],
      },
    ]);
    expect(fightsOf(lobby(), tl, 'me')[0]?.present).toBe(true);
  });

  it('marks him absent from a fight he did no damage in', () => {
    const at = 25 * 60_000;
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          kill({
            timestamp: at,
            victimId: ID.allyJg,
            killerId: ID.enemyJg,
            victimDamageReceived: [{ participantId: ID.enemyJg, physicalDamage: 900 }],
          }),
        ],
      },
    ]);
    expect(fightsOf(lobby(), tl, 'me')[0]?.present).toBe(false);
  });
});

describe('a pickoff is not a fight', () => {
  it('keeps clusters below the threshold out of the presence rate', () => {
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          // A real fight: three kills together.
          kill({ timestamp: 25 * 60_000, victimId: ID.me }),
          kill({ timestamp: 25 * 60_000 + 4000, victimId: ID.allyJg }),
          kill({ timestamp: 25 * 60_000 + 8000, victimId: ID.enemyJg, killerId: ID.allyJg }),
          // A lone pickoff on the far side of the map, 3 minutes later.
          kill({ timestamp: 28 * 60_000, victimId: ID.allyJg, position: { x: 1000, y: 13000 } }),
        ],
      },
    ]);
    const clusters = fightsOf(lobby(), tl, 'me');
    expect(clusters).toHaveLength(2);
    // Without the threshold, "present in 1 of 2" would blame him for missing a 1v1 across
    // the map — the bug that reported 35 fights in a 24-minute game.
    expect(teamfights(clusters)).toHaveLength(1);
    expect(teamfights(clusters)[0]?.kills).toBe(3);
  });

  it('takes the threshold as an argument, because 3 is a judgement call', () => {
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 25,
        myTeamGold: 40000,
        enemyGold: 40000,
        events: [
          kill({ timestamp: 25 * 60_000, victimId: ID.me }),
          kill({ timestamp: 25 * 60_000 + 4000, victimId: ID.allyJg }),
        ],
      },
    ]);
    const clusters = fightsOf(lobby(), tl, 'me');
    expect(teamfights(clusters, 3)).toHaveLength(0);
    expect(teamfights(clusters, 2)).toHaveLength(1);
  });
});

describe('the three most expensive moments', () => {
  it('ranks by gold swing, worst first, and phrases each one for a human', () => {
    const tl = timeline([
      { minute: 0, myTeamGold: 1000, enemyGold: 1000 },
      {
        minute: 10,
        myTeamGold: 16000,
        enemyGold: 15000,
        events: [kill({ timestamp: 10 * 60_000, victimId: ID.me })],
      },
      { minute: 12, myTeamGold: 18000, enemyGold: 17500 },
      {
        minute: 20,
        myTeamGold: 33000,
        enemyGold: 30000,
        events: [kill({ timestamp: 20 * 60_000, victimId: ID.me, bounty: 300 })],
      },
      { minute: 22, myTeamGold: 34000, enemyGold: 36000 },
    ]);
    const { moments } = expensiveMoments(lobby(), tl, 'me', 3);
    expect(moments).toHaveLength(2);
    expect(moments[0]?.at).toBe('20:00');
    expect(moments[0]?.costGold).toBeLessThan(moments[1]?.costGold ?? 0);
    expect(moments[0]?.line).toContain('moriste solo');
    expect(moments[0]?.line).toContain('+3.0k');
    expect(moments[0]?.line).toContain('300 de oro');
  });
});

describe('primitives', () => {
  it('formats a timeline timestamp as mm:ss', () => {
    expect(clock(23 * 60_000 + 40_000)).toBe('23:40');
    expect(clock(65_000)).toBe('1:05');
  });

  it('reads damagers and killers off an event, skipping id 0', () => {
    const event = kill({
      timestamp: 0,
      victimId: ID.me,
      killerId: 0,
      assistingParticipantIds: [ID.enemyJg, 0],
    });
    expect(damagers(event)).toEqual([ID.enemyMid]);
    expect(killers(event)).toEqual([ID.enemyJg]);
  });
});
