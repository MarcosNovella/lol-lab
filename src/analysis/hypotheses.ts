import { createHash } from 'node:crypto';
import type { Db } from '../store/db.ts';
import type { Role } from './metrics.ts';

/**
 * The hypothesis ledger: out-of-sample or nothing.
 *
 * Every finding the engine surfaces is registered as a dated PREDICTION and evaluated only
 * against games played after that moment. It is the only defence that works against
 * overfitting 36 games, and it is the same discipline as the vault's rule for `posicion` —
 * write the invalidation condition BEFORE you store the belief.
 *
 * Two things here are not in the original plan and were added after the 2026-08-16 audit,
 * because the audit showed they are load-bearing rather than nice to have:
 *
 * 1. The ledger freezes the ANALYSIS SPEC, not just the claim (G-013). The Fase 0 finding
 *    survived a sweep of the gold band and failed a sweep of the minute — a knob nobody had
 *    turned. An evaluation that may re-choose the minute, band, role, queue, account or
 *    outcome variable inherits exactly the degrees of freedom that manufactured the finding.
 * 2. Registration takes a TIMESTAMP and carries TWO boundaries, so the games played between
 *    "the finding existed" and "the finding was registered" land in a declared, counted hole
 *    instead of quietly joining whichever side flatters the claim.
 */

export type OutcomeVariable = 'binary_win' | 'delta_gold_6min';

/**
 * Which slice of games the effect is measured over, on top of the lane state itself.
 * `none` means the spec's own bucketing decides; the others fix a stratum so a contaminated
 * comparison cannot be run unconditioned (G-008).
 */
export type Stratum = 'none' | 'lane_ahead' | 'lane_even_or_behind';

/**
 * Everything that can change the number. Every field is REQUIRED and explicitly nullable
 * rather than optional: an absent key and a null key must not hash differently, or the
 * guarantee in G-013 leaks through the shape of the object.
 */
export type AnalysisSpec = {
  /** Performance never pools across accounts, so a hypothesis is bound to exactly one. */
  puuid: string;
  role: Role;
  queueId: number;
  minute: number;
  band: number;
  outcome: OutcomeVariable;
  stratum: Stratum;
  champion: string | null;
};

/**
 * A hypothesis about vision before an objective — a different SHAPE of question from a lane
 * state, which is why it is a separate spec rather than more optional fields on the one above.
 */
export type VisionSpec = {
  puuid: string;
  role: Role;
  queueId: number;
  /** Seconds before the objective a ward has to land to count. Arbitrary, so it gets swept. */
  windowSeconds: number;
  /**
   * Restrict to objectives he was NOT credited on. Warding near an objective correlates with
   * being near it, and being near it correlates with the team taking it, so the unrestricted
   * version measures presence as much as vision.
   */
  onlyUncredited: boolean;
};

/**
 * A hypothesis about TEAM state given lane state — a third shape, and the reason `A3` had to be
 * settled first.
 *
 * It carries two bands because it cuts on two axes: `band` decides which games count as "ahead
 * in lane", `teamBand` decides which team states count as ahead or behind. Both are arbitrary,
 * so both are frozen here and both are swept at registration (G-011). The earlier version of
 * this question cut on `teamGoldDiff`, which contains his own lane pair — freezing a spec on a
 * variable we already intended to replace would have made the hash refuse to evaluate after the
 * fix, which is why it was deliberately NOT registered until now.
 */
export type TeamStateSpec = {
  puuid: string;
  role: Role;
  queueId: number;
  minute: number;
  /** Band on his lane gold lead. */
  band: number;
  /** Band on the REST of the team's gold difference, his lane pair removed. */
  teamBand: number;
};

/**
 * A hypothesis about DRIFT — whether a causal metric moves over a season, net of the lobbies
 * getting harder or easier.
 *
 * `rollingGames` is in the spec because a rolling mean is endpoint-sensitive: the same games
 * under a window of 5 and of 20 give different drifts, so leaving the window free at evaluation
 * time would hand back exactly the degree of freedom G-013 exists to remove. The metric key is
 * frozen for the same reason, and `growthCurve` independently refuses any metric that is not
 * `causal` (G-008).
 */
