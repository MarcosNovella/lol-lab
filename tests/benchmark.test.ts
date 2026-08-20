import { describe, expect, it } from 'vitest';
import { benchmark, formatComparison, mostPlayedRole } from '../src/analysis/benchmark.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { openDb } from '../src/store/db.ts';
import { saveMatch, upsertAccount } from '../src/store/matches.ts';
import { lobby, match, participant } from './fixtures.ts';

/** Builds an in-memory cache with `count` lobbies where he farms ~`myCs` CS/min. */
function seed(count: number, myCs: number, opts: { noVariance?: boolean } = {}) {
  const db = openDb(':memory:');
  upsertAccount(db, {
    puuid: 'me',
    gameName: 'Tester',
    tagLine: 'LAS',
    platform: 'la2',
    label: 'test',
  });
  for (let i = 0; i < count; i += 1) {
    const m = lobby({
      matchId: `LA2_${i}`,
      myCsPerMinTarget: myCs,
      index: i,
      gameCreation: 1_760_000_000_000 + i * 3_600_000,
      win: i % 2 === 0,
      ...(opts.noVariance === true ? { noVariance: true } : {}),
    });
    saveMatch(db, flattenMatch(m), m);
  }
  return db;
}

const OPTS = { puuid: 'me', accountLabel: 'Tester#LAS', queueLabel: 'soloq' } as const;

