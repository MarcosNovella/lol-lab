import { describe, expect, it } from 'vitest';
import { durationSeconds, flattenMatch, patchOf } from '../src/analysis/flatten.ts';
import { match, participant } from './fixtures.ts';

describe('durationSeconds', () => {
  it('reads seconds when gameEndTimestamp is present (patch 11.20 and later)', () => {
    const m = match({ durationSeconds: 1800 });
    expect(durationSeconds(m.info)).toBe(1800);
  });

  it('converts milliseconds when gameEndTimestamp is absent (older matches)', () => {
    const m = match({ durationSeconds: 1800, legacyMillisDuration: true });
    expect(m.info.gameEndTimestamp).toBeUndefined();
    expect(m.info.gameDuration).toBe(1_800_000);
    // Without this branch every per-minute metric on an old match is off by 1000x.
    expect(durationSeconds(m.info)).toBe(1800);
  });
});

describe('patchOf', () => {
  it('keeps major.minor only', () => {
    expect(patchOf('16.16.700.1234')).toBe('16.16');
  });
  it('returns null when Riot omits the version', () => {
    expect(patchOf(undefined)).toBeNull();
  });
});

describe('flattenMatch', () => {
  it('derives per-minute metrics from the real duration', () => {
    const m = match({ durationSeconds: 1800 }); // 30 minutes
    const flat = flattenMatch(m);
    const me = flat.participants.find((p) => p.puuid === 'me');
    expect(me).toBeDefined();
    // 180 minions + 10 neutral over 30 minutes
    expect(me?.cs).toBe(190);
    expect(me?.csPerMin).toBeCloseTo(190 / 30, 6);
    expect(me?.goldPerMin).toBeCloseTo(12000 / 30, 6);
  });

  it('uses Riot KDA convention so a deathless game does not divide by zero', () => {
    const m = match({
      participants: [participant({ puuid: 'me', kills: 10, deaths: 0, assists: 4 })],
    });
    expect(flattenMatch(m).participants[0]?.kda).toBe(14);
  });

  it('flags short games as remakes', () => {
    expect(flattenMatch(match({ durationSeconds: 84 })).isRemake).toBe(true);
    expect(flattenMatch(match({ durationSeconds: 1800 })).isRemake).toBe(false);
  });

  it('flags early surrenders as remakes even when the clock ran long enough', () => {
    const m = match({
      durationSeconds: 900,
      participants: [participant({ puuid: 'me', gameEndedInEarlySurrender: true })],
    });
    expect(flattenMatch(m).isRemake).toBe(true);
  });

  it('keeps an empty teamPosition rather than guessing (G-004)', () => {
    const m = match({ participants: [participant({ puuid: 'me', teamPosition: '' })] });
    expect(flattenMatch(m).participants[0]?.teamPosition).toBe('');
  });

  it('copies Riot challenge metrics through and tolerates their absence', () => {
    const withChallenges = flattenMatch(match()).participants[0];
    expect(withChallenges?.killParticipation).toBe(0.5);
    expect(withChallenges?.csFirst10).toBe(70);

    const bare = flattenMatch(
      match({ participants: [participant({ puuid: 'me', challenges: {} })] }),
    ).participants[0];
    expect(bare?.killParticipation).toBeNull();
    expect(bare?.soloKills).toBeNull();
  });
});
