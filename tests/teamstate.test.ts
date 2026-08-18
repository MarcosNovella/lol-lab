import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { drift, growthCurve } from '../src/analysis/growth.ts';
import type { GrowthSpec, TeamStateSpec } from '../src/analysis/hypotheses.ts';
import { specHash } from '../src/analysis/hypotheses.ts';
import { countGapGames, standardMeasure } from '../src/analysis/measures.ts';
import { laneStateAt } from '../src/analysis/state.ts';
import type { MatchDto, ParticipantDto, TimelineDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch, saveTimeline } from '../src/store/matches.ts';
import { participant } from './fixtures.ts';

/**
 * A3 and the two spec shapes it unblocked.
 *
 * The fixture is a full ten-player lobby, which the older measure fixtures are not: with two
 * players the team totals ARE the lane pair, so `restOfTeamGoldDiff` is identically zero and
 * every assertion about it would pass for the wrong reason.
 */

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

type Game = {
  id: string;
  at: number;
  win: boolean;
  /** His gold minus the enemy mid's, at the measured minute. */
  laneLead: number;
  /** His four teammates' gold minus the four enemies', at the same minute. */
  restLead: number;
  /** His `laneMinionsFirst10Minutes`, and his lane opponent's. */
  myCs10?: number;
  theirCs10?: number;
};

/** participantId 1 = him, 2 = enemy mid, 3-6 = his allies, 7-10 = the other enemies. */
function idOf(role: string, mine: boolean): number {
  if (role === 'MIDDLE') return mine ? 1 : 2;
  const rest = (ROLES as readonly string[]).filter((r) => r !== 'MIDDLE').indexOf(role);
  return (mine ? 3 : 7) + rest;
}

function puuidOf(game: Game, role: string, mine: boolean): string {
  if (role === 'MIDDLE' && mine) return 'me';
  return `${game.id}-${mine ? 'ally' : 'enemy'}-${role}`;
}

function lobbyOf(game: Game): MatchDto {
  const players: ParticipantDto[] = [];
  for (const role of ROLES) {
    for (const mine of [true, false]) {
      const isHim = role === 'MIDDLE' && mine;
      const cs10 = isHim ? game.myCs10 : role === 'MIDDLE' ? game.theirCs10 : undefined;
      players.push(
        participant({
          puuid: puuidOf(game, role, mine),
          teamId: mine ? 100 : 200,
          teamPosition: role,
          win: mine ? game.win : !game.win,
          ...(cs10 !== undefined
            ? {
                challenges: {
                  killParticipation: 0.5,
                  teamDamagePercentage: 0.25,
                  soloKills: 1,
                  turretPlatesTaken: 2,
                  laneMinionsFirst10Minutes: cs10,
                  maxCsAdvantageOnLaneOpponent: 12,
                  earlyLaningPhaseGoldExpAdvantage: 1,
                  laningPhaseGoldExpAdvantage: 1,
                },
              }
            : {}),
        }),
      );
    }
  }
  return {
    metadata: { matchId: game.id, participants: players.map((p) => p.puuid) },
    info: {
      gameCreation: game.at,
      gameDuration: 1800,
      gameStartTimestamp: game.at,
      gameEndTimestamp: game.at + 1800 * 1000,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      gameVersion: '16.16.700.1234',
      mapId: 11,
      queueId: 420,
      platformId: 'LA2',
      participants: players,
      teams: [
        { teamId: 100, win: game.win },
        { teamId: 200, win: !game.win },
      ],
    },
  };
}

const MINUTE = 14;

function timelineOf(game: Game): TimelineDto {
  // Four teammates share `restLead` equally, so the rest-of-team difference is exactly it.
  const perAlly = 5000 + game.restLead / 4;
  const frame = (minute: number): TimelineDto['info']['frames'][number] => {
    const frames: Record<string, { participantId: number; totalGold: number; xp: number }> = {};
    for (const role of ROLES) {
      for (const mine of [true, false]) {
        const id = idOf(role, mine);
        const gold =
          role === 'MIDDLE' ? (mine ? 6000 + game.laneLead : 6000) : mine ? perAlly : 5000;
        frames[String(id)] = { participantId: id, totalGold: gold, xp: 0 };
      }
    }
    return { timestamp: minute * 60_000, participantFrames: frames };
  };
  return {
    metadata: { matchId: game.id, participants: ROLES.flatMap((r) => [r, r]).map(() => '') },
    info: {
      frameInterval: 60_000,
      participants: ROLES.flatMap((role) =>
        [true, false].map((mine) => ({
          participantId: idOf(role, mine),
          puuid: puuidOf(game, role, mine),
        })),
      ),
      frames: [frame(0), frame(MINUTE)],
    },
  };
}

