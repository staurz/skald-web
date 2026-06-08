import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  minTempWithinHours,
  isColdSnapForecast,
  shouldFire,
  fetchForecast,
} from '../src/lib/server/weather';
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

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('fetchForecast', () => {
  const body = { properties: { timeseries: [{ time: '2026-01-10T00:00:00Z', data: { instant: { details: { air_temperature: -3 } } } }] } };

  it('returns parsed forecast on 200 and sends a User-Agent', async () => {
    let seenUA: string | undefined;
    stubFetch(async (_url, init) => {
      seenUA = new Headers(init?.headers).get('User-Agent') ?? undefined;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'last-modified': 'Sat, 10 Jan 2026 00:00:00 GMT' } });
    });
    const f = await fetchForecast(62.468, 6.394);
    expect(f?.properties.timeseries).toHaveLength(1);
    expect(seenUA).toContain('artic-spa-v2');
  });

  it('returns null on non-200', async () => {
    stubFetch(async () => new Response('nope', { status: 503 }));
    expect(await fetchForecast(1, 2)).toBeNull();
  });

  it('returns null on a network error', async () => {
    stubFetch(async () => { throw new Error('ECONNRESET'); });
    expect(await fetchForecast(1, 2)).toBeNull();
  });

  it('returns null on an empty/garbage body', async () => {
    stubFetch(async () => new Response(JSON.stringify({ properties: { timeseries: [] } }), { status: 200 }));
    expect(await fetchForecast(1, 2)).toBeNull();
  });
});
