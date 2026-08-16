/**
 * Minimal structural types for the slice of the Riot API this server uses.
 *
 * Deliberately NOT exhaustive. Riot adds fields every patch and the full match-v5 participant
 * has well over 150 of them, so the raw JSON is what gets stored (ADR-004) and these types
 * only cover what the flattener reads. Anything unlisted is still reachable through `raw`.
 */

export type AccountDto = {
  puuid: string;
  gameName?: string;
  tagLine?: string;
};

export type LeagueEntryDto = {
  queueType: string;
  tier?: string;
  rank?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
  hotStreak?: boolean;
};

export type SummonerDto = {
  puuid: string;
  summonerLevel?: number;
  profileIconId?: number;
  revisionDate?: number;
};

/**
 * `challenges` holds Riot's own precomputed metrics — the reason this project barely needs
 * the timeline endpoint. Values are mostly numbers but some are booleans or arrays, so it is
 * read through `challengeNumber()` rather than typed field by field.
 */
export type Challenges = Record<string, unknown>;

export type ParticipantDto = {
  puuid: string;
  championId: number;
  championName: string;
  teamId: number;
  /** Authoritative role. May be '' on remakes and some queues — those rows get dropped (G-004). */
  teamPosition: string;
  individualPosition?: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  damageDealtToObjectives?: number;
  damageDealtToTurrets?: number;
  visionScore: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  detectorWardsPlaced?: number;
  timeCCingOthers?: number;
  champLevel?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  challenges?: Challenges;
  gameEndedInEarlySurrender?: boolean;
  gameEndedInSurrender?: boolean;
};

export type TeamDto = {
  teamId: number;
  win: boolean;
  bans?: { championId: number; pickTurn: number }[];
  objectives?: Record<string, { first: boolean; kills: number }>;
};

export type MatchDto = {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameStartTimestamp?: number;
    gameEndTimestamp?: number;
    gameDuration: number;
    gameMode: string;
    gameType: string;
    gameVersion: string;
    mapId: number;
    queueId: number;
    platformId: string;
    participants: ParticipantDto[];
    teams: TeamDto[];
  };
};

export type TimelineDto = {
  metadata: { matchId: string; participants: string[] };
  info: {
    frameInterval: number;
    frames: {
      timestamp: number;
      participantFrames: Record<
        string,
        {
          participantId: number;
          totalGold?: number;
          currentGold?: number;
          xp?: number;
          minionsKilled?: number;
          jungleMinionsKilled?: number;
          level?: number;
        }
      >;
    }[];
    participants?: { participantId: number; puuid: string }[];
  };
};

/** Safe numeric read out of the loosely-typed `challenges` bag. */
export function challengeNumber(challenges: Challenges | undefined, key: string): number | null {
  const value = challenges?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Queue ids we care about. Riot's full list is long; these are the ranked Summoner's Rift ones. */
export const QUEUE = {
  soloq: 420,
  flex: 440,
  draft: 400,
  blind: 430,
  aram: 450,
} as const;

export type QueueName = keyof typeof QUEUE;

export const QUEUE_NAMES = Object.keys(QUEUE) as QueueName[];

export function queueLabel(queueId: number): string {
  for (const [name, id] of Object.entries(QUEUE)) {
    if (id === queueId) return name;
  }
  return `queue-${queueId}`;
}
