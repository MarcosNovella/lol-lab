import type { MatchDto, ParticipantDto } from '../src/riot/types.ts';

/** Match fixtures shaped like real Riot payloads, trimmed to the fields the code reads. */

export function participant(
  overrides: Partial<ParticipantDto> & { puuid: string },
): ParticipantDto {
  return {
    championId: 131,
    championName: 'Diana',
    teamId: 100,
    teamPosition: 'MIDDLE',
    win: true,
    kills: 5,
    deaths: 3,
    assists: 7,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 10,
    goldEarned: 12000,
    totalDamageDealtToChampions: 20000,
    totalDamageTaken: 18000,
    damageDealtToObjectives: 5000,
    visionScore: 20,
    wardsPlaced: 10,
    wardsKilled: 3,
    detectorWardsPlaced: 2,
    timeCCingOthers: 30,
    challenges: {
      killParticipation: 0.5,
      teamDamagePercentage: 0.25,
      soloKills: 1,
      turretPlatesTaken: 2,
      laneMinionsFirst10Minutes: 70,
      maxCsAdvantageOnLaneOpponent: 12,
      earlyLaningPhaseGoldExpAdvantage: 1,
      laningPhaseGoldExpAdvantage: 1,
    },
    ...overrides,
  };
}

export type MatchFixtureOptions = {
  matchId?: string;
  queueId?: number;
  gameCreation?: number;
  /** Seconds. Written into gameStartTimestamp/gameEndTimestamp so units are unambiguous. */
  durationSeconds?: number;
  /** Set to build a pre-11.20 style payload where gameDuration is in MILLISECONDS. */
  legacyMillisDuration?: boolean;
  participants?: ParticipantDto[];
};

export function match(options: MatchFixtureOptions = {}): MatchDto {
  const matchId = options.matchId ?? 'LA2_TEST1';
  const seconds = options.durationSeconds ?? 1800;
  const creation = options.gameCreation ?? 1_760_000_000_000;
  const participants = options.participants ?? [
    participant({ puuid: 'me', teamId: 100, teamPosition: 'MIDDLE' }),
    participant({ puuid: 'enemy-mid', teamId: 200, teamPosition: 'MIDDLE', win: false }),
  ];

  const info: MatchDto['info'] = {
    gameCreation: creation,
    gameDuration: options.legacyMillisDuration === true ? seconds * 1000 : seconds,
    gameMode: 'CLASSIC',
    gameType: 'MATCHED_GAME',
    gameVersion: '16.16.700.1234',
    mapId: 11,
    queueId: options.queueId ?? 420,
    platformId: 'LA2',
    participants,
    teams: [
      { teamId: 100, win: true },
      { teamId: 200, win: false },
    ],
  };
  if (options.legacyMillisDuration !== true) {
    info.gameStartTimestamp = creation;
    info.gameEndTimestamp = creation + seconds * 1000;
  }

  return {
    metadata: { matchId, participants: participants.map((p) => p.puuid) },
    info,
  };
}

/**
 * Deterministic pseudo-random in [-1, 1], so fixtures have realistic spread without
 * becoming flaky. Real matches never produce identical values game after game, and a
 * zero-variance fixture silently skips the normal code path (see G-005).
 */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** A full 10-player lobby: him plus one peer in every role on both teams. */
export function lobby(options: {
  matchId: string;
  /** His CS per minute, before jitter. */
  myCsPerMinTarget?: number;
  /** Peers' CS per minute, before jitter. Defaults to 7.0. */
  peerCsPerMinTarget?: number;
  index?: number;
  gameCreation?: number;
  durationSeconds?: number;
  win?: boolean;
  /** Set for the degenerate case: every value identical, so pooled variance is 0. */
  noVariance?: boolean;
}): MatchDto {
  const seconds = options.durationSeconds ?? 1800;
  const minutes = seconds / 60;
  const index = options.index ?? 0;
  const spread = options.noVariance === true ? 0 : 1;
  const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const peerCs = options.peerCsPerMinTarget ?? 7;
  const players: ParticipantDto[] = [];

  for (const [i, role] of roles.entries()) {
    const isMine = role === 'MIDDLE';
    const myCs =
      options.myCsPerMinTarget !== undefined
        ? options.myCsPerMinTarget + jitter(index * 7 + i) * 0.4 * spread
        : 5;
    players.push(
      participant({
        puuid: isMine ? 'me' : `ally-${role}`,
        teamId: 100,
        teamPosition: role,
        win: options.win ?? true,
        totalMinionsKilled: Math.round((isMine ? myCs : peerCs) * minutes),
        neutralMinionsKilled: 0,
        deaths: Math.max(0, Math.round(4 + jitter(index * 11 + i) * 2 * spread)),
      }),
    );
    players.push(
      participant({
        puuid: `${options.matchId}-enemy-${role}`,
        teamId: 200,
        teamPosition: role,
        win: !(options.win ?? true),
        totalMinionsKilled: Math.round((peerCs + jitter(index * 13 + i) * 0.4 * spread) * minutes),
        neutralMinionsKilled: 0,
        deaths: Math.max(0, Math.round(4 + jitter(index * 17 + i) * 2 * spread)),
      }),
    );
  }

  return match({
    matchId: options.matchId,
    ...(options.gameCreation !== undefined ? { gameCreation: options.gameCreation } : {}),
    durationSeconds: seconds,
    participants: players,
  });
}