export type GrowthSpec = {
  puuid: string;
  role: Role;
  queueId: number;
  metricKey: string;
  rollingGames: number;
};

/**
 * A hypothesis about a PHASE of the game — how often he dies inside a window of minutes, and
 * whether the games where that rate is high are the games he loses.
 *
 * It exists because the phase reading of 2026-08-16 ("the deaths gap between wins and losses
 * peaks in the mid phase, 1.14 against 2.71") is not registrable as it stands: it splits on the
 * RESULT, which is the thing being predicted, and dying and losing cause each other. Three
 * decisions make it a legitimate question instead of that one:
 *
 * - The GATE. Only games he reaches `gateMinute` with more than `band` gold of lane lead are
 *   counted, so the comparison starts from a state he actually earned rather than from every
 *   game he happened to lose. It is the same gate `team_state_dominates_500g` uses.
 * - The RATE, not the count. Deaths are divided by the minutes of the phase the game actually
 *   reached, because a game that ends at 19' offers six minutes of exposure and one that goes to
 *   40' offers eleven. A raw count would mostly measure duration, and duration is downstream of
 *   the result (G-008).
 * - The THRESHOLD is frozen, because "high-death games" is otherwise a knob to be turned until
 *   the split flatters the claim. It is swept at registration like every other knob (G-011).
 *
 * What it still cannot settle, and the caveat has to say so: reverse causality. Losing a won
 * game and dying in the mid phase are the same story told twice, and no observational split of
 * his own games can separate "the deaths caused the loss" from "the loss was already happening".
 */
export type PhaseSpec = {
  puuid: string;
  role: Role;
  queueId: number;
  /** Minute the lane gate is read at. */
  gateMinute: number;
  /** Only games he is ahead by more than this at `gateMinute`. 0 admits every game. */
  band: number;
  /** Phase start, inclusive, in minutes. */
  fromMinute: number;
  /** Phase end, exclusive, in minutes. Clamped to the last whole minute the game reached. */
  toMinute: number;
  /** Deaths per 10 minutes of phase at or above which a game counts as high-death. */
  deathsPer10Threshold: number;
};

export type Spec = AnalysisSpec | VisionSpec | TeamStateSpec | GrowthSpec | PhaseSpec;

/**
 * Canonical JSON over the spec's OWN keys, sorted.
 *
 * It used to walk a fixed global key list, which quietly made the spec SCHEMA immutable: adding
 * a field for a new kind of hypothesis would have changed the hash of every hypothesis already
 * registered and left them permanently unevaluatable. Hashing each spec's own keys means a new
 * shape simply hashes differently, and the existing three are untouched — pinned by test, since
 * "their hashes must never change" is the whole promise of G-013.
 *
 * The completeness guarantee survives and is now structural rather than a list someone has to
 * remember: every key present is hashed, and TypeScript already requires every field of the
 * spec type to be set at the call site.
 */
export function canonicalSpec(spec: Spec): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(spec).sort()) {
    ordered[key] = (spec as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

export function specHash(spec: Spec): string {
  return createHash('sha256').update(canonicalSpec(spec)).digest('hex').slice(0, 16);
}

export type Direction = 'lower' | 'higher' | 'none';

/**
 * `unmeasurable` is separate from `no_effect` on purpose, and the distinction is the whole of
 * G-005: "there is no difference" is a FINDING and "the statistic was undefined" is the absence
 * of one, and collapsing them publishes the second as the first. The case is not hypothetical —
 * `conversionGapBinary` returns a NaN effect whenever one of its two buckets is empty, and `n`
 * is the size of the other bucket, so a large one-sided sample used to come back as `no_effect`.
 */
export type Verdict =
  | 'insufficient_n'
  | 'consistent'
  | 'inconsistent'
  | 'no_effect'
  | 'unmeasurable';

/**
 * The verdict as a sentence, because the four values are read by one person in Spanish and the
 * newest one is the one nobody can guess from its name.
 *
 * Kept beside the type rather than in each front-end so the three of them cannot drift into
 * three different readings of the same word — which matters most for `unmeasurable`, whose
 * whole reason to exist is that it is NOT `no_effect`.
 */
export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'insufficient_n':
      return 'todavía sin muestra suficiente';
    case 'consistent':
      return 'va en la dirección predicha';
    case 'inconsistent':
      return 'va en contra de la dirección predicha';
    case 'no_effect':
      return 'efecto exactamente cero';
    case 'unmeasurable':
      return 'NO MEDIBLE — la medición no se pudo tomar (un lado de la comparación quedó vacío)';
  }
}

