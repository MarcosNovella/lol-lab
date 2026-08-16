import { challengeNumber, type MatchDto, type ParticipantDto } from '../riot/types.ts';

/**
 * Turns a raw match into the rows the cache stores.
 *
 * Three Riot quirks are handled here, and each one silently corrupts analysis if missed:
 *
 * 1. `gameDuration` units changed with patch 11.20. When `gameEndTimestamp` is present the
 *    value is SECONDS; when it is absent the same field is MILLISECONDS. Getting this wrong
 *    makes every per-minute metric off by 1000x on old matches.
 * 2. Role comes from `teamPosition`, never `individualPosition` (G-004). Riot fills the
 *    latter with a guess even when it does not know; the former is left empty, which is the
 *    honest signal that the row should not enter a role benchmark.
 * 3. Remakes look like real matches with all-zero stats. Left in, they drag every average
 *    down. The op.gg export already contains one: a 1.4-minute Diana jungle game.
 */

export const REMAKE_MAX_SECONDS = 300;

export type MatchRow = {
  matchId: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  gameVersion: string | null;
  patch: string | null;
  mapId: number | null;
};

export type ParticipantRow = {
  matchId: string;
  puuid: string;
  teamId: number;
  teamPosition: string;
  championId: number;
  champion: string;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damageChampions: number;
  damageTaken: number;
  damageObjectives: number | null;
  visionScore: number;
  controlWards: number | null;
  wardsPlaced: number | null;
  wardsKilled: number | null;
  timeCcing: number | null;
  durationMinutes: number;
  csPerMin: number;
  goldPerMin: number;
  damagePerMin: number;
  damageTakenPerMin: number;
  visionPerMin: number;
  deathsPerMin: number;
  kda: number;
  killParticipation: number | null;
  teamDamageShare: number | null;
  soloKills: number | null;
  turretPlates: number | null;
  csFirst10: number | null;
  maxCsAdvOnLane: number | null;
  earlyLaneAdv: number | null;
  laneAdv: number | null;
};

export type FlatMatch = {
  match: MatchRow;
  participants: ParticipantRow[];
  /** True when the match should not feed any statistic. Still cached, just flagged. */
  isRemake: boolean;
};

/** Seconds, resolving the patch-11.20 unit change described above. */
export function durationSeconds(info: MatchDto['info']): number {
  if (info.gameEndTimestamp !== undefined && info.gameStartTimestamp !== undefined) {
    const fromTimestamps = Math.round((info.gameEndTimestamp - info.gameStartTimestamp) / 1000);
    if (fromTimestamps > 0) return fromTimestamps;
  }
  // No end timestamp => the field is in milliseconds (pre-11.20 matches).
  return info.gameEndTimestamp === undefined && info.gameDuration > 100_000
    ? Math.round(info.gameDuration / 1000)
    : info.gameDuration;
}

export function patchOf(gameVersion: string | undefined): string | null {
  if (!gameVersion) return null;
  const parts = gameVersion.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : gameVersion;
}

function perMinute(value: number, minutes: number): number {
  return minutes > 0 ? value / minutes : 0;
}

function flattenParticipant(matchId: string, p: ParticipantDto, minutes: number): ParticipantRow {
  const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
  const c = p.challenges;
  return {
    matchId,
    puuid: p.puuid,
    teamId: p.teamId,
    teamPosition: p.teamPosition ?? '',
    championId: p.championId,
    champion: p.championName,
    win: p.win ? 1 : 0,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs,
    gold: p.goldEarned,
    damageChampions: p.totalDamageDealtToChampions,
    damageTaken: p.totalDamageTaken,
    damageObjectives: p.damageDealtToObjectives ?? null,
    visionScore: p.visionScore,
    controlWards: p.detectorWardsPlaced ?? null,
    wardsPlaced: p.wardsPlaced ?? null,
    wardsKilled: p.wardsKilled ?? null,
    timeCcing: p.timeCCingOthers ?? null,
    durationMinutes: minutes,
    csPerMin: perMinute(cs, minutes),
    goldPerMin: perMinute(p.goldEarned, minutes),
    damagePerMin: perMinute(p.totalDamageDealtToChampions, minutes),
    damageTakenPerMin: perMinute(p.totalDamageTaken, minutes),
    visionPerMin: perMinute(p.visionScore, minutes),
    deathsPerMin: perMinute(p.deaths, minutes),
    // Riot's own KDA treats a deathless game as (k+a)/1, which is the convention every
    // site uses. Keeping it means numbers here match what he sees elsewhere.
    kda: (p.kills + p.assists) / Math.max(p.deaths, 1),
    killParticipation: challengeNumber(c, 'killParticipation'),
    teamDamageShare: challengeNumber(c, 'teamDamagePercentage'),
    soloKills: challengeNumber(c, 'soloKills'),
    turretPlates: challengeNumber(c, 'turretPlatesTaken'),
    csFirst10: challengeNumber(c, 'laneMinionsFirst10Minutes'),
    maxCsAdvOnLane: challengeNumber(c, 'maxCsAdvantageOnLaneOpponent'),
    earlyLaneAdv: challengeNumber(c, 'earlyLaningPhaseGoldExpAdvantage'),
    laneAdv: challengeNumber(c, 'laningPhaseGoldExpAdvantage'),
  };
}

export function flattenMatch(match: MatchDto): FlatMatch {
  const info = match.info;
  const seconds = durationSeconds(info);
  const minutes = seconds / 60;
  const earlySurrender = info.participants.some((p) => p.gameEndedInEarlySurrender === true);

  return {
    match: {
      matchId: match.metadata.matchId,
      queueId: info.queueId,
      gameCreation: info.gameCreation,
      gameDuration: seconds,
      gameVersion: info.gameVersion ?? null,
      patch: patchOf(info.gameVersion),
      mapId: info.mapId ?? null,
    },
    participants: info.participants.map((p) =>
      flattenParticipant(match.metadata.matchId, p, minutes),
    ),
    isRemake: seconds < REMAKE_MAX_SECONDS || earlySurrender,
  };
}