describe('benchmark', () => {
  it('says so instead of guessing when the cache is empty', () => {
    const db = openDb(':memory:');
    upsertAccount(db, { puuid: 'me', gameName: 'T', tagLine: 'LAS', platform: 'la2' });
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    expect(result.games).toBe(0);
    expect(result.notes.join(' ')).toContain('riot_sync');
  });

  it('flags the metric where he is behind his lane opponents', () => {
    // Peers farm 210 CS over 30 min = 7.0/min. He farms 5.0/min.
    const db = seed(10, 5);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });

    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');
    expect(cs).toBeDefined();
    expect(cs?.yours).toBeCloseTo(5, 1);
    expect(cs?.peerMean).toBeCloseTo(7, 1);
    expect(cs?.effect).toBeLessThan(0);
    expect(cs?.severity).toBe('crítico');
    // CS/min is contaminated, so the gap is measured but may not headline an unstratified
    // report (G-008) — and it ranks the moment a stratum holds the snowball constant.
    expect(result.weakest.some((c) => c.key === 'cs_per_min')).toBe(false);
    const stratified = benchmark(db, { ...OPTS, role: 'MIDDLE', stratum: 'pareja al minuto 14' });
    expect(stratified.weakest.some((c) => c.key === 'cs_per_min')).toBe(true);
  });

  it('recognises the same metric as a strength when he is ahead', () => {
    const db = seed(10, 9);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');
    expect(cs?.effect).toBeGreaterThan(0);
    expect(result.strongest.some((c) => c.key === 'cs_per_min')).toBe(false);
    const stratified = benchmark(db, { ...OPTS, role: 'MIDDLE', stratum: 'pareja al minuto 14' });
    expect(stratified.strongest.some((c) => c.key === 'cs_per_min')).toBe(true);
  });

  it('counts head-to-head wins against the direct lane opponent', () => {
    const db = seed(10, 5);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');
    // He is behind in all ten, so zero head-to-head wins and no ties.
    expect(cs?.headToHead).toEqual({ wins: 0, ties: 0, games: 10, rate: 0 });
  });

  it('counts ties separately so a mostly-tied ordinal is not read as losing', () => {
    // laningPhaseGoldExpAdvantage is an ordinal that sits at 0 in most games. The fixture
    // gives both players the same value every game, so every game is a tie: reporting that
    // as "0 wins out of 10" would call an even matchup a defeat.
    const db = seed(10, 5);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const lane = result.comparisons.find((c) => c.key === 'lane_adv');
    expect(lane?.headToHead?.ties).toBe(10);
    expect(lane?.headToHead?.games).toBe(10);
    // Zero decided games must not produce a misleading 0% win rate on 10 games.
    expect(lane?.headToHead?.rate).toBe(0);
    if (lane) expect(formatComparison(lane)).toContain('10 empatadas');
  });

  it('orients "lower is better" metrics so more deaths is never reported as good', () => {
    const db = openDb(':memory:');
    upsertAccount(db, { puuid: 'me', gameName: 'T', tagLine: 'LAS', platform: 'la2' });
    for (let i = 0; i < 8; i += 1) {
      const players = [
        participant({ puuid: 'me', teamId: 100, teamPosition: 'MIDDLE', deaths: 12 }),
        participant({
          puuid: `enemy-${i}`,
          teamId: 200,
          teamPosition: 'MIDDLE',
          deaths: 2,
          win: false,
        }),
      ];
      const m = match({
        matchId: `LA2_D${i}`,
        gameCreation: 1_760_000_000_000 + i * 3_600_000,
        participants: players,
      });
      saveMatch(db, flattenMatch(m), m);
    }
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const deaths = result.comparisons.find((c) => c.key === 'deaths_per_min');
    expect(deaths?.yours).toBeGreaterThan(deaths?.peerMean ?? 0);
    // Dying six times as often must read as negative, not positive.
    expect(deaths?.effect).toBeLessThan(0);
    expect(deaths?.percentile).toBeLessThan(50);
  });

  it('still reports a gap when both distributions are constant (G-005)', () => {
    // Every game identical on both sides => pooled variance 0 => Cohen's d undefined.
    // The gap between 5.0 and 7.0 CS/min is still real and must not read as "parejo".
    const db = seed(10, 5, { noVariance: true });
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');

    expect(cs?.yours).toBeCloseTo(5, 1);
    expect(cs?.peerMean).toBeCloseTo(7, 1);
    expect(Number.isNaN(cs?.effect ?? 0)).toBe(true); // honest: d really is undefined here
    expect(cs?.score).toBeLessThan(0); // but the ranking still knows he is behind
    expect(cs?.severity).toBe('crítico');
    // The fallback score has to survive all the way into the ranking, not just into the row.
    // Checked under a stratum because CS/min is contaminated and cannot rank without one.
    const stratified = benchmark(db, { ...OPTS, role: 'MIDDLE', stratum: 'pareja al minuto 14' });
    expect(stratified.weakest.some((c) => c.key === 'cs_per_min')).toBe(true);
  });

  it('never prints NaN at a human', () => {
    const db = seed(10, 5, { noVariance: true });
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');
    expect(cs).toBeDefined();
    if (cs) expect(formatComparison(cs)).not.toContain('NaN');
  });

  it('marks thin samples instead of ranking them', () => {
    const db = seed(3, 5);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    const cs = result.comparisons.find((c) => c.key === 'cs_per_min');
    expect(cs?.enoughData).toBe(false);
    expect(result.weakest).toHaveLength(0);
    expect(result.notes.join(' ')).toContain('muestra chica');
  });

  it('excludes remakes from the numbers', () => {
    const db = seed(6, 5);
    const remake = lobby({ matchId: 'LA2_REMAKE', myCsPerMinTarget: 0, durationSeconds: 84 });
    saveMatch(db, flattenMatch(remake), remake);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE' });
    expect(result.games).toBe(6);
  });

  it('finds the role he actually plays', () => {
    expect(mostPlayedRole(seed(4, 6), 'me')).toBe('MIDDLE');
  });

  it('warns when no role filter is given, because role metrics stop meaning anything', () => {
    const result = benchmark(seed(6, 5), OPTS);
    expect(result.role).toBe('todos');
    expect(result.notes.join(' ')).toContain('Sin filtro de rol');
  });
});

/**
 * G-009 as a test rather than as a paragraph.
 *
 * The rule was written the day "percentil 97 en ventaja de oro+XP en línea" shipped over a
 * field that is 0 in 24 games and 1 in 12, and it stayed a line in `guardrails.md` while the
 * two metrics that caused it went on being ranked. These pin the gate that closes it.
 */
