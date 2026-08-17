import { describe, expect, it } from 'vitest';
import {
  eventCensus,
  objectivesOf,
  roamsOf,
  tempoOf,
  visionOf,
  zoneOf,
} from '../src/analysis/macro.ts';
import { MAP_MAX } from '../src/analysis/render.ts';
import type { MatchDto, Position, TimelineDto, TimelineEvent } from '../src/riot/types.ts';
import { match, participant } from './fixtures.ts';

function lobby(): MatchDto {
  return match({
    matchId: 'LA2_X',
    participants: [
      participant({ puuid: 'me', teamId: 100, teamPosition: 'MIDDLE' }),
      participant({ puuid: 'enemy', teamId: 200, teamPosition: 'MIDDLE', win: false }),
      participant({ puuid: 'ally', teamId: 100, teamPosition: 'JUNGLE' }),
    ],
  });
}

const ID = { me: 1, enemy: 2, ally: 3 } as const;

function timeline(events: TimelineEvent[], positions: Position[] = []): TimelineDto {
  const lastMinute = Math.max(
    positions.length - 1,
    ...events.map((e) => Math.floor(e.timestamp / 60_000)),
  );
  return {
    metadata: { matchId: 'LA2_X', participants: ['me', 'enemy', 'ally'] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: 'enemy' },
        { participantId: 3, puuid: 'ally' },
      ],
      frames: Array.from({ length: lastMinute + 1 }, (_, minute) => ({
        timestamp: minute * 60_000,
        participantFrames: {
          '1': {
            participantId: 1,
            totalGold: 1000,
            ...(positions[minute] !== undefined ? { position: positions[minute] } : {}),
          },
          '2': { participantId: 2, totalGold: 1000 },
          '3': { participantId: 3, totalGold: 1000 },
        },
        events: events.filter(
          (e) => e.timestamp >= minute * 60_000 && e.timestamp < (minute + 1) * 60_000,
        ),
      })),
    },
  };
}

describe('objectives', () => {
  it('credits participation from killer and assists, not from proximity', () => {
    const rows = objectivesOf(
      lobby(),
      timeline([
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 10 * 60_000,
          killerId: ID.ally,
          assistingParticipantIds: [ID.me],
          monsterType: 'DRAGON',
          monsterSubType: 'FIRE_DRAGON',
        },
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 20 * 60_000,
          killerId: ID.enemy,
          monsterType: 'BARON_NASHOR',
        },
      ]),
      'me',
    );
    expect(rows[0]?.kind).toBe('FIRE_DRAGON');
    expect(rows[0]?.byOwnTeam).toBe(true);
    expect(rows[0]?.participated).toBe(true);
    expect(rows[1]?.byOwnTeam).toBe(false);
    expect(rows[1]?.participated).toBe(false);
  });

  it('reads a tower the right way round: teamId is who LOST it', () => {
    const rows = objectivesOf(
      lobby(),
      timeline([
        {
          type: 'BUILDING_KILL',
          timestamp: 15 * 60_000,
          teamId: 200,
          towerType: 'OUTER_TURRET',
          laneType: 'MID_LANE',
          killerId: ID.me,
        },
        {
          type: 'BUILDING_KILL',
          timestamp: 16 * 60_000,
          teamId: 100,
          towerType: 'OUTER_TURRET',
          laneType: 'TOP_LANE',
        },
      ]),
      'me',
    );
    expect(rows[0]?.byOwnTeam).toBe(true);
    expect(rows[0]?.lane).toBe('MID_LANE');
    expect(rows[1]?.byOwnTeam).toBe(false);
  });

  it('reports having died just before, instead of modelling whether he was alive', () => {
    const rows = objectivesOf(
      lobby(),
      timeline([
        { type: 'CHAMPION_KILL', timestamp: 10 * 60_000, victimId: ID.me, killerId: ID.enemy },
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 10 * 60_000 + 20_000,
          killerId: ID.enemy,
          monsterType: 'DRAGON',
        },
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 25 * 60_000,
          killerId: ID.enemy,
          monsterType: 'DRAGON',
        },
      ]),
      'me',
    );
    expect(rows.find((r) => r.minute === 10)?.diedJustBefore).toBe(true);
    expect(rows.find((r) => r.minute === 25)?.diedJustBefore).toBe(false);
  });
});

