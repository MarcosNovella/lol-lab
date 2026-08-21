import { describe, expect, it } from 'vitest';
import type { GrowthPoint } from '../src/analysis/growth.ts';
import { slopeLines } from '../src/cli/growth.ts';

/**
 * The PRINTER, not the arithmetic — `growth.test.ts` already pins `drift` and `trendSlope`.
 *
 * What is pinned here is G-052: the surface that a human reads must not state a direction from
 * a number the project has already discredited. `lol growth` did exactly that for four days
 * after G-025 killed it, and every check in the verify chain was green throughout, because none
 * of them reads a sentence.
 */

/** A series built from explicit values, so every expectation below is arithmetic, not a fixture. */
function points(mine: number[], theirs: number[]): GrowthPoint[] {
  return mine.map((value, i) => ({
    index: i + 1,
    matchId: `LA2_${i + 1}`,
    gameCreation: 1000 + i,
    champion: 'Diana',
    win: true,
    mine: value,
    theirs: theirs[i] ?? 0,
    mineRolling: value,
    theirsRolling: theirs[i] ?? 0,
  }));
}

const text = (lines: string[]): string => lines.join('\n');

describe('slopeLines', () => {
  it('prints the fitted trend beside the endpoint drift, both labelled', () => {
    const lines = text(slopeLines(points([50, 53, 56, 59], [60, 60, 60, 60])));
    // Straight line, +3 per game: the two measurements agree exactly when the series is a line.
    expect(lines).toContain('deriva punta a punta:  vos +3.000');
    expect(lines).toContain('tendencia ajustada:    vos +3.000');
    expect(lines).toContain('(dos puntos, descripción)');
    expect(lines).toContain('(sobre los 4 puntos)');
  });

  it('states the direction from the FIT and not from the endpoints', () => {
    // Endpoints say -1.0 per game (10 → 7 over 3 games). The fit over all four points says
    // +0.200, because the dip is in the middle and the series ends below where it peaked.
    // The sentence must follow the fit; the old code followed the endpoints.
    const lines = text(slopeLines(points([10, 1, 12, 7], [5, 5, 5, 5])));
    expect(lines).toContain('Tu línea se movió más que la de los rivales');
    expect(lines).toContain('(neto +0.200 por partida, ajustado).');
    expect(lines).not.toContain('Tu línea se movió menos');
  });

  it('says OJO, in capitals, when the endpoints and the fit disagree in sign', () => {
    const lines = text(slopeLines(points([10, 1, 12, 7], [5, 5, 5, 5])));
    expect(lines).toContain('SIGNO OPUESTO');
    expect(lines).toContain('las dos puntas dicen -1.000 y el ajuste dice +0.200');
    expect(lines).toContain('G-025');
  });

  it('stays quiet about the disagreement when both measurements point the same way', () => {
    const lines = text(slopeLines(points([50, 53, 56, 59], [60, 60, 60, 60])));
    expect(lines).not.toContain('SIGNO OPUESTO');
  });

  it('never prints a bare number without its sign', () => {
    const lines = slopeLines(points([10, 1, 12, 7], [5, 4, 6, 5]));
    for (const match of text(lines).matchAll(/(?<![+\-\d.])\d+\.\d{3}/g)) {
      throw new Error(`slope printed without a sign: ${match[0]} in ${text(lines)}`);
    }
  });

  it('reports "sin medir" rather than NaN when there is nothing to fit', () => {
    const lines = text(slopeLines(points([50], [60])));
    expect(lines).toContain('sin medir');
    expect(lines).not.toContain('NaN');
  });
});
