import { type AccountRecord, breakdown, type MatchupRow, pool } from './matchups.ts';

/**
 * What to know before a game, for one matchup.
 *
 * Three sources that are never mixed into one number without saying so:
 *
 * 1. HIS OWN RECORD on the account he is about to play — tiny n, maximum relevance, and
 *    performance, so it is scoped to a single account and never pooled.
 * 2. REPS across every account — knowledge, so it pools freely. "You have seen this fifteen
 *    times" is true regardless of the elo those games happened at.
 * 3. THE META PRIOR from op.gg — thousands of games, minimal personal relevance.
 *
 * The estimate pulls his own rate toward the prior in proportion to his n, which is what keeps
 * "0 for 1 against Akali" from reading as an impossible matchup and "2 for 2" from reading as
 * a free win. At the n he actually has — one to three games in almost every matchup — the
 * honest output is that the estimate IS the prior, and `ownWeight` says so numerically instead
 * of dressing it up.
 */

export type MetaPrior = {
  champion: string;
  opponent: string;
  /** How many games op.gg's rate is built on. */
  sampleGames: number;
  /** 0..1, from his own champion's side of the matchup. */
  winRate: number;
};

/**
 * Weight given to the prior, in games. At `n === weight` his own record and the prior count
 * equally.
 *
 * 10 is a JUDGEMENT CALL, like `EVEN_GOLD_BAND`, and it is documented as one: a personal win
 * rate over 10 games still carries a standard error near 16 points, so anything below that
 * genuinely should be dominated by the prior. Because it is arbitrary it is swept (G-011) —
 * an estimate that only says what you want at one weight is an artefact of the weight.
 */
export const SHRINKAGE_DEFAULT = 10;
export const SHRINKAGE_WEIGHTS = [5, 10, 20] as const;

export type Estimate = { weight: number; winRate: number; ownWeight: number };

export type MatchupPrep = {
  champion: string;
  opponent: string;
  account: string;
  /** Pools across accounts: knowledge. */
  repsTotal: number;
  /** This account only: performance. */
  own: AccountRecord;
  /** Listed so the reps are attributable, never merged into a rate. */
  otherAccounts: AccountRecord[];
  prior: MetaPrior | null;
  estimates: Estimate[];
  /** Fraction of the default estimate that comes from his own games, 0..1. */
  ownWeight: number;
  /** Further games on THIS account before his own record carries half the estimate. */
  gamesToHalf: number;
  /** Epoch ms of the most recent game of this matchup on this account, null if never. */
  lastSeen: number | null;
};

function shrink(own: AccountRecord, prior: MetaPrior | null, weight: number): Estimate {
  if (prior === null) {
    // No prior to lean on: his own rate is all there is, and NaN when he has never played it.
    return {
      weight,
      winRate: own.games > 0 ? own.wins / own.games : Number.NaN,
      ownWeight: own.games > 0 ? 1 : 0,
    };
  }
  const n = own.games;
  // Short-circuit rather than let the weighted mean produce it: (0*0 + 10*0.435)/10 is
  // 0.43500000000000005 in binary floating point, so "with no games of his own the estimate IS
  // the prior" would be true in intent and false on inspection — and it would surface as
  // 43.500000000000006% in a report.
  if (n === 0) return { weight, winRate: prior.winRate, ownWeight: 0 };
  const ownRate = own.wins / n;
  return {
    weight,
    winRate: (n * ownRate + weight * prior.winRate) / (n + weight),
    ownWeight: n / (n + weight),
  };
}

export function prepMatchup(
  rows: MatchupRow[],
  options: { champion: string; opponent: string; account: string; prior?: MetaPrior | null },
): MatchupPrep {
  const forMatchup = rows.filter(
    (r) => r.champion === options.champion && r.opponent === options.opponent,
  );
  const per = breakdown(forMatchup);
  const own = per.find((p) => p.account === options.account) ?? {
    account: options.account,
    games: 0,
    wins: 0,
  };
  const others = per.filter((p) => p.account !== options.account);

  const onThisAccount = forMatchup.filter((r) => r.account === options.account);
  const lastSeen = onThisAccount.length > 0 ? Math.max(...onThisAccount.map((r) => r.last)) : null;

  const prior = options.prior ?? null;
  const estimates = SHRINKAGE_WEIGHTS.map((w) => shrink(own, prior, w));
  const atDefault = shrink(own, prior, SHRINKAGE_DEFAULT);

  return {
    champion: options.champion,
    opponent: options.opponent,
    account: options.account,
    // `pool` enforces the rule: reps are knowledge, so this call is allowed to span accounts.
    repsTotal: pool(forMatchup, 'games'),
    own,
    otherAccounts: others,
    prior,
    estimates,
    ownWeight: atDefault.ownWeight,
    gamesToHalf: Math.max(0, SHRINKAGE_DEFAULT - own.games),
    lastSeen,
  };
}

/**
 * What the tool is allowed to claim at this sample size.
 *
 * Exists because the alternative is a number with no caveat attached, and at n=1 that number
 * is the prior wearing a personal label. This is the coverage tracker in miniature: it turns
 * "I don't know" into a quantity — how many more games until his own record matters.
 */
export type Confidence =
  | 'sin_datos'
  | 'solo_meta'
  | 'poco_propio'
  | 'mayormente_meta'
  | 'mixto'
  | 'mayormente_propio';

export function confidenceOf(prep: MatchupPrep): Confidence {
  if (prep.own.games === 0) return prep.prior === null ? 'sin_datos' : 'solo_meta';

  // WITHOUT A PRIOR, `ownWeight` IS 1 AT ANY n — there is nothing to blend with, so the share
  // coming from his own record is the whole estimate whether he has thirty games or one. Reading
  // the rung off the share alone therefore said `mayormente_propio` — "your record rules" — for a
  // single game, which is precisely the n=1 number wearing a confident label this ladder exists
  // to prevent. It surfaced the day the coverage tracker ran on a machine without the vault
  // mounted, where every prior is absent.
  //
  // So the no-prior case gets its own rung instead of borrowing one. It is NOT `mayormente_meta`:
  // that rung means thousands of op.gg games are carrying the estimate, and here there are none.
  // And it improves only when his own record is genuinely worth something, which is the same
  // threshold the shrinkage already encodes.
  if (prep.prior === null) {
    return prep.own.games >= SHRINKAGE_DEFAULT ? 'mayormente_propio' : 'poco_propio';
  }

  if (prep.ownWeight < 0.25) return 'mayormente_meta';
  if (prep.ownWeight < 0.5) return 'mixto';
  return 'mayormente_propio';
}