function seed(db: Db, game: Game): void {
  const raw = lobbyOf(game);
  saveMatch(db, flattenMatch(raw), raw);
  saveTimeline(db, game.id, timelineOf(game));
}

const TEAM_SPEC: TeamStateSpec = {
  puuid: 'me',
  role: 'MIDDLE',
  queueId: 420,
  minute: MINUTE,
  band: 500,
  teamBand: 500,
};

// These two read the state straight from the fixture: no store round-trip is involved, so the
// arithmetic is checked where it happens rather than through two layers that could cancel out.
describe('A3 — team gold net of his own lane pair', () => {
  it('removes the lane pair from the team difference', () => {
    const game: Game = { id: 'LA2_A', at: 1000, win: true, laneLead: 2000, restLead: -800 };
    const state = laneStateAt(lobbyOf(game), timelineOf(game), 'me', MINUTE);

    expect(state?.goldDiff).toBe(2000);
    // Team total still contains him: 2000 of lane lead plus 800 of team deficit.
    expect(state?.teamGoldDiff).toBe(1200);
    // Net of the pair, his team is BEHIND — the opposite sign, on the same game.
    expect(state?.restOfTeamGoldDiff).toBe(-800);
  });

  it('is the identity that motivated it: teamGoldDiff minus goldDiff', () => {
    const game: Game = { id: 'LA2_B', at: 1000, win: false, laneLead: -1500, restLead: 2400 };
    const state = laneStateAt(lobbyOf(game), timelineOf(game), 'me', MINUTE);
    expect(state?.restOfTeamGoldDiff).toBe((state?.teamGoldDiff ?? 0) - (state?.goldDiff ?? 0));
  });
});

