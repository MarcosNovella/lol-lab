import { describe, expect, it } from 'vitest';

/**
 * Guards G-006. The server formats every timestamp for Argentina, and the tempting
 * `.slice(-5)` on a locale string silently prints " p. m." instead of the clock.
 */

const AR_TIME = 'America/Argentina/Buenos_Aires';

function localClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-AR', {
    timeZone: AR_TIME,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

describe('localClock', () => {
  it('renders a 24-hour clock, not a 12-hour one with a suffix', () => {
    // 2026-08-12T23:25:00Z is 20:25 in Argentina (UTC-3).
    const t = Date.parse('2026-08-12T23:25:00Z');
    expect(localClock(t)).toBe('20:25');
  });

  it('keeps afternoon times unambiguous', () => {
    expect(localClock(Date.parse('2026-04-10T18:45:00Z'))).toBe('15:45');
  });

  it('does not leak the locale meridiem marker', () => {
    const t = Date.parse('2026-04-10T18:45:00Z');
    expect(localClock(t)).not.toContain('m.');
    // The naive version this replaced returned exactly that.
    const naive = new Date(t)
      .toLocaleString('es-AR', { timeZone: AR_TIME, dateStyle: 'short', timeStyle: 'short' })
      .slice(-5);
    expect(naive).not.toBe(localClock(t));
  });

  it('handles midnight without wrapping to 24', () => {
    expect(localClock(Date.parse('2026-08-13T03:10:00Z'))).toBe('00:10');
  });
});
