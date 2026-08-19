import { beforeEach, describe, expect, it } from 'vitest';
import { completionsOf, itemRace } from '../src/analysis/items.ts';
import { type ItemJson, itemsFromJson, versionForPatch } from '../src/riot/ddragon.ts';
import type { MatchDto, TimelineDto, TimelineEvent } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { catalogFor, catalogForPatch, type ItemCatalog, saveItems } from '../src/store/items.ts';
import { match, participant } from './fixtures.ts';

/**
 * Item timings, the thing M2 cut for want of an item table.
 *
 * What these pin is the arithmetic that decides WHEN a build lands: the undo, the component
 * filter and the per-patch catalogue. The catalogue itself is Riot's data and is not asserted
 * here — `itemsFromJson` is tested on the shapes that decide inclusion, not on real items.
 */

const CATALOG: ItemCatalog = new Map([
  [1001, { name: 'Botas', goldTotal: 300, finished: true }],
  [1026, { name: 'Libro Rúnico Vacío', goldTotal: 850, finished: false }],
  [3100, { name: 'Maldición del Liche', goldTotal: 2900, finished: true }],
  [3089, { name: 'Sombrero de Rabadon', goldTotal: 3600, finished: true }],
  [3157, { name: 'Reloj de Zhonya', goldTotal: 2600, finished: true }],
]);

function lobby(): MatchDto {
  return match({
    matchId: 'LA2_I',
    participants: [
      participant({ puuid: 'me', championName: 'Locke', teamId: 100, teamPosition: 'MIDDLE' }),
      participant({
        puuid: 'enemy-mid',
        championName: 'Akali',
        teamId: 200,
        teamPosition: 'MIDDLE',
      }),
    ],
  });
}

function timeline(events: TimelineEvent[]): TimelineDto {
  return {
    metadata: { matchId: 'LA2_I', participants: ['me', 'enemy-mid'] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: 'enemy-mid' },
      ],
      frames: [
        {
          timestamp: 0,
          participantFrames: {
            '1': { participantId: 1, totalGold: 500 },
            '2': { participantId: 2, totalGold: 500 },
          },
          events,
        },
        {
          timestamp: 1_800_000,
          participantFrames: {
            '1': { participantId: 1, totalGold: 15000 },
            '2': { participantId: 2, totalGold: 15000 },
          },
          events: [],
        },
      ],
    },
  };
}

const buy = (participantId: number, itemId: number, minute: number): TimelineEvent => ({
  type: 'ITEM_PURCHASED',
  timestamp: Math.round(minute * 60_000),
  participantId,
  itemId,
});

const undo = (participantId: number, itemId: number, minute: number): TimelineEvent => ({
  type: 'ITEM_UNDO',
  timestamp: Math.round(minute * 60_000),
  participantId,
  beforeId: itemId,
  afterId: 0,
  goldGain: 2900,
});

describe('completions', () => {
  it('counts only finished items above the stated gold floor', () => {
    const events = [
      buy(1, 1001, 4), // boots: finished but cheap
      buy(1, 1026, 8), // a component
      buy(1, 3100, 11.5),
      buy(1, 3089, 19),
    ];
    const out = completionsOf(timeline(events), 1, CATALOG);
    expect(out.map((c) => c.name)).toEqual(['Maldición del Liche', 'Sombrero de Rabadon']);
    expect(out[0]?.at).toBe('11:30');
    expect(out[0]?.minute).toBeCloseTo(11.5, 6);
  });

  it('drops a purchase that was UNDONE, which would otherwise date the build too early', () => {
    const events = [buy(1, 3100, 11), undo(1, 3100, 11.1), buy(1, 3100, 14)];
    const out = completionsOf(timeline(events), 1, CATALOG);
    expect(out).toHaveLength(1);
    expect(out[0]?.at).toBe('14:00');
  });

  it('undoes only ONE purchase, and only the most recent of that item', () => {
    const events = [buy(1, 3100, 11), buy(1, 3100, 12), undo(1, 3100, 12.1)];
    const out = completionsOf(timeline(events), 1, CATALOG);
    expect(out.map((c) => c.at)).toEqual(['11:00']);
  });

  it('ignores an undo that refunds a SALE rather than a purchase', () => {
    // beforeId 0 and a negative gain: he undid selling something, which buys nothing.
    const events = [
      buy(1, 3100, 11),
      {
        type: 'ITEM_UNDO',
        timestamp: 700_000,
        participantId: 1,
        beforeId: 0,
        afterId: 3100,
        goldGain: -1200,
      },
    ];
    expect(completionsOf(timeline(events), 1, CATALOG)).toHaveLength(1);
  });

  it('never reads another participant purchases', () => {
    const events = [buy(2, 3100, 9), buy(1, 3089, 20)];
    expect(completionsOf(timeline(events), 1, CATALOG).map((c) => c.name)).toEqual([
      'Sombrero de Rabadon',
    ]);
  });
});

