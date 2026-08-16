/**
 * Riot enforces TWO windows at once, per region, and both apply to development AND personal
 * keys: 20 requests per 1 second and 100 requests per 2 minutes. The second one is the real
 * constraint — it averages to 50 req/min, so a 300-match backfill takes about 7 minutes no
 * matter how fast the burst limit lets you go.
 *
 * Going over gets a 429 with a `Retry-After` header. Repeatedly ignoring it gets the key
 * blacklisted, so the limiter treats a 429 as a hard stop for everyone, not just the caller
 * that tripped it.
 *
 * Clock and sleep are injected so the tests can drive this without real time passing.
 */

export type LimiterWindow = { limit: number; ms: number };

export const RIOT_WINDOWS: LimiterWindow[] = [
  { limit: 20, ms: 1_000 },
  { limit: 100, ms: 120_000 },
];

export type LimiterOptions = {
  windows?: LimiterWindow[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type Limiter = {
  /** Resolves once it is safe to send. Records the send at the moment it resolves. */
  acquire: () => Promise<void>;
  /** Call on a 429: blocks every caller until the retry window passes. */
  penalise: (retryAfterSeconds: number) => void;
  /** How many requests each window still allows right now — for reporting a sync budget. */
  budget: () => { limit: number; ms: number; remaining: number }[];
  /** Milliseconds until the next send would be allowed. 0 when a slot is free now. */
  waitTime: () => number;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createLimiter(options: LimiterOptions = {}): Limiter {
  const windows = options.windows ?? RIOT_WINDOWS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;

  // One timestamp list per window. Kept pruned to the window length.
  const hits: number[][] = windows.map(() => []);
  let penaltyUntil = 0;
  // Serialises acquisition: without this, N concurrent callers all see the same free slot.
  let queue: Promise<void> = Promise.resolve();

  function prune(at: number): void {
    for (const [i, window] of windows.entries()) {
      const list = hits[i];
      if (!list) continue;
      const cutoff = at - window.ms;
      let drop = 0;
      while (drop < list.length && (list[drop] ?? 0) <= cutoff) drop += 1;
      if (drop > 0) list.splice(0, drop);
    }
  }

  function waitTime(): number {
    const at = now();
    prune(at);
    let wait = Math.max(0, penaltyUntil - at);
    for (const [i, window] of windows.entries()) {
      const list = hits[i];
      if (!list || list.length < window.limit) continue;
      // The window is full: the next slot frees when its oldest entry ages out.
      const oldest = list[list.length - window.limit];
      if (oldest !== undefined) wait = Math.max(wait, oldest + window.ms - at);
    }
    return wait;
  }

  function record(at: number): void {
    for (const list of hits) list.push(at);
  }

  async function acquire(): Promise<void> {
    const mine = queue.then(async () => {
      // Loop rather than sleep-once: a penalty can land while we are already waiting.
      for (;;) {
        const wait = waitTime();
        if (wait <= 0) break;
        await sleep(wait);
      }
      record(now());
    });
    // Swallow rejections on the chain so one failure cannot wedge every later caller.
    queue = mine.catch(() => undefined);
    return mine;
  }

  return {
    acquire,
    penalise(retryAfterSeconds: number): void {
      const ms = Math.max(0, retryAfterSeconds) * 1_000;
      penaltyUntil = Math.max(penaltyUntil, now() + ms);
    },
    budget() {
      const at = now();
      prune(at);
      return windows.map((window, i) => ({
        limit: window.limit,
        ms: window.ms,
        remaining: Math.max(0, window.limit - (hits[i]?.length ?? 0)),
      }));
    },
    waitTime,
  };
}
