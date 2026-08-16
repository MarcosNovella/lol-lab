/**
 * Riot splits its API across two host families and using the wrong one is a 404, not an
 * error message that tells you why:
 *
 *   platform hosts (la2, na1, kr, ...) serve per-server data: summoner-v4, league-v4, spectator
 *   regional hosts (americas, europe, asia, sea) serve cross-server data: account-v1, match-v5
 *
 * Marcos plays on LAS => platform `la2`, which routes to `americas`.
 */

export type Platform =
  | 'br1'
  | 'eun1'
  | 'euw1'
  | 'jp1'
  | 'kr'
  | 'la1'
  | 'la2'
  | 'me1'
  | 'na1'
  | 'oc1'
  | 'ph2'
  | 'ru'
  | 'sg2'
  | 'th2'
  | 'tr1'
  | 'tw2'
  | 'vn2';

export type Region = 'americas' | 'europe' | 'asia' | 'sea';

const PLATFORM_TO_REGION: Record<Platform, Region> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  oc1: 'sea',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  tw2: 'asia',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  vn2: 'sea',
};

export const PLATFORMS = Object.keys(PLATFORM_TO_REGION) as Platform[];

export const DEFAULT_PLATFORM: Platform = 'la2';

export function isPlatform(value: string): value is Platform {
  return Object.hasOwn(PLATFORM_TO_REGION, value);
}

export function regionOf(platform: Platform): Region {
  return PLATFORM_TO_REGION[platform];
}

export function platformHost(platform: Platform): string {
  return `https://${platform}.api.riotgames.com`;
}

export function regionHost(platform: Platform): string {
  return `https://${regionOf(platform)}.api.riotgames.com`;
}

/**
 * Human label for a platform, used in tool output so "la2" never reaches Marcos raw.
 */
const PLATFORM_LABEL: Partial<Record<Platform, string>> = {
  la1: 'LAN',
  la2: 'LAS',
  na1: 'NA',
  br1: 'BR',
  euw1: 'EUW',
  eun1: 'EUNE',
  kr: 'KR',
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}
