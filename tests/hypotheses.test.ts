import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AnalysisSpec,
  canonicalSpec,
  evaluateHypothesis,
  evaluationsOf,
  getHypothesis,
  LedgerError,
  listHypotheses,
  type Measure,
  type RegisterInput,
  registerHypothesis,
  retireHypothesis,
  specHash,
  verdictFor,
  type Window,
} from '../src/analysis/hypotheses.ts';
import { type Db, openDb } from '../src/store/db.ts';

const SPEC: AnalysisSpec = {
  puuid: 'p-smurf',
  role: 'MIDDLE',
  queueId: 420,
  minute: 14,
  band: 500,
  outcome: 'binary_win',
  stratum: 'none',
  champion: null,
};

const BASE: RegisterInput = {
  id: 'lead_conversion_gap',
  claim: 'from a lead at 14 his win rate is below his opponents from the same state',
  direction: 'lower',
  spec: SPEC,
  baselineUntil: 1000,
  testFrom: 2000,
  gapGames: 3,
  baselineN: 30,
  baselineEffect: -0.1,
  nNeeded: 300,
  caveat: 'fails a minute sweep; sign flips at 12 and 16',
};

const measuring =
  (n: number, effect: number): Measure =>
  () => ({ n, effect });

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('the analysis spec is frozen', () => {
  it('hashes independently of the key order the caller used', () => {
    const shuffled: AnalysisSpec = {
      champion: null,
      stratum: 'none',
      outcome: 'binary_win',
      band: 500,
      minute: 14,
      queueId: 420,
      role: 'MIDDLE',
      puuid: 'p-smurf',
    };
    expect(canonicalSpec(shuffled)).toBe(canonicalSpec(SPEC));
    expect(specHash(shuffled)).toBe(specHash(SPEC));
  });

  it('changes the hash when ANY knob moves', () => {
    const base = specHash(SPEC);
    expect(specHash({ ...SPEC, minute: 16 })).not.toBe(base);
    expect(specHash({ ...SPEC, band: 300 })).not.toBe(base);
    expect(specHash({ ...SPEC, role: 'TOP' })).not.toBe(base);
    expect(specHash({ ...SPEC, queueId: 440 })).not.toBe(base);
    expect(specHash({ ...SPEC, puuid: 'p-main' })).not.toBe(base);
    expect(specHash({ ...SPEC, outcome: 'delta_gold_6min' })).not.toBe(base);
    expect(specHash({ ...SPEC, stratum: 'lane_ahead' })).not.toBe(base);
    expect(specHash({ ...SPEC, champion: 'Diana' })).not.toBe(base);
  });

  it('refuses to evaluate under a spec that is not the registered one (G-013)', () => {
    registerHypothesis(db, BASE, 1500);
    // The minute is exactly the knob that was never swept and that broke the finding.
    expect(() =>
      evaluateHypothesis(db, BASE.id, { ...SPEC, minute: 16 }, measuring(400, -0.2)),
    ).toThrow(LedgerError);
    expect(evaluationsOf(db, BASE.id)).toHaveLength(0);
  });
});

describe('registration', () => {
  it('stores a timestamp and both boundaries, keeping the gap explicit', () => {
    const h = registerHypothesis(db, BASE, 1500);
    expect(h.registeredAt).toBe(1500);
    expect(h.baselineUntil).toBe(1000);
    expect(h.testFrom).toBe(2000);
    expect(h.gapGames).toBe(3);
    expect(h.specHash).toBe(specHash(SPEC));
  });

  it('refuses a window that overlaps the baseline', () => {
    expect(() => registerHypothesis(db, { ...BASE, baselineUntil: 2000, testFrom: 1000 })).toThrow(
      /overlap/,
    );
  });

  it('refuses a hypothesis with no stated caveat', () => {
    expect(() => registerHypothesis(db, { ...BASE, caveat: '   ' })).toThrow(/caveat/);
  });

  it('refuses to re-register an id, because the ledger is append-only', () => {
    registerHypothesis(db, BASE);
    expect(() => registerHypothesis(db, { ...BASE, baselineEffect: -0.9 })).toThrow(
      /already exists/,
    );
    expect(getHypothesis(db, BASE.id)?.baselineEffect).toBe(-0.1);
  });

  it('refuses an id that is not a slug', () => {
    expect(() => registerHypothesis(db, { ...BASE, id: 'Lead Conversion' })).toThrow(/slug/);
  });
});

