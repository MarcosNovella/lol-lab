import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import {
  collectMatchups,
  MATCHUP_CSV_HEADER,
  matchupsToCsv,
  repsAcrossAccounts,
} from '../src/analysis/matchups.ts';
import type { MatchDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch, upsertAccount } from '../src/store/matches.ts';
import { match, participant } from './fixtures.ts';

type Game = {
  id: string;
  puuid: string;
  champion: string;
  opponent: string;
  win: boolean;
  at: number;
  queueId?: number;
  role?: string;
};

function game(g: Game): MatchDto {
  const role = g.role ?? 'MIDDLE';
  return match({
    matchId: g.id,
    queueId: g.queueId ?? 420,
    gameCreation: g.at,
    participants: [
      participant({
        puuid: g.puuid,
        championName: g.champion,
        teamId: 100,
        teamPosition: role,
        win: g.win,
      }),
      participant({
        puuid: `${g.id}-enemy`,
        championName: g.opponent,
        teamId: 200,
        teamPosition: role,
        win: !g.win,
      }),
    ],
  });
}

function seed(db: Db, games: Game[]): void {
  for (const g of games) {
    const raw = game(g);
    saveMatch(db, flattenMatch(raw), raw);
  }
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertAccount(db, {
    puuid: 'p-smurf',
    gameName: 'LegendofTorcuato',
    tagLine: 'LAS',
    platform: 'la2',
    label: 'smurf',
  });
  upsertAccount(db, {
    puuid: 'p-main',
    gameName: 'LaMarso',
    tagLine: 'LAS',
    platform: 'la2',
    label: 'main',
  });
});

describe('the matchup record splits by account', () => {
  it('never merges two accounts into one row, even for the same matchup', () => {
    seed(db, [
      { id: 'LA2_1', puuid: 'p-smurf', champion: 'Locke', opponent: 'Akali', win: true, at: 10 },
      { id: 'LA2_2', puuid: 'p-smurf', champion: 'Locke', opponent: 'Akali', win: false, at: 20 },
      { id: 'LA2_3', puuid: 'p-main', champion: 'Locke', opponent: 'Akali', win: false, at: 30 },
    ]);
    const rows = collectMatchups(db);
    const locke = rows.filter((r) => r.champion === 'Locke' && r.opponent === 'Akali');
    expect(locke).toHaveLength(2);
    expect(locke.map((r) => [r.account, r.games, r.wins])).toEqual([
      ['main', 1, 0],
      ['smurf', 2, 1],
    ]);
  });

  it('keeps queues apart too, so soloq and flex never share a counter', () => {
    seed(db, [
      { id: 'LA2_1', puuid: 'p-smurf', champion: 'Yone', opponent: 'Ahri', win: true, at: 10 },
      {
        id: 'LA2_2',
        puuid: 'p-smurf',
        champion: 'Yone',
        opponent: 'Ahri',
        win: false,
        at: 20,
        queueId: 440,
      },
    ]);
    const rows = collectMatchups(db).filter((r) => r.champion === 'Yone');
    expect(rows.map((r) => [r.queue, r.games])).toEqual([
      ['flex', 1],
      ['soloq', 1],
    ]);
  });

  it('pools REPS across accounts, because experience is knowledge', () => {
    seed(db, [
      { id: 'LA2_1', puuid: 'p-smurf', champion: 'Locke', opponent: 'Akali', win: true, at: 10 },
      { id: 'LA2_2', puuid: 'p-main', champion: 'Locke', opponent: 'Akali', win: false, at: 20 },
    ]);
    expect(repsAcrossAccounts(collectMatchups(db), 'Locke', 'Akali')).toBe(2);
  });

  it('tracks when the matchup was first and last seen', () => {
    seed(db, [
      { id: 'LA2_1', puuid: 'p-smurf', champion: 'Diana', opponent: 'Zoe', win: true, at: 300 },
      { id: 'LA2_2', puuid: 'p-smurf', champion: 'Diana', opponent: 'Zoe', win: true, at: 100 },
    ]);
    const row = collectMatchups(db)[0];
    expect(row?.first).toBe(100);
    expect(row?.last).toBe(300);
  });

  it('drops a game with no mirror in the lane rather than inventing an opponent', () => {
    const raw = match({
      matchId: 'LA2_SOLO',
      participants: [
        participant({
          puuid: 'p-smurf',
          championName: 'Locke',
          teamId: 100,
          teamPosition: 'MIDDLE',
        }),
        participant({ puuid: 'other', championName: 'Nasus', teamId: 200, teamPosition: 'TOP' }),
      ],
    });
    saveMatch(db, flattenMatch(raw), raw);
    expect(collectMatchups(db)).toHaveLength(0);
  });
});

describe('the CSV the vault reads', () => {
  it('carries the account column, which is the whole reason it exists', () => {
    seed(db, [
      { id: 'LA2_1', puuid: 'p-smurf', champion: 'Locke', opponent: 'Akali', win: true, at: 0 },
    ]);
    const csv = matchupsToCsv(collectMatchups(db));
    expect(csv.split('\n')[0]).toBe(MATCHUP_CSV_HEADER);
    expect(csv).toContain('Locke,Akali,mid,smurf,soloq,1,1,1970-01-01,1970-01-01');
  });

  it('quotes a value containing a comma instead of splitting the row', () => {
    seed(db, [
      {
        id: 'LA2_1',
        puuid: 'p-smurf',
        champion: 'Nunu & Willump',
        opponent: 'A,B',
        win: true,
        at: 0,
      },
    ]);
    expect(matchupsToCsv(collectMatchups(db))).toContain('"A,B"');
  });
});
