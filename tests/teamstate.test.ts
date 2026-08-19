import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { drift, type GrowthPoint, growthCurve, trendSlope } from '../src/analysis/growth.ts';
import type { GrowthSpec, PhaseSpec, TeamStateSpec } from '../src/analysis/hypotheses.ts';
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
  /** Minutes at which HE dies, for the phase measure. Empty by default. */
  deathMinutes?: number[];
  /** Last whole minute the game reaches. Defaults to the measured minute, as before. */
  endMinute?: number;
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
  // Frames run to `endMinute` so the phase measure can read the game's real extent from the last
  // frame's TIMESTAMP (G-017). Default is the measured minute, which is what every test that
  // predates the phase spec was already getting.
  const end = game.endMinute ?? MINUTE;
  const frames = [frame(0), frame(MINUTE)];
  for (let minute = MINUTE + 1; minute <= end; minute += 1) frames.push(frame(minute));
  const deaths = (game.deathMinutes ?? []).map((minute) => ({
    type: 'CHAMPION_KILL',
    timestamp: Math.round(minute * 60_000),
    killerId: 2,
    victimId: 1,
    bounty: 300,
    position: { x: 7000, y: 7000 },
  }));
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
      frames:
        deaths.length === 0
          ? frames
          : frames.map((f, i) => (i === 0 ? { ...f, events: deaths } : f)),
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

    // And it is exactly the difference of the two fitted slopes, computed by the same
    // `trendSlope` the ledger uses rather than by a second copy of the arithmetic.
    const curve = growthCurve(db, {
      puuid: 'me',
      accountLabel: 'me',
      metricKey: 'cs_first_10',
      role: 'MIDDLE',
      queueId: 420,
      window: 1,
    });
    expect(result.effect).toBeCloseTo(
      trendSlope(curve.points, (p) => p.mineRolling) -
        trendSlope(curve.points, (p) => p.theirsRolling),
      10,
    );
  });

  it('fits every point, so one more game cannot multiply the effect (G-025)', () => {
    // His gap is flat at +20 for nine games and then one game lands at +2. The endpoint reading
    // charges the whole 18-point fall to the series and reports a slope; the fitted line sees
    // nine points saying "flat" and one saying "not". This is the real 36-vs-39-game swing in
    // miniature, and it is why the ledger measure fits rather than subtracts.
    const gaps = [20, 20, 20, 20, 20, 20, 20, 20, 20, 2];
    gaps.forEach((gap, i) => {
      seed(db, {
        id: `LA2_S${i}`,
        at: 1000 + i * 1000,
        win: true,
        laneLead: 0,
        restLead: 0,
        myCs10: 60 + gap,
        theirCs10: 60,
      });
    });

    const curve = growthCurve(db, {
      puuid: 'me',
      accountLabel: 'me',
      metricKey: 'cs_first_10',
      role: 'MIDDLE',
      queueId: 420,
      window: 1,
    });
    const gapOf = (p: GrowthPoint): number => p.mineRolling - p.theirsRolling;

    // Endpoints only: (2 - 20) / 9 = -2 per game, as if every game had shed two CS.
    expect(drift(curve.points, gapOf)).toBeCloseTo(-2, 10);
    // Fitted: the same fall, spread over ten points that mostly disagree with it.
    const fitted = trendSlope(curve.points, gapOf);
    expect(fitted).toBeGreaterThan(-1);
    expect(Math.abs(fitted)).toBeLessThan(Math.abs(drift(curve.points, gapOf)) / 2);
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

describe('phase_death_rate measure', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  const SPEC: PhaseSpec = {
    puuid: 'me',
    role: 'MIDDLE',
    queueId: 420,
    gateMinute: MINUTE,
    band: 500,
    fromMinute: 14,
    toMinute: 25,
    deathsPer10Threshold: 2,
  };

  it('splits games by deaths per ten minutes and compares win rates', () => {
    // Four games reaching minute 25 from a lane lead. Eleven minutes of phase, so the 2-per-10
    // threshold falls between 2 deaths (1.8) and 3 (2.7).
    seed(db, {
      id: 'LA2_P1',
      at: 1000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [16, 20],
    });
    seed(db, {
      id: 'LA2_P2',
      at: 2000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [17],
    });
    seed(db, {
      id: 'LA2_P3',
      at: 3000,
      win: false,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [15, 18, 21, 23],
    });
    seed(db, {
      id: 'LA2_P4',
      at: 4000,
      win: false,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [16, 19, 22],
    });

    const result = standardMeasure(db)(SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    expect(result.n).toBe(4);
    // Low-death games 2/2, high-death 0/2.
    expect(result.effect).toBeCloseTo(1, 10);
  });

  it('counts only deaths inside the phase', () => {
    // Same four deaths, all of them OUTSIDE 14-25: the game reads as low-death.
    seed(db, {
      id: 'LA2_Q1',
      at: 1000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 30,
      deathMinutes: [3, 7, 11, 27],
    });
    seed(db, {
      id: 'LA2_Q2',
      at: 2000,
      win: false,
      laneLead: 2000,
      restLead: 0,
      endMinute: 30,
      deathMinutes: [15, 17, 19, 21],
    });

    const result = standardMeasure(db)(SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    expect(result.n).toBe(2);
    expect(result.effect).toBeCloseTo(1, 10);
  });

  it('divides by the minutes the game REACHED, not by the phase on paper', () => {
    // Two deaths in a game that ends at 19: five minutes of phase, so 4.0 per ten minutes and
    // HIGH. The same two deaths over a full eleven minutes would be 1.8 and low, which is the
    // duration artefact the rate exists to remove.
    seed(db, {
      id: 'LA2_R1',
      at: 1000,
      win: false,
      laneLead: 2000,
      restLead: 0,
      endMinute: 19,
      deathMinutes: [15, 17],
    });
    seed(db, {
      id: 'LA2_R2',
      at: 2000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [15, 17],
    });

    const result = standardMeasure(db)(SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    expect(result.n).toBe(2);
    expect(result.effect).toBeCloseTo(1, 10);
  });

  it('applies the lane gate, so a game he was behind in never enters', () => {
    seed(db, {
      id: 'LA2_S1',
      at: 1000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [16],
    });
    seed(db, {
      id: 'LA2_S2',
      at: 2000,
      win: false,
      laneLead: -2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [15, 17, 19, 21],
    });

    const result = standardMeasure(db)(SPEC, { from: 0, until: Number.POSITIVE_INFINITY });
    // Only the gated game survives, so one group is empty and there is no comparison to make.
    expect(result.n).toBe(1);
    expect(Number.isNaN(result.effect)).toBe(true);
  });

  it('counts the declared hole at ITS OWN gate minute', () => {
    seed(db, {
      id: 'LA2_T1',
      at: 1000,
      win: true,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [16],
    });
    seed(db, {
      id: 'LA2_T2',
      at: 2000,
      win: false,
      laneLead: 2000,
      restLead: 0,
      endMinute: 25,
      deathMinutes: [15, 17, 19],
    });
    expect(countGapGames(db, SPEC, 0, 3000)).toBe(2);
    expect(countGapGames(db, SPEC, 1500, 3000)).toBe(1);
  });

  it('freezes its knobs in the hash, so moving the threshold is a different hypothesis', () => {
    const moved: PhaseSpec = { ...SPEC, deathsPer10Threshold: 2.5 };
    expect(specHash(moved)).not.toBe(specHash(SPEC));
    const phase: PhaseSpec = { ...SPEC, toMinute: 30 };
    expect(specHash(phase)).not.toBe(specHash(SPEC));
    // And the hash is stable across runs, which is the promise the ledger makes.
    expect(specHash(SPEC)).toBe(specHash({ ...SPEC }));
  });
});
