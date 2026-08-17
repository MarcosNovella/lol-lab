import { describe, expect, it } from 'vitest';
import { championKey, sameChampion } from '../src/analysis/names.ts';

describe('champion names across the three spellings', () => {
  it('joins Riot PascalCase to the op.gg display name', () => {
    // The exact pair that broke a comparison and produced a false data discrepancy (G-016).
    expect(sameChampion('TwistedFate', 'Twisted Fate')).toBe(true);
    expect(sameChampion('AurelionSol', 'Aurelion Sol')).toBe(true);
  });

  it('joins both of those to the vault kebab slug', () => {
    expect(championKey('twisted-fate')).toBe(championKey('TwistedFate'));
    expect(championKey('aurelion-sol')).toBe(championKey('Aurelion Sol'));
  });

  it('survives the names that break every word-boundary rule', () => {
    expect(sameChampion("Kai'Sa", 'KaiSa')).toBe(true);
    expect(sameChampion('Nunu & Willump', 'NunuWillump')).toBe(true);
    expect(sameChampion('Dr. Mundo', 'DrMundo')).toBe(true);
    expect(sameChampion('Renata Glasc', 'Renata')).toBe(false);
  });

  it('keeps distinct champions distinct', () => {
    expect(sameChampion('Locke', 'Lucian')).toBe(false);
    expect(sameChampion('Yone', 'Yasuo')).toBe(false);
  });
});
