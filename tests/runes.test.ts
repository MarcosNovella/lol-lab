import { describe, expect, it } from 'vitest';
import { CLASES, clasesDe, porClaseRival, sinClasificar } from '../src/analysis/classes.ts';
import {
  byKeystone,
  keystoneOf,
  runeDuelOf,
  secondaryTreeOf,
  unreadableKeystones,
} from '../src/analysis/runes.ts';
import { championsFromJson, runesFromJson } from '../src/riot/ddragon.ts';
import type { ParticipantDto } from '../src/riot/types.ts';
import type { ChampionCatalog, RuneCatalog } from '../src/store/items.ts';
import { match, participant } from './fixtures.ts';

/**
 * Runes and champion classes.
 *
 * Both dimensions were already in the cache with nothing reading them: the perks have been in
 * every match payload since the first sync (ADR-004 kept the whole thing), and the classes are
 * one Data Dragon table. Neither costs a Riot request.
 */

const CATALOG: RuneCatalog = new Map([
  [
    8112,
    {
      key: 'Electrocute',
      name: 'Electrocutar',
      treeId: 8100,
      treeName: 'Dominación',
      slot: 0,
      icon: 'a.png',
    },
  ],
  [
    8010,
    {
      key: 'Conqueror',
      name: 'Conquistador',
      treeId: 8000,
      treeName: 'Precisión',
      slot: 0,
      icon: 'b.png',
    },
  ],
  // NOT a keystone: slot 1. It is in the same tree and a naive reader would take it for one.
  [
    8143,
    {
      key: 'SuddenImpact',
      name: 'Impacto Súbito',
      treeId: 8100,
      treeName: 'Dominación',
      slot: 1,
      icon: 'c.png',
    },
  ],
]);

function conPerks(over: Partial<ParticipantDto> & { puuid: string }, keystone: number | null) {
  const p = participant(over);
  if (keystone !== null) {
    p.perks = {
      styles: [
        {
          description: 'primaryStyle',
          style: 8100,
          selections: [{ perk: keystone }, { perk: 8143 }],
        },
        { description: 'subStyle', style: 8200, selections: [{ perk: 8210 }] },
      ],
    };
  }
  return p;
}

describe('el keystone', () => {
  it('reads the first selection of the primary tree', () => {
    const k = keystoneOf(conPerks({ puuid: 'me' }, 8112), CATALOG);
    expect(k?.key).toBe('Electrocute');
    expect(k?.treeName).toBe('Dominación');
  });

  it('refuses a rune that is not in slot 0, however primary its tree is', () => {
    // Slot 0 of a tree holds its keystones and NOTHING else, which is what makes a keystone
    // identifiable without a hardcoded id list that goes stale every preseason.
    expect(keystoneOf(conPerks({ puuid: 'me' }, 8143), CATALOG)).toBeNull();
  });

  it('answers null for a payload with no perks rather than inventing one', () => {
    expect(keystoneOf(conPerks({ puuid: 'me' }, null), CATALOG)).toBeNull();
  });

  it('answers null for a perk this patch catalogue does not know', () => {
    // The patch's own catalogue is the only authority on what a rune id meant that patch.
    expect(keystoneOf(conPerks({ puuid: 'me' }, 99999), CATALOG)).toBeNull();
  });

  it('carries the secondary tree, which is a choice too', () => {
    expect(secondaryTreeOf(conPerks({ puuid: 'me' }, 8112))).toBe(8200);
    expect(secondaryTreeOf(conPerks({ puuid: 'me' }, null))).toBeNull();
  });
});

describe('el duelo de runas', () => {
  const duelo = (mine: number | null, theirs: number | null, win = true) =>
    runeDuelOf(
      match({
        matchId: 'LA2_R1',
        participants: [
          conPerks(
            { puuid: 'me', teamId: 100, teamPosition: 'MIDDLE', win, championName: 'Diana' },
            mine,
          ),
          conPerks(
            { puuid: 'rival', teamId: 200, teamPosition: 'MIDDLE', win: !win, championName: 'Zed' },
            theirs,
          ),
        ],
      }),
      'me',
      CATALOG,
    );

  it('pairs him with the SAME-ROLE opponent, which is the peer this project always uses', () => {
    const d = duelo(8112, 8010);
    expect(d?.mine?.key).toBe('Electrocute');
    expect(d?.theirs?.key).toBe('Conqueror');
    expect(d?.opponentChampion).toBe('Zed');
  });

  it('returns the row with an explicit null instead of dropping a game it could half-read', () => {
    // Dropping it would silently shrink the sample; the null is what lets the caller COUNT it.
    const d = duelo(8112, null);
    expect(d?.mine).not.toBeNull();
    expect(d?.theirs).toBeNull();
    expect(unreadableKeystones([d as NonNullable<typeof d>])).toEqual({ mias: 0, suyas: 1 });
  });

  it('refuses a game with no role, the same way every other comparison here does (G-004)', () => {
    const m = match({
      participants: [conPerks({ puuid: 'me', teamPosition: '', teamId: 100 }, 8112)],
    });
    expect(runeDuelOf(m, 'me', CATALOG)).toBeNull();
  });
});