describe('vision timing', () => {
  const ward = (timestamp: number, wardType?: string): TimelineEvent => ({
    type: 'WARD_PLACED',
    timestamp,
    creatorId: ID.me,
    ...(wardType !== undefined ? { wardType } : {}),
  });

  it('excludes a teemo mushroom, which is not vision', () => {
    const vision = visionOf(
      lobby(),
      timeline([ward(60_000, 'SIGHT_WARD'), ward(120_000, 'TEEMO_MUSHROOM')]),
      'me',
    );
    expect(vision?.wardsPlaced).toBe(1);
  });

  it('counts placements whose type Riot did not report, because it is a quarter of them', () => {
    const vision = visionOf(
      lobby(),
      timeline([ward(60_000, 'UNDEFINED'), ward(120_000, 'CONTROL_WARD')]),
      'me',
    );
    expect(vision?.wardsPlaced).toBe(2);
    expect(vision?.unknownType).toBe(1);
    expect(vision?.controlWards).toBe(1);
  });

  it('flags an objective he set no vision for in the preceding minute', () => {
    const vision = visionOf(
      lobby(),
      timeline([
        ward(9 * 60_000 + 30_000, 'SIGHT_WARD'),
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 10 * 60_000,
          monsterType: 'DRAGON',
          killerId: ID.ally,
        },
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 20 * 60_000,
          monsterType: 'BARON_NASHOR',
          killerId: ID.enemy,
        },
      ]),
      'me',
    );
    expect(vision?.beforeObjectives).toBe(1);
    expect(vision?.objectivesWithoutVision).toBe(1);
  });

  it('reports the control-ward gap as NaN with fewer than two of them', () => {
    const vision = visionOf(lobby(), timeline([ward(60_000, 'CONTROL_WARD')]), 'me');
    expect(Number.isNaN(vision?.controlWardGapMinutes ?? 0)).toBe(true);
  });
});

describe('tempo', () => {
  it('skips the opening buy, which lands at ~2s and NOT at timestamp 0', () => {
    // Filtering on `timestamp > 0` returned the fountain purchase, so every first back was
    // reported as minute 0. These are the real timestamps out of the cache.
    const tempo = tempoOf(
      lobby(),
      timeline([
        { type: 'ITEM_PURCHASED', timestamp: 2031, participantId: ID.me, itemId: 1056 },
        { type: 'ITEM_PURCHASED', timestamp: 2465, participantId: ID.me, itemId: 3340 },
        { type: 'ITEM_PURCHASED', timestamp: 156_683, participantId: ID.me, itemId: 1082 },
        { type: 'ITEM_PURCHASED', timestamp: 2100, participantId: ID.enemy, itemId: 1056 },
        { type: 'ITEM_PURCHASED', timestamp: 6 * 60_000, participantId: ID.enemy, itemId: 3020 },
      ]),
      'me',
    );
    expect(tempo?.firstShopMinute).toBe(2);
    expect(tempo?.opponentFirstShopMinute).toBe(6);
    expect(tempo?.purchases).toBe(3);
  });

  it('returns null minutes when he never went back, rather than 0', () => {
    const tempo = tempoOf(
      lobby(),
      timeline([{ type: 'ITEM_PURCHASED', timestamp: 2031, participantId: ID.me, itemId: 1055 }]),
      'me',
    );
    expect(tempo?.firstShopMinute).toBeNull();
  });
});

describe('roams', () => {
  it('classifies a position by its offset from the mid axis', () => {
    expect(zoneOf(7000, 7000)).toBe('mid');
    expect(zoneOf(2000, 12000)).toBe('lado-top');
    expect(zoneOf(12000, 2000)).toBe('lado-bot');
  });

  it('splits sampled minutes by zone and by half', () => {
    const roams = roamsOf(
      lobby(),
      timeline(
        [],
        [
          { x: 3000, y: 3000 }, // mid, own half      (x+y = 6000)
          { x: 7000, y: 7000 }, // mid, own half      (x+y = 14000, just under MAP_MAX = 14820)
          { x: 12000, y: 12000 }, // mid, enemy half  (x+y = 24000)
          { x: 2000, y: 12000 }, // top side, OWN half — deep on the top side is still his half
          { x: 4000, y: 13000 }, // top side, enemy half (x+y = 17000)
        ],
      ),
      'me',
    );
    expect(roams?.minutes).toBe(5);
    expect(roams?.byZone.mid).toBeCloseTo(3 / 5);
    expect(roams?.byZone['lado-top']).toBeCloseTo(2 / 5);
    // The halfway line is the anti-diagonal, not "past the middle of the screen": a position
    // far up the top side can still be on his own half, which is why x+y decides and not x.
    expect(roams?.enemyHalf).toBeCloseTo(2 / 5);
  });

  it('uses per-minute samples only for occupancy, and says how many it had', () => {
    // No positions at all: null rather than a zero-filled split that reads as "always mid".
    expect(roamsOf(lobby(), timeline([{ type: 'LEVEL_UP', timestamp: 0 }]), 'me')).toBeNull();
  });

  it('keeps the halfway line at the anti-diagonal', () => {
    expect(zoneOf(MAP_MAX / 2, MAP_MAX / 2)).toBe('mid');
  });
});

describe('the census', () => {
  it('counts event types, which is how the capability map gets checked', () => {
    const census = eventCensus(
      timeline([
        { type: 'WARD_PLACED', timestamp: 0, creatorId: ID.me },
        { type: 'WARD_PLACED', timestamp: 60_000, creatorId: ID.me },
        { type: 'CHAMPION_KILL', timestamp: 120_000, victimId: ID.me },
      ]),
    );
    expect(census.get('WARD_PLACED')).toBe(2);
    expect(census.get('CHAMPION_KILL')).toBe(1);
  });
});