describe('banderas 0/1 (G-009)', () => {
  /** Seeds a lobby where the two lane-advantage flags actually vary, as they do in real data. */
  function seedFlags(count: number) {
    const db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'Tester',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'test',
    });
    for (let i = 0; i < count; i += 1) {
      const m = lobby({
        matchId: `LA2_F${i}`,
        myCsPerMinTarget: 7.2,
        index: i,
        gameCreation: 1_760_000_000_000 + i * 3_600_000,
        win: i % 2 === 0,
      });
      // He trips the flag in two of every three games, his opponents in one of three: a real
      // difference in RATE, and no difference in magnitude, because there is no magnitude.
      for (const p of m.info.participants) {
        const mine = p.puuid === 'me';
        const on = mine ? i % 3 !== 0 : i % 3 === 0;
        p.challenges = {
          ...p.challenges,
          earlyLaningPhaseGoldExpAdvantage: on ? 1 : 0,
          laningPhaseGoldExpAdvantage: on ? 1 : 0,
        };
      }
      saveMatch(db, flattenMatch(m), m);
    }
    return db;
  }

  it('never ranks a flag, however causal it is', () => {
    const db = seedFlags(12);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE', queueId: 420 });

    const flag = result.comparisons.find((c) => c.key === 'lane_adv');
    expect(flag).toBeDefined();
    // `causal` clears G-008. It is the shape of the values that stops it here.
    expect(flag?.contamination).toBe('causal');
    expect(flag?.distribution).toBe('flag');
    expect(flag?.rankable).toBe(false);
    expect([...result.weakest, ...result.strongest].map((c) => c.key)).not.toContain('lane_adv');
  });

  it('hands back no percentile and no effect size for a flag, rather than a misleading one', () => {
    const db = seedFlags(12);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE', queueId: 420 });
    const flag = result.comparisons.find((c) => c.key === 'early_lane_adv');

    expect(flag?.percentile).toBeNull();
    expect(flag?.effect).toBeNull();
    // The rate survives, because the rate is the honest reading: he trips it more often.
    expect(flag?.yours).toBeGreaterThan(flag?.peerMean ?? 1);
  });

  it('prints a flag as a rate and never as a percentile', () => {
    const db = seedFlags(12);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE', queueId: 420 });
    const flag = result.comparisons.find((c) => c.key === 'lane_adv');
    const line = formatComparison(flag as NonNullable<typeof flag>);

    expect(line).toContain('bandera 0/1');
    expect(line).toContain('de tus partidas');
    expect(line).not.toContain('percentil');
    expect(line).not.toContain('NaN');
    expect(line).not.toContain('null');
  });

  it('still ranks an ordinary magnitude, so the gate is not just "rank nothing"', () => {
    const db = seedFlags(12);
    const result = benchmark(db, { ...OPTS, role: 'MIDDLE', queueId: 420 });
    const cs = result.comparisons.find((c) => c.key === 'cs_first_10');

    expect(cs?.distribution).toBe('magnitude');
    expect(cs?.rankable).toBe(true);
    expect(cs?.percentile).not.toBeNull();
  });

  it('demotes a DECLARED magnitude the sample shows to be binary, and says it out loud', () => {
    // The declaration is a claim about Riot's data and `tsc` cannot check it. `turret_plates`
    // is declared a magnitude and is genuinely a count; here every game has 0 or 1 of them,
    // so the sample contradicts the catalogue and the sample wins.
    const db = openDb(':memory:');
    upsertAccount(db, { puuid: 'me', gameName: 'T', tagLine: 'LAS', platform: 'la2' });
    for (let i = 0; i < 12; i += 1) {
      const m = lobby({
        matchId: `LA2_D${i}`,
        index: i,
        gameCreation: 1_760_000_000_000 + i * 3_600_000,
        win: i % 2 === 0,
      });
      for (const p of m.info.participants) {
        p.challenges = { ...p.challenges, turretPlatesTaken: i % 2 };
      }
      saveMatch(db, flattenMatch(m), m);
    }

    const result = benchmark(db, { ...OPTS, role: 'MIDDLE', queueId: 420 });
    const plates = result.comparisons.find((c) => c.key === 'turret_plates');

    expect(plates?.distribution).toBe('flag');
    expect(plates?.rankable).toBe(false);
    expect(plates?.percentile).toBeNull();
    expect(result.notes.join(' ')).toContain('Placas de torreta');
    expect(result.notes.join(' ')).toContain('declarada como magnitud');
  });
});