describe('la tabla por keystone', () => {
  const fila = (mine: string, win: boolean) => ({
    matchId: 'x' + Math.random(),
    gameCreation: 0,
    win,
    champion: 'Diana',
    opponentChampion: 'Zed',
    mine: { runeId: 1, key: mine, name: mine, treeId: 1, treeName: 'T', icon: '' },
    theirs: {
      runeId: 2,
      key: 'Conqueror',
      name: 'Conquistador',
      treeId: 2,
      treeName: 'P',
      icon: '',
    },
  });

  it('carries the rune id, which is the name its downloaded icon is stored under', () => {
    // It did not, and the panel built every icon URL as /img/rune/undefined.png: seventeen
    // 404s, and the fallback quietly removed every image, so the table just had no pictures.
    const rows = byKeystone([fila('Electrocute', true)]);
    expect(rows[0]?.runeId).toBe(1);
  });

  it('counts games and wins per keystone', () => {
    const rows = byKeystone([
      fila('Electrocute', true),
      fila('Electrocute', false),
      fila('DarkHarvest', true),
    ]);
    expect(rows[0]?.key).toBe('Electrocute');
    expect(rows[0]).toMatchObject({ jugadas: 2, ganadas: 1 });
    expect(rows[0]?.winRate).toBeCloseTo(0.5);
  });

  it('reads the OPPONENT column from his perspective, not theirs', () => {
    // "Games where the opponent ran Conqueror and I won" is the useful question; the other one
    // is just its complement and would read as though it measured the opponent.
    const rows = byKeystone([fila('Electrocute', true), fila('Electrocute', true)], 'theirs');
    expect(rows[0]?.key).toBe('Conqueror');
    expect(rows[0]?.ganadas).toBe(2);
  });

  it('never reports a rate of zero for a keystone it has no games of', () => {
    expect(byKeystone([])).toEqual([]);
  });
});

describe('las clases del rival', () => {
  const CHAMPS: ChampionCatalog = new Map([
    ['diana', { name: 'Diana', title: '', tags: ['Fighter', 'Assassin'] }],
    ['zed', { name: 'Zed', title: '', tags: ['Assassin'] }],
    ['leblanc', { name: 'LeBlanc', title: '', tags: ['Assassin', 'Mage'] }],
  ]);

  it('finds a champion whose two sources spell it differently (G-016)', () => {
    // Riot's match payload says `LeBlanc`; Data Dragon says `Leblanc`. One capital apart, and a
    // raw lookup returned undefined for her — she came back unclassified on real data.
    expect(clasesDe('LeBlanc', CHAMPS)).toEqual(['Assassin', 'Mage']);
    expect(clasesDe('Leblanc', CHAMPS)).toEqual(['Assassin', 'Mage']);
  });

  it('keeps BOTH classes rather than inventing a primary', () => {
    expect(clasesDe('Diana', CHAMPS)).toEqual(['Fighter', 'Assassin']);
  });

  it('counts a two-class champion in both rows, so the rows do not sum to the game count', () => {
    const filas = porClaseRival(
      [
        { win: true, opponentChampion: 'Diana' },
        { win: false, opponentChampion: 'Zed' },
      ],
      CHAMPS,
    );
    const asesino = filas.find((f) => f.clase === 'Assassin');
    const luchador = filas.find((f) => f.clase === 'Fighter');
    expect(asesino?.jugadas).toBe(2);
    expect(luchador?.jugadas).toBe(1);
    // Two games, three row-entries. There is no honest alternative — dropping a champion's
    // second class is an invention — so the panel states it instead of hiding it.
    expect(filas.reduce((n, f) => n + f.jugadas, 0)).toBe(3);
  });

  it('counts what it could not classify instead of leaving it out of the total', () => {
    const juegos = [
      { win: true, opponentChampion: 'Zed' },
      { win: true, opponentChampion: null },
      { win: false, opponentChampion: 'NoExisteEsteCampeon' },
    ];
    expect(sinClasificar(juegos, CHAMPS)).toBe(2);
  });

  it('only admits the six classes Riot actually publishes', () => {
    expect(CLASES).toHaveLength(6);
    const raro: ChampionCatalog = new Map([['x', { name: 'X', title: '', tags: ['Juggernaut'] }]]);
    expect(clasesDe('X', raro)).toEqual([]);
  });
});

describe('los catálogos de Data Dragon', () => {
  it('flattens the tree-of-slots-of-runes shape and marks keystones by their slot', () => {
    const runes = runesFromJson('16.16.1', [
      {
        id: 8100,
        key: 'Domination',
        name: 'Dominación',
        slots: [
          { runes: [{ id: 8112, key: 'Electrocute', name: 'Electrocutar', icon: 'a.png' }] },
          { runes: [{ id: 8143, key: 'SuddenImpact', name: 'Impacto', icon: 'b.png' }] },
        ],
      },
    ]);
    expect(runes).toHaveLength(2);
    expect(runes.filter((r) => r.slot === 0).map((r) => r.key)).toEqual(['Electrocute']);
    expect(runes[0]?.treeName).toBe('Dominación');
  });

  it('reads a champion id as a number and keeps its classes joined', () => {
    const champs = championsFromJson('16.16.1', {
      Diana: { key: '131', id: 'Diana', name: 'Diana', title: 'x', tags: ['Fighter', 'Assassin'] },
      Roto: { key: 'no-es-un-numero', id: 'Roto', name: 'Roto' },
    });
    expect(champs).toHaveLength(1);
    expect(champs[0]).toMatchObject({ championId: 131, key: 'Diana', tags: 'Fighter,Assassin' });
  });
});
