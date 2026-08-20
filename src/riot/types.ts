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
  /**
   * The runes he took. Optional because it is read out of the RAW payload rather than a column,
   * and because a remake or an odd queue can ship without it.
   *
   * It has been in the cache since the first sync and nothing ever read it — which is ADR-004
   * paying out exactly as written: the full match JSON is stored precisely so a dimension nobody
   * thought to flatten can be derived later without re-downloading eighty-six games against a
   * rate limit.
   */
  perks?: {
    statPerks?: { defense?: number; flex?: number; offense?: number };
    styles?: {
      description?: string;
      style?: number;
      selections?: { perk?: number }[];
    }[];
  };
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

export type Position = { x: number; y: number };

/**
 * One attacker's contribution to a death, out of `victimDamageReceived` / `victimDamageDealt`.
 *
 * This is what makes "was he IN this fight" answerable exactly, including the fights where he
 * neither killed, assisted nor died: every participant who traded damage with the victim
 * appears here (ADR-008).
 */
export type VictimDamage = {
  participantId: number;
  name?: string;
  basic?: boolean;
  magicDamage?: number;
  physicalDamage?: number;
  trueDamage?: number;
  spellName?: string;
  spellSlot?: number;
  type?: string;
};

/**
 * Timeline events, as a single loose shape rather than a discriminated union.
 *
 * Riot mixes field sets per `type` and adds fields every patch; the raw JSON is stored whole
 * (ADR-004), so this only has to be wide enough for the readers. NOTE the absences, measured
 * across the whole corpus (ADR-008): WARD_PLACED and WARD_KILL carry NO `position` — only
 * `creatorId`/`killerId`, `wardType` and `timestamp` — so nothing positional about vision can
 * be built. CHAMPION_KILL and ELITE_MONSTER_KILL always carry both position and timestamp.
 */
export type TimelineEvent = {
  type: string;
  timestamp: number;
  participantId?: number;
  killerId?: number;
  victimId?: number;
  creatorId?: number;
  assistingParticipantIds?: number[];
  position?: Position;
  wardType?: string;
  itemId?: number;
  /** ITEM_UNDO only: what he had before and after, plus the gold that moved. A positive
   *  `goldGain` with a `beforeId` is a refunded PURCHASE; the mirror is an undone sale. */
  beforeId?: number;
  afterId?: number;
  goldGain?: number;
  monsterType?: string;
  monsterSubType?: string;
  killerTeamId?: number;
  teamId?: number;
  laneType?: string;
  buildingType?: string;
  towerType?: string;
  killType?: string;
  bounty?: number;
  shutdownBounty?: number;
  killStreakLength?: number;
  victimDamageReceived?: VictimDamage[];
  victimDamageDealt?: VictimDamage[];
};

export type ParticipantFrame = {
  participantId: number;
  totalGold?: number;
  currentGold?: number;
  goldPerSecond?: number;
  xp?: number;
  minionsKilled?: number;
  jungleMinionsKilled?: number;
  level?: number;
  /** Sampled once per frame, i.e. once a MINUTE. Nothing finer is reconstructable (ADR-008). */
  position?: Position;
  timeEnemySpentControlled?: number;
  damageStats?: Record<string, number>;
  championStats?: Record<string, number>;
};

export type TimelineFrame = {
  timestamp: number;
  participantFrames: Record<string, ParticipantFrame>;
  events?: TimelineEvent[];
};

export type TimelineDto = {
  metadata: { matchId: string; participants: string[] };
  info: {
    /** 60000 on every match measured so far — one frame per minute. */
    frameInterval: number;
    frames: TimelineFrame[];
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
