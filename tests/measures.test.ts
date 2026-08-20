import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import type { AnalysisSpec } from '../src/analysis/hypotheses.ts';
import {
  evaluateHypothesis,
  evaluationsOf,
  LedgerError,
  registerHypothesis,
} from '../src/analysis/hypotheses.ts';
import { countGapGames, standardMeasure } from '../src/analysis/measures.ts';
import type { MatchDto, TimelineDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch, saveTimeline } from '../src/store/matches.ts';
import { lobby } from './fixtures.ts';

const SPEC: AnalysisSpec = {
  puuid: 'me',
  role: 'MIDDLE',
  queueId: 420,
  minute: 14,
  band: 500,
  outcome: 'binary_win',
  stratum: 'none',
  champion: null,
};

/** One game: his gold lead at 14 and at 20, whether he won, and when it was played. */
type Game = {
  id: string;
  at: number;
  win: boolean;
  lead14: number;
  lead20?: number;
  champion?: string;
};

function twoPlayer(game: Game): MatchDto {
  const raw = lobby({ matchId: game.id, myCsPerMinTarget: 7, win: game.win });
  raw.info.participants = raw.info.participants.filter(
    (p) =>
      p.teamPosition === 'MIDDLE' && (p.puuid === 'me' || p.puuid === `${game.id}-enemy-MIDDLE`),
  );
  for (const p of raw.info.participants) {
    p.win = p.puuid === 'me' ? game.win : !game.win;
    if (p.puuid === 'me' && game.champion !== undefined) p.championName = game.champion;
  }
  raw.metadata.participants = raw.info.participants.map((p) => p.puuid);
  raw.info.gameCreation = game.at;
  return raw;
}

function timelineFor(game: Game): TimelineDto {
  const frames = [
    { minute: 0, mine: 500, theirs: 500 },
    { minute: 14, mine: 6000 + game.lead14, theirs: 6000 },
  ];
  if (game.lead20 !== undefined) {
    frames.push({ minute: 20, mine: 9000 + game.lead20, theirs: 9000 });
  }
  return {
    metadata: { matchId: game.id, participants: ['me', `${game.id}-enemy-MIDDLE`] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: `${game.id}-enemy-MIDDLE` },
      ],
      frames: frames.map((f) => ({
        timestamp: f.minute * 60_000,
        participantFrames: {
          '1': { participantId: 1, totalGold: f.mine, xp: 0, minionsKilled: 0 },
          '2': { participantId: 2, totalGold: f.theirs, xp: 0, minionsKilled: 0 },
        },
      })),
    },
  };
}

function seed(db: Db, games: Game[]): void {
  for (const game of games) {
    const raw = twoPlayer(game);
    saveMatch(db, flattenMatch(raw), raw);
    saveTimeline(db, game.id, timelineFor(game));
  }
}

const WHOLE = { from: 0, until: Number.POSITIVE_INFINITY };

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('the binary conversion gap', () => {
  it('measures his rate from ahead against his opponents from theirs', () => {
    // Ahead in 2, wins 1 => 0.50. Behind in 2, loses both => his opponents converted 2 of 2.
    seed(db, [
      { id: 'LA2_1', at: 10, win: true, lead14: 2000 },
      { id: 'LA2_2', at: 20, win: false, lead14: 2000 },
      { id: 'LA2_3', at: 30, win: false, lead14: -2000 },
      { id: 'LA2_4', at: 40, win: false, lead14: -2000 },
    ]);
    const m = standardMeasure(db)(SPEC, WHOLE);
    expect(m.n).toBe(4);
    expect(m.effect).toBeCloseTo(0.5 - 1);
  });

  it('returns NaN rather than a number when one side of the comparison is empty', () => {
    // Never zero: "no games where he was behind" is not "his opponents never converted".
    seed(db, [{ id: 'LA2_1', at: 10, win: true, lead14: 2000 }]);
    const m = standardMeasure(db)(SPEC, WHOLE);
    expect(Number.isNaN(m.effect)).toBe(true);
  });

  it('honours the frozen band, so a different band is a different measurement', () => {
    seed(db, [
      { id: 'LA2_1', at: 10, win: false, lead14: 600 },
      { id: 'LA2_2', at: 20, win: false, lead14: -600 },
    ]);
    expect(standardMeasure(db)({ ...SPEC, band: 500 }, WHOLE).n).toBe(2);
    // At band 1000 both games are "even", so neither bucket exists.
    expect(standardMeasure(db)({ ...SPEC, band: 1000 }, WHOLE).n).toBe(0);
  });
});

describe('the window', () => {
  const games: Game[] = [
    { id: 'LA2_1', at: 100, win: true, lead14: 2000 },
    { id: 'LA2_2', at: 200, win: false, lead14: -2000 },
    { id: 'LA2_3', at: 300, win: false, lead14: 2000 },
    { id: 'LA2_4', at: 400, win: false, lead14: -2000 },
  ];

  it('is half-open, so the baseline and the test window never share a game', () => {
    seed(db, games);
    const baseline = standardMeasure(db)(SPEC, { from: 0, until: 300 });
    const test = standardMeasure(db)(SPEC, { from: 300, until: Number.POSITIVE_INFINITY });
    expect(baseline.n).toBe(2);
    expect(test.n).toBe(2);
    expect(baseline.n + test.n).toBe(standardMeasure(db)(SPEC, WHOLE).n);
  });

  it('counts the games that fall in a declared gap between the two', () => {
    seed(db, games);
    expect(countGapGames(db, SPEC, 200, 400)).toBe(2);
    expect(countGapGames(db, SPEC, 100, 100)).toBe(0);
  });
});

