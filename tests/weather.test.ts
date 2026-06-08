import { describe, it, expect } from 'vitest';
import { minTempWithinHours, isColdSnapForecast, shouldFire } from '../src/lib/server/weather';
import type { Forecast } from '../src/lib/server/weather';

const NOW = Date.parse('2026-01-10T00:00:00Z');
const H = 60 * 60 * 1000;

function fc(entries: [string, number][]): Forecast {
  return {
    properties: {
      timeseries: entries.map(([time, t]) => ({
        time,
        data: { instant: { details: { air_temperature: t } } },
      })),
    },
  };
}

describe('minTempWithinHours', () => {
  it('returns the coldest temp inside the window', () => {
    const f = fc([
      ['2026-01-10T01:00:00Z', 3],
      ['2026-01-10T06:00:00Z', -2],
      ['2026-01-10T12:00:00Z', 1],
    ]);
    expect(minTempWithinHours(f, 48, NOW)).toBe(-2);
  });

  it('ignores entries outside the window', () => {
    const f = fc([
      ['2026-01-10T06:00:00Z', 4], // inside 48h
      ['2026-01-13T06:00:00Z', -9], // 78h out — excluded
    ]);
    expect(minTempWithinHours(f, 48, NOW)).toBe(4);
  });

  it('returns null when no entry falls in the window', () => {
    const f = fc([['2026-01-20T00:00:00Z', -5]]);
    expect(minTempWithinHours(f, 48, NOW)).toBeNull();
  });
});

describe('isColdSnapForecast', () => {
  it('true when a sub-zero hour is within 48h', () => {
    expect(isColdSnapForecast(fc([['2026-01-11T00:00:00Z', -0.4]]), NOW)).toBe(true);
  });
  it('false when all in-window hours are >= 0', () => {
    expect(isColdSnapForecast(fc([['2026-01-11T00:00:00Z', 0]]), NOW)).toBe(false);
  });
  it('false when there is no in-window data', () => {
    expect(isColdSnapForecast(fc([['2026-02-01T00:00:00Z', -10]]), NOW)).toBe(false);
  });
});

describe('shouldFire (180-day cooldown)', () => {
  const DAY = 24 * H;
  it('fires when never fired before', () => {
    expect(shouldFire(null, NOW)).toBe(true);
  });
  it('suppressed inside the cooldown', () => {
    expect(shouldFire(NOW - 179 * DAY, NOW)).toBe(false);
  });
  it('re-arms after 180 days', () => {
    expect(shouldFire(NOW - 181 * DAY, NOW)).toBe(true);
  });
});
