import { readKey, readPlatform, redact } from './key.ts';
import { createLimiter, type Limiter } from './limiter.ts';
import { type Platform, platformHost, regionHost } from './routing.ts';
import type { AccountDto, LeagueEntryDto, MatchDto, SummonerDto, TimelineDto } from './types.ts';

/**
 * Thin typed wrapper over the Riot REST API.
 *
 * Everything funnels through `request()` so the rate limiter, the key lookup and the error
 * redaction (G-002) cannot be bypassed by accident from a tool handler.
 */

export class RiotError extends Error {
  readonly status: number;
  readonly hint: string | null;

  constructor(status: number, message: string, hint: string | null = null) {
    super(redact(message));
    this.name = 'RiotError';
    this.status = status;
    this.hint = hint;
  }
}

export class MissingKeyError extends RiotError {
  constructor(message: string) {
    super(0, message, null);
    this.name = 'MissingKeyError';
  }
}

/** Turns a status code into something Marcos can act on, in Spanish. */
function hintFor(status: number): string | null {
  switch (status) {
    case 401:
    case 403:
      return (
        'La key es inválida o caducó. Las de desarrollo duran 24 h: regenerala en ' +
        'https://developer.riotgames.com y pegá la nueva en .env (no hace falta reiniciar nada).'
      );
    case 404:
      return 'Riot no tiene ese recurso. Revisá el Riot ID (gameName y tag) o la región.';
    case 429:
      return 'Rate limit de Riot. El limitador espera solo; si insiste, bajá el tamaño del sync.';
    case 503:
    case 500:
      return 'Riot está caído o con errores del lado suyo. Reintentá en un rato.';
    default:
      return null;
  }
}

export type ClientOptions = {
  platform?: Platform;
  limiter?: Limiter;
  fetchImpl?: typeof fetch;
  /** Retries on 429 and 5xx. Not applied to 4xx, which never fix themselves. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type RiotClient = {
  platform: Platform;
  limiter: Limiter;
  getAccountByRiotId: (gameName: string, tagLine: string) => Promise<AccountDto>;
  getSummonerByPuuid: (puuid: string) => Promise<SummonerDto>;
  getLeagueEntriesByPuuid: (puuid: string) => Promise<LeagueEntryDto[]>;
  getMatchIds: (puuid: string, opts?: MatchIdOptions) => Promise<string[]>;
  getMatch: (matchId: string) => Promise<MatchDto>;
  getTimeline: (matchId: string) => Promise<TimelineDto>;
};

export type MatchIdOptions = {
  /** Riot caps this at 100 per request. */
  count?: number;
  start?: number;
  queue?: number;
  startTime?: number;
  endTime?: number;
  type?: 'ranked' | 'normal' | 'tourney' | 'tutorial';
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createClient(options: ClientOptions = {}): RiotClient {
  const platform = options.platform ?? readPlatform();
  const limiter = options.limiter ?? createLimiter();
  const doFetch = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  async function request<T>(scope: 'platform' | 'regional', path: string): Promise<T> {
    const key = readKey();
    if (!key) {
      throw new MissingKeyError(
        'Falta RIOT_API_KEY. Sacá una en https://developer.riotgames.com y pegala en .env. ' +
          'Usá la tool riot_key_status para ver el diagnóstico completo.',
      );
    }
    const base = scope === 'platform' ? platformHost(platform) : regionHost(platform);
    const url = `${base}${path}`;

    let lastError: RiotError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await limiter.acquire();

      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { 'X-Riot-Token': key, Accept: 'application/json' },
        });
      } catch (cause) {
        // Network-level failure: worth one more try, it is usually transient.
        lastError = new RiotError(0, `No se pudo conectar con Riot: ${String(cause)}`);
        if (attempt === maxRetries) throw lastError;
        await sleep(500 * 2 ** attempt);
        continue;
      }

      if (response.ok) return (await response.json()) as T;

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
        limiter.penalise(Number.isFinite(retryAfter) ? retryAfter : 1);
        lastError = new RiotError(429, 'Rate limit de Riot (429).', hintFor(429));
        if (attempt === maxRetries) throw lastError;
        continue; // the limiter now holds everyone back; no extra sleep needed
      }

      if (response.status >= 500) {
        lastError = new RiotError(
          response.status,
          `Riot devolvió ${response.status}.`,
          hintFor(response.status),
        );
        if (attempt === maxRetries) throw lastError;
        await sleep(500 * 2 ** attempt);
        continue;
      }

      // 4xx other than 429: retrying cannot help.
      const body = await response.text().catch(() => '');
      throw new RiotError(
        response.status,
        `Riot devolvió ${response.status} en ${path}. ${body.slice(0, 200)}`,
        hintFor(response.status),
      );
    }
    throw lastError ?? new RiotError(0, 'Fallo desconocido llamando a Riot.');
  }

  return {
    platform,
    limiter,

    getAccountByRiotId(gameName, tagLine) {
      const g = encodeURIComponent(gameName);
      const t = encodeURIComponent(tagLine);
      return request<AccountDto>('regional', `/riot/account/v1/accounts/by-riot-id/${g}/${t}`);
    },

    getSummonerByPuuid(puuid) {
      return request<SummonerDto>(
        'platform',
        `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
      );
    },

    getLeagueEntriesByPuuid(puuid) {
      return request<LeagueEntryDto[]>(
        'platform',
        `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
      );
    },

    getMatchIds(puuid, opts = {}) {
      const params = new URLSearchParams();
      params.set('count', String(Math.min(opts.count ?? 100, 100)));
      params.set('start', String(opts.start ?? 0));
      if (opts.queue !== undefined) params.set('queue', String(opts.queue));
      if (opts.startTime !== undefined) params.set('startTime', String(opts.startTime));
      if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime));
      if (opts.type !== undefined) params.set('type', opts.type);
      return request<string[]>(
        'regional',
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params}`,
      );
    },

    getMatch(matchId) {
      return request<MatchDto>('regional', `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
    },

    getTimeline(matchId) {
      return request<TimelineDto>(
        'regional',
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`,
      );
    },
  };
}
