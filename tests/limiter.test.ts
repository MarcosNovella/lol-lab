import { describe, expect, it } from 'vitest';
import { createLimiter } from '../src/riot/limiter.ts';

/**
 * Time is injected, so these run instantly. `sleep` advances the fake clock instead of
 * waiting, which is the only way to test a 2-minute window without a 2-minute test.
 */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
} {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createLimiter', () => {
  it('lets the first burst through without waiting', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [{ limit: 3, ms: 1000 }],
      now: clock.now,
      sleep: clock.sleep,
    });
    const start = clock.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.now()).toBe(start);
  });

  it('waits for the window to roll before allowing one more', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [{ limit: 3, ms: 1000 }],
      now: clock.now,
      sleep: clock.sleep,
    });
    const start = clock.now();
    for (let i = 0; i < 4; i += 1) await limiter.acquire();
    // The fourth call cannot happen until the first one ages out.
    expect(clock.now() - start).toBe(1000);
  });

  it('enforces the slower window too, not just the burst one', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [
        { limit: 20, ms: 1_000 },
        { limit: 5, ms: 10_000 },
      ],
      now: clock.now,
      sleep: clock.sleep,
    });
    const start = clock.now();
    for (let i = 0; i < 6; i += 1) await limiter.acquire();
    // Burst limit of 20 would allow all six instantly; the 5-per-10s window must not.
    expect(clock.now() - start).toBe(10_000);
  });

  it('honours a 429 penalty for every caller, not just the one that tripped it', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [{ limit: 100, ms: 1000 }],
      now: clock.now,
      sleep: clock.sleep,
    });
    limiter.penalise(5);
    const start = clock.now();
    await limiter.acquire();
    expect(clock.now() - start).toBe(5000);
  });

  it('reports remaining budget per window', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [{ limit: 10, ms: 1000 }],
      now: clock.now,
      sleep: clock.sleep,
    });
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.budget()[0]?.remaining).toBe(8);
    clock.advance(1500);
    expect(limiter.budget()[0]?.remaining).toBe(10);
  });

  it('serialises concurrent callers instead of letting them all see the same free slot', async () => {
    const clock = fakeClock();
    const limiter = createLimiter({
      windows: [{ limit: 2, ms: 1000 }],
      now: clock.now,
      sleep: clock.sleep,
    });
    const start = clock.now();
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    // Four requests through a 2-per-second window go out as two batches: the first pair is
    // free at t=0, the second waits for it to age out. That is one second of waiting, not
    // two — the last batch does not have to age out before the call returns.
    expect(clock.now() - start).toBe(1000);
    // Without serialisation all four would have passed the check at t=0 and earned a 429.
    expect(limiter.budget()[0]?.remaining).toBe(0);
  });
});
