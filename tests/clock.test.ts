import { describe, it, expect } from 'vitest';
import { zonedParts, wallTimeToUtc, lastDayOfMonth } from '../src/lib/server/clock';

const OSLO = 'Europe/Oslo';

describe('lastDayOfMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(lastDayOfMonth(2025, 1)).toBe(31);
    expect(lastDayOfMonth(2025, 4)).toBe(30);
    expect(lastDayOfMonth(2025, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
  });
});

describe('wallTimeToUtc / zonedParts round-trip', () => {
  it('resolves a winter (CET, +01:00) wall time to the right instant', () => {
    // 2025-01-15 09:00 Oslo == 08:00 UTC
    const ts = wallTimeToUtc(2025, 1, 15, 9, 0, 0, OSLO);
    expect(new Date(ts).toISOString()).toBe('2025-01-15T08:00:00.000Z');
  });

  it('resolves a summer (CEST, +02:00) wall time across DST', () => {
    // 2025-07-15 09:00 Oslo == 07:00 UTC
    const ts = wallTimeToUtc(2025, 7, 15, 9, 0, 0, OSLO);
    expect(new Date(ts).toISOString()).toBe('2025-07-15T07:00:00.000Z');
  });

  it('zonedParts reports the local wall-clock fields', () => {
    const ts = wallTimeToUtc(2025, 7, 15, 9, 0, 0, OSLO);
    expect(zonedParts(ts, OSLO)).toMatchObject({ year: 2025, month: 7, day: 15, hour: 9 });
  });
});