export type Hypothesis = {
  id: string;
  registeredAt: number;
  claim: string;
  direction: Direction;
  spec: Spec;
  specHash: string;
  baselineUntil: number;
  testFrom: number;
  gapGames: number;
  baselineN: number;
  baselineEffect: number;
  nNeeded: number;
  caveat: string;
  retiredAt: number | null;
  retiredReason: string | null;
};

export type RegisterInput = {
  id: string;
  claim: string;
  direction: Direction;
  spec: Spec;
  baselineUntil: number;
  testFrom: number;
  /** Games that fall in the declared hole between the two boundaries. Counted, never assumed. */
  gapGames: number;
  baselineN: number;
  baselineEffect: number;
  nNeeded: number;
  caveat: string;
};

export class LedgerError extends Error {}

/**
 * NaN means "not measurable" everywhere in this codebase, and it does NOT survive SQLite:
 * `node:sqlite` binds it as NULL. These two map it across the boundary explicitly in both
 * directions (G-014). The read side matters most — `Number(null)` is 0, so the lazy path
 * would turn "we could not measure this" into "the effect is exactly zero", which is the
 * precise confusion G-005 was written about.
 */
const effectToDb = (value: number): number | null => (Number.isFinite(value) ? value : null);

const effectFromDb = (value: unknown): number =>
  value === null || value === undefined ? Number.NaN : Number(value);

/**
 * Registers a prediction. Refuses rather than repairs: every rejection here is a case where
 * accepting the row would make a later evaluation dishonest in a way nobody would notice.
 */
