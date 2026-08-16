import { describe, expect, it } from 'vitest';
import {
  cohensD,
  mean,
  median,
  percentileOf,
  pooledSd,
  quantile,
  sampleSd,
} from '../src/analysis/stats.ts';

describe('stats', () => {
  it('mean and median', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('sample sd uses n-1 and needs two points', () => {
    // [2,4,4,4,5,5,7,9] has population sd 2 and sample sd sqrt(32/7)
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(Number.isNaN(sampleSd([5]))).toBe(true);
  });

  it('pooled sd of two identical spreads equals that spread', () => {
    expect(pooledSd([1, 2, 3], [11, 12, 13])).toBeCloseTo(1, 10);
  });

  it("Cohen's d is the mean gap in pooled sd units, and signed by argument order", () => {
    // means 12 and 2, pooled sd 1 => d = 10
    expect(cohensD([11, 12, 13], [1, 2, 3])).toBeCloseTo(10, 10);
    expect(cohensD([1, 2, 3], [11, 12, 13])).toBeCloseTo(-10, 10);
  });

  it('percentileOf splits ties down the middle instead of inflating', () => {
    expect(percentileOf(5, [1, 2, 3, 4])).toBe(100);
    expect(percentileOf(0, [1, 2, 3, 4])).toBe(0);
    expect(percentileOf(3, [1, 2, 3, 4])).toBe(62.5); // 2 below + half of 1 equal, over 4
    expect(percentileOf(2, [1, 2, 2, 3])).toBe(50);
  });

  it('quantile interpolates', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
});
