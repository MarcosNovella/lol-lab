import { describe, expect, it } from 'vitest';
import { benchmark } from '../src/analysis/benchmark.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { METRICS } from '../src/analysis/metrics.ts';
import { bucketOf, EVEN_GOLD_BAND, frameAtMinute, laneStateAt } from '../src/analysis/state.ts';
import type { MatchDto, TimelineDto } from '../src/riot/types.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch } from '../src/store/matches.ts';
import { lobby } from './fixtures.ts';

/**
 * G-008, enforced rather than documented.
 *
 * The failure being prevented: the first benchmark reported him ahead of his lane opponent in
 * 17 of 18 metrics and concluded his laning was not the problem, while his win rate was
 * 52.8%. Fourteen of those metrics are downstream of winning, and his stomps dominated every
 * mean. If someone later adds a metric without classifying it, or relaxes the ranking filter,
 * these tests fail before the report can lie again.
 */

function seedGames(db: Db, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const raw = lobby({
      matchId: `LA2_${i}`,
      index: i,
      myCsPerMinTarget: 7.5,
      peerCsPerMinTarget: 6,
      win: i % 2 === 0,
      gameCreation: 1_760_000_000_000 + i * 86_400_000,
    });
    saveMatch(db, flattenMatch(raw), raw);
  }
}

describe('metric catalogue', () => {
  it('classifies every metric — a new one cannot be added without deciding (G-008)', () => {
    for (const metric of METRICS) {
      expect(
        ['causal', 'contaminated', 'conditional'],
        `${metric.key} has no valid contamination class`,
      ).toContain(metric.contamination);
    }
  });

  it('keeps at least one causal metric, or an unstratified report can say nothing', () => {
    expect(METRICS.filter((m) => m.contamination === 'causal').length).toBeGreaterThan(0);
  });

  it('marks the whole-game rate metrics as contaminated', () => {
    // These are the ones that produced the false headline; naming them explicitly means a
    // future reclassification has to be a deliberate edit to this list, not a silent flip.
    for (const key of ['kda', 'cs_per_min', 'deaths_per_min', 'vision_per_min', 'damage_per_min']) {
      const metric = METRICS.find((m) => m.key === key);
      expect(metric?.contamination, `${key} must stay contaminated`).toBe('contaminated');
    }
  });
});

describe('benchmark ranking obeys the contamination class', () => {
  it('never ranks a contaminated metric when no stratum is fixed', () => {
    const db = openDb(':memory:');
    seedGames(db, 12);

    const result = benchmark(db, {
      puuid: 'me',
      accountLabel: 'test',
      role: 'MIDDLE',
      queueId: 420,
      queueLabel: 'soloq',
    });

    expect(result.comparisons.length).toBeGreaterThan(0);
    for (const c of [...result.weakest, ...result.strongest]) {
      expect(c.contamination, `${c.key} headlined the report while contaminated`).toBe('causal');
    }
  });

  it('still COMPUTES contaminated metrics — they are shown, just never ranked', () => {
    const db = openDb(':memory:');
    seedGames(db, 12);

    const result = benchmark(db, {
      puuid: 'me',
      accountLabel: 'test',
      role: 'MIDDLE',
      queueId: 420,
      queueLabel: 'soloq',
    });

    const kda = result.comparisons.find((c) => c.key === 'kda');
    expect(kda).toBeDefined();
    expect(kda?.rankable).toBe(false);
    expect(result.notes.join(' ')).toContain('contaminadas por el resultado');
  });

  it('unlocks contaminated metrics once a stratum is declared', () => {
    const db = openDb(':memory:');
    seedGames(db, 12);

    const result = benchmark(db, {
      puuid: 'me',
      accountLabel: 'test',
      role: 'MIDDLE',
      queueId: 420,
      queueLabel: 'soloq',
      stratum: 'pareja al minuto 14',
    });

    // Every MAGNITUDE, and only those. A stratum answers G-008 — "is this number downstream of
    // winning" — and says nothing about G-009 — "does this number have a size at all". A causal
    // 0/1 flag clears the first gate and fails the second, which is the case that shipped once.
    const magnitudes = result.comparisons.filter((c) => c.distribution === 'magnitude');
    expect(magnitudes.length).toBeGreaterThan(0);
    expect(magnitudes.every((c) => c.rankable)).toBe(true);
    expect(result.notes.join(' ')).toContain('Estrato fijo');

    const flags = result.comparisons.filter((c) => c.distribution === 'flag');
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((c) => c.rankable)).toBe(false);
  });
});

// ------------------------------------------------------------------ game state

function timelineWith(frames: { minute: number; gold: [number, number] }[]): TimelineDto {
  return {
    metadata: { matchId: 'LA2_T', participants: ['me', 'LA2_T-enemy-MIDDLE'] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: 'LA2_T-enemy-MIDDLE' },
      ],
      frames: frames.map((f) => ({
        timestamp: f.minute * 60_000,
        participantFrames: {
          '1': { participantId: 1, totalGold: f.gold[0], xp: 0, minionsKilled: 0 },
          '2': { participantId: 2, totalGold: f.gold[1], xp: 0, minionsKilled: 0 },
        },
      })),
    },
  };
}

function twoPlayerMatch(): MatchDto {
  const raw = lobby({ matchId: 'LA2_T', myCsPerMinTarget: 7 });
  raw.info.participants = raw.info.participants.filter(
    (p) => p.teamPosition === 'MIDDLE' && (p.puuid === 'me' || p.puuid === 'LA2_T-enemy-MIDDLE'),
  );
  raw.metadata.participants = raw.info.participants.map((p) => p.puuid);
  return raw;
}

describe('game state at a fixed minute', () => {
  it('buckets by the gold band, oriented so positive is always his lead', () => {
    expect(bucketOf(EVEN_GOLD_BAND + 1)).toBe('arriba');
    expect(bucketOf(-EVEN_GOLD_BAND - 1)).toBe('atrás');
    expect(bucketOf(0)).toBe('pareja');
    expect(bucketOf(EVEN_GOLD_BAND)).toBe('pareja');
  });

  it('reads the lane gold difference at the requested minute', () => {
    const match = twoPlayerMatch();
    const tl = timelineWith([
      { minute: 0, gold: [500, 500] },
      { minute: 14, gold: [7000, 5200] },
    ]);

    const state = laneStateAt(match, tl, 'me', 14);
    expect(state?.goldDiff).toBe(1800);
    expect(state?.bucket).toBe('arriba');
    expect(state?.opponentPuuid).toBe('LA2_T-enemy-MIDDLE');
  });

  it('returns null when the game ended before the minute, instead of reusing the last frame', () => {
    // A 12-minute stomp has no minute-14 state. Extrapolating would file it as an even game
    // and quietly move a blowout into the stratum the whole diagnosis rests on.
    const match = twoPlayerMatch();
    const tl = timelineWith([
      { minute: 0, gold: [500, 500] },
      { minute: 12, gold: [6000, 3000] },
    ]);

    expect(frameAtMinute(tl, 14)).toBeNull();
    expect(laneStateAt(match, tl, 'me', 14)).toBeNull();
  });
});