describe('the race against the lane opponent', () => {
  it('aligns by ORDER, not by item, and signs the gap so late is positive', () => {
    const race = itemRace(
      lobby(),
      timeline([buy(1, 3100, 12), buy(1, 3089, 21), buy(2, 3157, 10), buy(2, 3100, 18)]),
      'me',
      CATALOG,
    );
    expect(race?.firstGapMinutes).toBeCloseTo(2, 6);
    expect(race?.steps).toHaveLength(2);
    expect(race?.steps[1]?.deltaMinutes).toBeCloseTo(3, 6);
    // Different items on each side is the normal case: two mids rarely build the same thing.
    expect(race?.steps[0]?.mine?.name).toBe('Maldición del Liche');
    expect(race?.steps[0]?.theirs?.name).toBe('Reloj de Zhonya');
  });

  it('reports a step with no counterpart instead of dropping it', () => {
    const race = itemRace(lobby(), timeline([buy(1, 3100, 12), buy(1, 3089, 21)]), 'me', CATALOG);
    expect(race?.steps).toHaveLength(2);
    expect(race?.steps[0]?.theirs).toBeNull();
    expect(race?.steps[0]?.deltaMinutes).toBeNull();
    expect(race?.firstGapMinutes).toBeNull();
  });
});

describe('the catalogue', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  const item = (over: Partial<ItemJson> = {}): ItemJson => ({
    name: 'Algo',
    gold: { total: 2900, purchasable: true },
    tags: ['SpellDamage'],
    maps: { '11': true },
    ...over,
  });

  it('derives `finished` from whether anything builds out of it', () => {
    const items = itemsFromJson('16.16.1', {
      '3100': item({ name: 'Liche' }),
      '1026': item({ name: 'Libro', gold: { total: 850 }, into: ['3100'] }),
    });
    // Order follows the JSON object's own keys, which JavaScript sorts ascending for
    // integer-like ones — so 1026 comes before 3100 whatever order the file listed them in.
    expect(items.map((i) => [i.name, i.finished])).toEqual([
      ['Libro', false],
      ['Liche', true],
    ]);
  });

  it('drops what is not a build step: consumables, trinkets, off-Rift and unbuyable', () => {
    const items = itemsFromJson('16.16.1', {
      '2003': item({ name: 'Poción', tags: ['Consumable'] }),
      '3340': item({ name: 'Tótem', tags: ['Trinket'] }),
      '9999': item({ name: 'De ARAM', maps: { '11': false } }),
      '8888': item({ name: 'No comprable', gold: { total: 2900, purchasable: false } }),
      '7777': item({ name: 'Sin precio', gold: { total: 0 } }),
      '3100': item({ name: 'Liche' }),
    });
    expect(items.map((i) => i.name)).toEqual(['Liche']);
  });

  it('joins a match patch to a Data Dragon version by prefix, and refuses to guess', () => {
    const versions = ['16.16.1', '16.15.1', '16.14.1'];
    expect(versionForPatch(versions, '16.15')).toBe('16.15.1');
    // 16.1 must not match 16.16.1: the dot is part of the join for exactly this reason.
    expect(versionForPatch(versions, '16.1')).toBeNull();
    expect(versionForPatch(versions, '15.24')).toBeNull();
  });

  it('stores one row per item PER VERSION, so a patch cannot borrow another build path', () => {
    saveItems(db, [
      {
        itemId: 3100,
        version: '16.14.1',
        name: 'Liche viejo',
        goldTotal: 3000,
        finished: true,
        tags: '',
      },
      {
        itemId: 3100,
        version: '16.16.1',
        name: 'Liche',
        goldTotal: 2900,
        finished: true,
        tags: '',
      },
    ]);
    expect(catalogFor(db, '16.14.1')?.get(3100)?.goldTotal).toBe(3000);
    expect(catalogFor(db, '16.16.1')?.get(3100)?.goldTotal).toBe(2900);
    expect(catalogForPatch(db, '16.14')?.get(3100)?.name).toBe('Liche viejo');
    // A patch that was never fetched is null, never the nearest table.
    expect(catalogFor(db, '16.15.1')).toBeNull();
    expect(catalogForPatch(db, '16.15')).toBeNull();
  });
});