describe('verdicts stay honest below the required n', () => {
  it('never claims a direction while n is short, however large the effect', () => {
    expect(verdictFor('lower', -0.9, 12, 300)).toBe('insufficient_n');
    expect(verdictFor('higher', 5000, 299, 300)).toBe('insufficient_n');
  });

  it('reads the sign once n is there', () => {
    expect(verdictFor('lower', -0.2, 300, 300)).toBe('consistent');
    expect(verdictFor('lower', 0.2, 300, 300)).toBe('inconsistent');
    expect(verdictFor('higher', 0.2, 300, 300)).toBe('consistent');
  });

  it('calls an effect of exactly zero no_effect, never consistent (G-012)', () => {
    expect(verdictFor('lower', 0, 300, 300)).toBe('no_effect');
    expect(verdictFor('higher', 0, 300, 300)).toBe('no_effect');
  });

  it('calls an unmeasurable effect no_effect rather than guessing', () => {
    expect(verdictFor('lower', Number.NaN, 300, 300)).toBe('no_effect');
  });
});

describe('evaluation', () => {
  it('records the effect even when the verdict must stay insufficient_n', () => {
    registerHypothesis(db, BASE, 1500);
    const e = evaluateHypothesis(db, BASE.id, SPEC, measuring(6, -0.25), {
      elo: 'Platinum II',
      now: 3000,
    });
    expect(e.verdict).toBe('insufficient_n');
    expect(e.effect).toBe(-0.25);
    expect(e.n).toBe(6);
    expect(e.elo).toBe('Platinum II');
  });

  it('round-trips an unmeasurable effect as NaN, never as zero (G-014)', () => {
    // SQLite has no NaN: node:sqlite binds it as NULL, and `Number(null)` is 0. Storing an
    // empty out-of-sample window would otherwise read back as "the effect is exactly zero",
    // which is the exact confusion G-005 exists to prevent.
    registerHypothesis(db, { ...BASE, baselineEffect: Number.NaN }, 1500);
    expect(Number.isNaN(getHypothesis(db, BASE.id)?.baselineEffect ?? 0)).toBe(true);

    const e = evaluateHypothesis(db, BASE.id, SPEC, measuring(0, Number.NaN), { now: 3000 });
    expect(Number.isNaN(e.effect)).toBe(true);
    expect(Number.isNaN(evaluationsOf(db, BASE.id)[0]?.effect ?? 0)).toBe(true);
  });

  it('appends rather than replaces, so the trend survives', () => {
    registerHypothesis(db, BASE, 1500);
    evaluateHypothesis(db, BASE.id, SPEC, measuring(6, -0.25), { now: 3000 });
    evaluateHypothesis(db, BASE.id, SPEC, measuring(11, -0.05), { now: 4000 });
    const all = evaluationsOf(db, BASE.id);
    expect(all.map((e) => e.n)).toEqual([6, 11]);
    expect(all.map((e) => e.effect)).toEqual([-0.25, -0.05]);
  });

  it('hands the measure the registered testFrom, not the caller a free choice', () => {
    registerHypothesis(db, BASE, 1500);
    let seen: Window | null = null;
    evaluateHypothesis(db, BASE.id, SPEC, (_spec, window) => {
      seen = window;
      return { n: 1, effect: -1 };
    });
    expect(seen).toEqual({ from: 2000, until: Number.POSITIVE_INFINITY });
  });
});

describe('retirement', () => {
  it('hides a retired hypothesis and refuses to evaluate it again', () => {
    registerHypothesis(db, BASE, 1500);
    retireHypothesis(db, BASE.id, 'failed out of sample over 300 games', 5000);
    expect(listHypotheses(db)).toHaveLength(0);
    expect(listHypotheses(db, true)).toHaveLength(1);
    expect(() => evaluateHypothesis(db, BASE.id, SPEC, measuring(400, -0.2))).toThrow(/retired/);
  });

  it('demands a reason', () => {
    registerHypothesis(db, BASE);
    expect(() => retireHypothesis(db, BASE.id, '  ')).toThrow(/reason/);
  });
});