describe('team_state measure', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('compares wins from lane-ahead by the state of the REST of the team', () => {
    // Lane-ahead every game. Team ahead: 2 of 3 won. Team behind: 0 of 2 won.
    seed(db, { id: 'LA2_1', at: 1000, win: true, laneLead: 2000, restLead: 2000 });
    seed(db, { id: 'LA2_2', at: 2000, win: true, laneLead: 2000, restLead: 2000 });
    seed(db, { id: 'LA2_3', at: 3000, win: false, laneLead: 2000, restLead: 2000 });
    seed(db, { id: 'LA2_4', at: 4000, win: false, laneLead: 2000, restLead: -2000 });
    seed(db, { id: 'LA2_5', at: 5000, win: false, laneLead: 2000, restLead: -2000 });

    const result = standardMeasure(db)(TEAM_SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    expect(result.n).toBe(5);
    expect(result.effect).toBeCloseTo(2 / 3 - 0, 10);
  });

  it('ignores games where he is not ahead in lane', () => {
    seed(db, { id: 'LA2_1', at: 1000, win: true, laneLead: 2000, restLead: 2000 });
    seed(db, { id: 'LA2_2', at: 2000, win: false, laneLead: 2000, restLead: -2000 });
    // Behind in lane: outside the question entirely, whatever the team is doing.
    seed(db, { id: 'LA2_3', at: 3000, win: true, laneLead: -3000, restLead: 4000 });

    expect(standardMeasure(db)(TEAM_SPEC, { from: 0, until: Number.POSITIVE_INFINITY }).n).toBe(2);
  });

  it('returns NaN, not zero, when one side of the comparison is empty', () => {
    seed(db, { id: 'LA2_1', at: 1000, win: true, laneLead: 2000, restLead: 2000 });
    const result = standardMeasure(db)(TEAM_SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    expect(result.n).toBe(1);
    // G-005: "no games behind" is not "no difference".
    expect(Number.isNaN(result.effect)).toBe(true);
  });

  it('counts the declared hole in lane states, the same unit the measure uses', () => {
    seed(db, { id: 'LA2_1', at: 1000, win: true, laneLead: 2000, restLead: 2000 });
    seed(db, { id: 'LA2_2', at: 2000, win: false, laneLead: 2000, restLead: -2000 });
    seed(db, { id: 'LA2_3', at: 3000, win: true, laneLead: 2000, restLead: 2000 });
    expect(countGapGames(db, TEAM_SPEC, 1500, 2500)).toBe(1);
  });
});

describe('growth_drift measure', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('measures the drift of the GAP, not of his own line', () => {
    // His CS@10 falls 80 -> 74 while his opponents' falls 60 -> 50. His line is going down and
    // he is nevertheless gaining on the lobby: the gap must come out POSITIVE.
    const games = [
      { my: 80, their: 60 },
      { my: 78, their: 56 },
      { my: 76, their: 53 },
      { my: 74, their: 50 },
    ];
    games.forEach((g, i) => {
      seed(db, {
        id: `LA2_G${i}`,
        at: 1000 + i * 1000,
        win: true,
        laneLead: 0,
        restLead: 0,
        myCs10: g.my,
        theirCs10: g.their,
      });
    });

    const spec: GrowthSpec = {
      puuid: 'me',
      role: 'MIDDLE',
      queueId: 420,
      metricKey: 'cs_first_10',
      rollingGames: 1,
    };
    const result = standardMeasure(db)(spec, { from: 0, until: Number.POSITIVE_INFINITY });

    expect(result.n).toBe(4);
    expect(result.effect).toBeGreaterThan(0);

    // And it is exactly the difference of the two drifts the curve reports, computed by the
    // same `drift` the growth command uses rather than by a second copy of the arithmetic.
    const curve = growthCurve(db, {
      puuid: 'me',
      accountLabel: 'me',
      metricKey: 'cs_first_10',
      role: 'MIDDLE',
      queueId: 420,
      window: 1,
    });
    expect(result.effect).toBeCloseTo(
      drift(curve.points, (p) => p.mineRolling) - drift(curve.points, (p) => p.theirsRolling),
      10,
    );
  });

  it('honours the ledger window instead of spanning baseline and test', () => {
    for (let i = 0; i < 6; i += 1) {
      seed(db, {
        id: `LA2_W${i}`,
        at: 1000 + i * 1000,
        win: true,
        laneLead: 0,
        restLead: 0,
        myCs10: 70 + i,
        theirCs10: 60,
      });
    }
    const spec: GrowthSpec = {
      puuid: 'me',
      role: 'MIDDLE',
      queueId: 420,
      metricKey: 'cs_first_10',
      rollingGames: 1,
    };
    // `until` is exclusive: games at 4000 and later belong to the other side of the boundary.
    expect(standardMeasure(db)(spec, { from: 0, until: 4000 }).n).toBe(3);
    expect(standardMeasure(db)(spec, { from: 4000, until: Number.POSITIVE_INFINITY }).n).toBe(3);
  });
});

describe('the ledger absorbs new shapes without disturbing the old ones', () => {
  it('gives each shape its own hash and leaves the pinned one untouched', () => {
    const lane = specHash({
      puuid: 'p-smurf',
      role: 'MIDDLE',
      queueId: 420,
      minute: 14,
      band: 500,
      outcome: 'binary_win',
      stratum: 'none',
      champion: null,
    });
    // The value pinned in hypotheses.test.ts, restated here so that adding a shape has to break
    // BOTH tests to slip through. Registered hypotheses carry their hash in the database and
    // become permanently unevaluatable if it moves (G-013).
    expect(lane).toBe('1b634e6e9e5c69f0');

    const team = specHash(TEAM_SPEC);
    const growth = specHash({
      puuid: 'p-smurf',
      role: 'MIDDLE',
      queueId: 420,
      metricKey: 'cs_first_10',
      rollingGames: 10,
    });
    expect(new Set([lane, team, growth]).size).toBe(3);
  });

  it('changes the team hash when either band moves', () => {
    const base = specHash(TEAM_SPEC);
    expect(specHash({ ...TEAM_SPEC, band: 750 })).not.toBe(base);
    // The knob the earlier version of this question did not have at all.
    expect(specHash({ ...TEAM_SPEC, teamBand: 750 })).not.toBe(base);
  });
});