export function registerHypothesis(
  db: Db,
  input: RegisterInput,
  now: number = Date.now(),
): Hypothesis {
  if (!/^[a-z][a-z0-9_]*$/.test(input.id)) {
    throw new LedgerError(`hypothesis id must be a lowercase slug, got '${input.id}'`);
  }
  if (input.testFrom < input.baselineUntil) {
    throw new LedgerError(
      'testFrom is before baselineUntil: the baseline and the out-of-sample window would overlap, ' +
        'so the same games would both produce and confirm the finding',
    );
  }
  if (input.baselineN <= 0) throw new LedgerError('baselineN must be positive');
  if (input.nNeeded <= 0) throw new LedgerError('nNeeded must be positive');
  if (input.gapGames < 0) throw new LedgerError('gapGames cannot be negative');
  if (input.caveat.trim() === '') {
    throw new LedgerError('caveat is required: a finding with no stated weakness is not honest');
  }
  if (getHypothesis(db, input.id) !== null) {
    throw new LedgerError(
      `hypothesis '${input.id}' already exists; the ledger is append-only, register a new id`,
    );
  }

  const hash = specHash(input.spec);
  db.prepare(
    `INSERT INTO hypotheses (
       id, registered_at, claim, direction, spec, spec_hash, baseline_until, test_from,
       gap_games, baseline_n, baseline_effect, n_needed, caveat
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    now,
    input.claim,
    input.direction,
    canonicalSpec(input.spec),
    hash,
    input.baselineUntil,
    input.testFrom,
    input.gapGames,
    input.baselineN,
    effectToDb(input.baselineEffect),
    input.nNeeded,
    input.caveat,
  );

  const saved = getHypothesis(db, input.id);
  if (saved === null) throw new LedgerError(`failed to register '${input.id}'`);
  return saved;
}

function rowToHypothesis(r: Record<string, unknown>): Hypothesis {
  return {
    id: String(r['id']),
    registeredAt: Number(r['registered_at']),
    claim: String(r['claim']),
    direction: String(r['direction']) as Direction,
    spec: JSON.parse(String(r['spec'])) as Spec,
    specHash: String(r['spec_hash']),
    baselineUntil: Number(r['baseline_until']),
    testFrom: Number(r['test_from']),
    gapGames: Number(r['gap_games']),
    baselineN: Number(r['baseline_n']),
    baselineEffect: effectFromDb(r['baseline_effect']),
    nNeeded: Number(r['n_needed']),
    caveat: String(r['caveat']),
    retiredAt: r['retired_at'] === null ? null : Number(r['retired_at']),
    retiredReason: r['retired_reason'] === null ? null : String(r['retired_reason']),
  };
}

export function getHypothesis(db: Db, id: string): Hypothesis | null {
  const row = db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToHypothesis(row) : null;
}

export function listHypotheses(db: Db, includeRetired = false): Hypothesis[] {
  const sql = includeRetired
    ? 'SELECT * FROM hypotheses ORDER BY registered_at'
    : 'SELECT * FROM hypotheses WHERE retired_at IS NULL ORDER BY registered_at';
  return (db.prepare(sql).all() as Record<string, unknown>[]).map(rowToHypothesis);
}

export type Measurement = {
  n: number;
  effect: number;
  /**
   * Games inside the window that the measure could not read AT ALL, and therefore did not
   * count in `n`. Optional because not every measure has such a category: a vision measure
   * walks games and either reads one or does not exist for it.
   *
   * It exists because `collectStates` has always counted these — `{ noTimeline,
   * endedBeforeMinute }`, under a comment promising they are never dropped silently — and no
   * front-end ever read the field. A sync with `withTimeline: false` leaves games in the cache
   * with no minute data at all, so an evaluation could honestly report `n=4` over a window
   * holding ten games and nothing anywhere said where the other six went. `n` alone cannot say
   * it: `n` counts what the measure used, never what it wanted.
   */
  unreadable?: number;
};

/** Half-open `[from, until)`, so the baseline and the test window cannot share a game. */
export type Window = { from: number; until: number };

/**
 * Runs the frozen spec over a window.
 *
 * It takes a window rather than just a start so the BASELINE effect and the out-of-sample
 * effect come out of the same function under the same spec. Computing the baseline by some
 * other route is how you end up comparing two numbers that were never comparable.
 */
export type Measure = (spec: Spec, window: Window) => Measurement;

export type Evaluation = {
  hypothesisId: string;
  evaluatedAt: number;
  puuid: string;
  elo: string | null;
  n: number;
  effect: number;
  verdict: Verdict;
  /**
   * Games in the window the measure could not read. NOT persisted: it is a fact about the
   * cache at the moment of the evaluation, not about the evaluation, and it changes the day
   * `riot_backfill_timelines` runs. Stored history would go stale and be read as if it had not.
   */
  unreadable: number;
};

/**
 * The honesty rule, and the reason this function exists at all.
 *
 * Below `nNeeded` the verdict is `insufficient_n` and NOTHING else — the effect is still
 * recorded so the trend is visible, but no direction may be claimed from it. At his volume
 * these hypotheses will read `insufficient_n` for months; that is the correct answer, not a
 * failure of the tool. A ledger that hands out verdicts early is a ledger that launders noise.
 *
 * An effect of exactly zero is `no_effect`, never `consistent` (G-012): agreement with a
 * direction requires a sign, and zero has none.
 *
 * An effect that is not FINITE is `unmeasurable`, never `no_effect` (G-005). NaN means the
 * measure could not be taken — a bucket with nothing in it, a variance of zero, a series too
 * short to fit — and `n` does not say so, because `n` counts the games the measure looked at
 * and not the ones it could use. Reporting that as "no effect" hands back a conclusion drawn
 * from a comparison that never happened.
 *
 * `insufficient_n` still comes first: below the declared n, nothing else about the number is
 * worth saying, whether it came out finite or not.
 */
export function verdictFor(
  direction: Direction,
  effect: number,
  n: number,
  nNeeded: number,
): Verdict {
  if (n < nNeeded) return 'insufficient_n';
  if (!Number.isFinite(effect)) return 'unmeasurable';
  if (effect === 0) return 'no_effect';
  if (direction === 'none') return 'no_effect';
  const wanted = direction === 'lower' ? -1 : 1;
  return Math.sign(effect) === wanted ? 'consistent' : 'inconsistent';
}

/**
 * Evaluates a registered hypothesis, refusing any spec that is not the one it was registered
 * with (G-013). The caller must pass the spec explicitly rather than have it read from the
 * row, so that a drifted call site fails loudly instead of silently measuring something else.
 */
export function evaluateHypothesis(
  db: Db,
  id: string,
  spec: Spec,
  measure: Measure,
  options: { elo?: string | null; now?: number } = {},
): Evaluation {
  const hypothesis = getHypothesis(db, id);
  if (hypothesis === null) throw new LedgerError(`no hypothesis '${id}'`);
  if (hypothesis.retiredAt !== null) {
    throw new LedgerError(`hypothesis '${id}' is retired and may not be evaluated again`);
  }

  const hash = specHash(spec);
  if (hash !== hypothesis.specHash) {
    throw new LedgerError(
      `spec mismatch for '${id}': registered ${hypothesis.specHash}, got ${hash}. ` +
        'A hypothesis is evaluated under the spec it was registered with or not at all (G-013).',
    );
  }

  const { n, effect, unreadable } = measure(spec, {
    from: hypothesis.testFrom,
    until: Number.POSITIVE_INFINITY,
  });
  const evaluation: Evaluation = {
    hypothesisId: id,
    evaluatedAt: options.now ?? Date.now(),
    puuid: spec.puuid,
    elo: options.elo ?? null,
    n,
    effect,
    verdict: verdictFor(hypothesis.direction, effect, n, hypothesis.nNeeded),
    unreadable: unreadable ?? 0,
  };

  db.prepare(
    `INSERT INTO hypothesis_evaluations (hypothesis_id, evaluated_at, puuid, elo, n, effect, verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    evaluation.hypothesisId,
    evaluation.evaluatedAt,
    evaluation.puuid,
    evaluation.elo,
    evaluation.n,
    effectToDb(evaluation.effect),
    evaluation.verdict,
  );
  return evaluation;
}

export function evaluationsOf(db: Db, id: string): Evaluation[] {
  const rows = db
    .prepare('SELECT * FROM hypothesis_evaluations WHERE hypothesis_id = ? ORDER BY evaluated_at')
    .all(id) as Record<string, unknown>[];
  return rows.map((r) => ({
    hypothesisId: String(r['hypothesis_id']),
    evaluatedAt: Number(r['evaluated_at']),
    puuid: String(r['puuid']),
    elo: r['elo'] === null ? null : String(r['elo']),
    n: Number(r['n']),
    effect: effectFromDb(r['effect']),
    verdict: String(r['verdict']) as Verdict,
    // History carries no `unreadable`: it was never stored, because it describes the cache and
    // not the evaluation. Zero here means "not recorded", which is why nothing prints it for a
    // past evaluation — only for the one just taken.
    unreadable: 0,
  }));
}

/** The one permitted mutation: mark a hypothesis dead so it stops being surfaced. */
export function retireHypothesis(
  db: Db,
  id: string,
  reason: string,
  now: number = Date.now(),
): void {
  if (reason.trim() === '') throw new LedgerError('a retirement needs a reason');
  const hypothesis = getHypothesis(db, id);
  if (hypothesis === null) throw new LedgerError(`no hypothesis '${id}'`);
  if (hypothesis.retiredAt !== null) throw new LedgerError(`'${id}' is already retired`);
  db.prepare('UPDATE hypotheses SET retired_at = ?, retired_reason = ? WHERE id = ?').run(
    now,
    reason,
    id,
  );
}