describe('the continuous outcome', () => {
  it('measures the gold swing over the six minutes after the state', () => {
    // From +2000 at 14 he reaches +2500 at 20: +500. The opponent, from their own +2000,
    // reaches +3000: +1000. So he extends a lead 500 gold less than they do.
    seed(db, [
      { id: 'LA2_1', at: 10, win: true, lead14: 2000, lead20: 2500 },
      { id: 'LA2_2', at: 20, win: false, lead14: -2000, lead20: -3000 },
    ]);
    const m = standardMeasure(db)({ ...SPEC, outcome: 'delta_gold_6min' }, WHOLE);
    expect(m.n).toBe(2);
    expect(m.effect).toBeCloseTo(-500);
  });

  it('drops a game that ended before the window closed instead of extrapolating', () => {
    seed(db, [
      { id: 'LA2_1', at: 10, win: true, lead14: 2000 }, // no minute-20 frame
      { id: 'LA2_2', at: 20, win: false, lead14: -2000, lead20: -3000 },
    ]);
    const m = standardMeasure(db)({ ...SPEC, outcome: 'delta_gold_6min' }, WHOLE);
    expect(m.n).toBe(1);
    expect(Number.isNaN(m.effect)).toBe(true);
  });
});

describe('the champion stratum', () => {
  const spec: AnalysisSpec = {
    ...SPEC,
    champion: 'Diana',
    stratum: 'lane_even_or_behind',
  };

  it('centres a win rate on a coin flip, so the sign is what verdictFor reads', () => {
    // Diana from a neutral-or-behind state: 1 win in 4 => 0.25, centred => -0.25.
    seed(db, [
      { id: 'LA2_1', at: 10, win: true, lead14: 0, champion: 'Diana' },
      { id: 'LA2_2', at: 20, win: false, lead14: 0, champion: 'Diana' },
      { id: 'LA2_3', at: 30, win: false, lead14: -900, champion: 'Diana' },
      { id: 'LA2_4', at: 40, win: false, lead14: -900, champion: 'Diana' },
      { id: 'LA2_5', at: 50, win: true, lead14: 2000, champion: 'Diana' },
      { id: 'LA2_6', at: 60, win: true, lead14: 0, champion: 'Locke' },
    ]);
    const m = standardMeasure(db)(spec, WHOLE);
    expect(m.n).toBe(4);
    expect(m.effect).toBeCloseTo(-0.25);
  });
});

describe('unsupported specs', () => {
  it('throws rather than falling back to a number that means something else', () => {
    expect(() =>
      standardMeasure(db)({ ...SPEC, stratum: 'lane_ahead', outcome: 'delta_gold_6min' }, WHOLE),
    ).toThrow(LedgerError);
  });
});

/**
 * Games the measure could not read at all.
 *
 * `collectStates` has counted these since it was written, under a comment saying they are never
 * dropped silently, and no front-end ever read the field. With `riot_sync` defaulting to
 * `withTimeline: false` the case is not exotic: a synced game with no timeline has no lane
 * state, so it is absent from `n` and from everything else, and `n` cannot say so — `n` counts
 * what the measure used, never what it wanted.
 */
describe('las partidas que no se pudieron leer', () => {
  const GAMES: Game[] = [
    { id: 'LA2_U1', at: 10, win: true, lead14: 2000 },
    { id: 'LA2_U2', at: 20, win: false, lead14: 2000 },
    { id: 'LA2_U3', at: 30, win: false, lead14: -2000 },
    { id: 'LA2_U4', at: 40, win: true, lead14: -2000 },
  ];

  it('counts a game with no timeline instead of dropping it out of the world', () => {
    seed(db, GAMES);
    // One game loses its timeline: cached, played, inside the window, and invisible.
    db.prepare('DELETE FROM timelines WHERE match_id = ?').run('LA2_U1');

    const m = standardMeasure(db)(SPEC, WHOLE);

    expect(m.unreadable).toBe(1);
    // And it really is missing from the measurement, which is the point: n counts what the
    // measure USED, so it cannot be the thing that reports what it could not read.
    expect(m.n).toBe(3);
  });

  it('reports zero when every game in the window could be read', () => {
    seed(db, GAMES);
    expect(standardMeasure(db)(SPEC, WHOLE).unreadable ?? 0).toBe(0);
  });

  it('carries the count onto the evaluation, where somebody actually reads it', () => {
    seed(db, GAMES);
    db.prepare('DELETE FROM timelines WHERE match_id = ?').run('LA2_U1');

    registerHypothesis(db, {
      id: 'sin_timeline',
      claim: 'da igual: lo que se prueba es el contador',
      direction: 'lower',
      spec: SPEC,
      baselineUntil: 1,
      testFrom: 1,
      gapGames: 0,
      baselineN: 10,
      baselineEffect: -0.1,
      nNeeded: 300,
      caveat: 'ninguna, es un test',
    });

    const evaluation = evaluateHypothesis(db, 'sin_timeline', SPEC, standardMeasure(db));
    expect(evaluation.unreadable).toBe(1);
    // NOT persisted: it describes the cache today, and `lol backfill` changes it. A stored
    // history of it would go stale and be read as though it had not.
    expect(evaluationsOf(db, 'sin_timeline')[0]?.unreadable).toBe(0);
  });
});
