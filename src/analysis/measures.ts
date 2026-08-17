import type { Db } from '../store/db.ts';
import { collectStates, type StateRow } from './conversion.ts';
import {
  type AnalysisSpec,
  LedgerError,
  type Measure,
  type Measurement,
  type Window,
} from './hypotheses.ts';

/**
 * The one measure function the ledger runs.
 *
 * There is deliberately ONE, dispatching on the spec, rather than a measure passed alongside
 * each hypothesis. The spec is hashed and frozen (G-013); if the choice of computation lived
 * outside it, two evaluations could share a hash and still compute different numbers, and the
 * freeze would guarantee nothing. An unsupported combination throws rather than falling back:
 * a silent wrong number is the failure mode this whole layer exists to prevent.
 *
 * Every effect below is signed so that ZERO IS THE NULL. `verdictFor` reads the sign, so an
 * effect whose null is 0.5 (a win rate) must be centred here, not interpreted later.
 */

function rowsFor(db: Db, spec: AnalysisSpec, window: Window, minute: number): StateRow[] {
  const { rows } = collectStates(db, {
    puuid: spec.puuid,
    role: spec.role,
    queueId: spec.queueId,
    since: window.from,
    ...(Number.isFinite(window.until) ? { until: window.until } : {}),
    minute,
  });
  return spec.champion === null ? rows : rows.filter((r) => r.champion === spec.champion);
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * His win rate from a lane lead minus his opponents' from the same state.
 *
 * The opponents' rate is derived, not measured: when he is behind the opponent is ahead by
 * construction and wins exactly the games he loses. Valid under symmetry, but it means there
 * is no independent measurement of the opponent in this number at all — the opponent-quality
 * confound is carried whole, and the caveat on the hypothesis says so.
 */
function conversionGapBinary(rows: StateRow[], band: number): Measurement {
  const ahead = rows.filter((r) => r.goldDiff > band);
  const behind = rows.filter((r) => r.goldDiff < -band);
  const n = ahead.length + behind.length;
  if (ahead.length === 0 || behind.length === 0) return { n, effect: Number.NaN };
  const his = ahead.filter((r) => r.win).length / ahead.length;
  const theirs = behind.filter((r) => !r.win).length / behind.length;
  return { n, effect: his - theirs };
}

/**
 * The same comparison with a continuous outcome: gold swing over the six minutes after the
 * state, his from his lead minus the opponent's from theirs (mirrored, since the differential
 * is antisymmetric).
 *
 * Registered because roadmap §4.2 argued a continuous outcome would extract more signal from
 * the same games. Measured on the baseline it does not: the standardised effect is d = −0.14,
 * so it needs MORE games than the binary version, not fewer. Registering both settles that
 * argument with data instead of reasoning.
 */
function conversionGapDeltaGold(
  db: Db,
  spec: AnalysisSpec,
  window: Window,
  band: number,
): Measurement {
  const start = rowsFor(db, spec, window, spec.minute);
  const later = new Map(
    rowsFor(db, spec, window, spec.minute + 6).map((r) => [r.matchId, r] as const),
  );

  const his: number[] = [];
  const theirs: number[] = [];
  for (const row of start) {
    const end = later.get(row.matchId);
    if (!end) continue; // the game ended before the window closed — never extrapolated
    const delta = end.goldDiff - row.goldDiff;
    if (row.goldDiff > band) his.push(delta);
    if (row.goldDiff < -band) theirs.push(-delta);
  }
  const n = his.length + theirs.length;
  if (his.length === 0 || theirs.length === 0) return { n, effect: Number.NaN };
  return { n, effect: mean(his) - mean(theirs) };
}

/**
 * Win rate from a neutral-or-behind lane state, centred on a coin flip.
 *
 * Centred on 0.5 because that is both the structural null and, empirically, his baseline rate
 * in the even bucket (3/6). Direction is read from the sign, so the centring has to happen
 * here — a raw rate would make `verdictFor` treat every losing champion as "consistent".
 */
function fromNeutralOrBehind(rows: StateRow[], band: number): Measurement {
  const set = rows.filter((r) => r.goldDiff <= band);
  if (set.length === 0) return { n: 0, effect: Number.NaN };
  return { n: set.length, effect: set.filter((r) => r.win).length / set.length - 0.5 };
}

export function standardMeasure(db: Db): Measure {
  return (spec: AnalysisSpec, window: Window): Measurement => {
    if (spec.stratum === 'none' && spec.outcome === 'binary_win') {
      return conversionGapBinary(rowsFor(db, spec, window, spec.minute), spec.band);
    }
    if (spec.stratum === 'none' && spec.outcome === 'delta_gold_6min') {
      return conversionGapDeltaGold(db, spec, window, spec.band);
    }
    if (spec.stratum === 'lane_even_or_behind' && spec.outcome === 'binary_win') {
      return fromNeutralOrBehind(rowsFor(db, spec, window, spec.minute), spec.band);
    }
    throw new LedgerError(
      `no measure for stratum '${spec.stratum}' with outcome '${spec.outcome}'. ` +
        'Add one deliberately rather than falling back to a number that means something else.',
    );
  };
}

/**
 * Games in the declared hole between the frozen baseline and the out-of-sample window.
 *
 * Counted rather than assumed, so a hole can never be silent: three games arrived hours after
 * the Fase 0 finding existed and before it was registered, and they belong to neither side.
 */
export function countGapGames(
  db: Db,
  spec: AnalysisSpec,
  baselineUntil: number,
  testFrom: number,
): number {
  return rowsFor(db, spec, { from: baselineUntil, until: testFrom }, spec.minute).length;
}
