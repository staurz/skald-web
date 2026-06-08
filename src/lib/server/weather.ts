// MET Norway (yr.no) forecast access + the pure decisions that drive
// weather-triggered maintenance tasks. Location is Spjelkavik, Ålesund.

export const WEATHER_LAT = Number(process.env.WEATHER_LAT ?? 62.468);
export const WEATHER_LON = Number(process.env.WEATHER_LON ?? 6.394);

// MET Terms of Service require an identifying User-Agent with contact info.
export const MET_USER_AGENT = 'artic-spa-v2/1.0 emil.staurset@miles.no';

// Trigger rule: coldest forecast hour within FORECAST_HOURS must be below 0 °C.
export const FORECAST_HOURS = 48;
// Once fired, stay quiet for 180 days — covers a multi-day snap and the Dec→Jan
// year boundary, re-arming roughly a year later (≈ once per winter).
export const COOLDOWN_MS = 180 * 24 * 60 * 60 * 1000;

// Minimal shape of the MET Locationforecast 2.0 "compact" response we read.
export interface Forecast {
  properties: {
    timeseries: Array<{
      time: string; // ISO 8601
      data: { instant: { details: { air_temperature: number } } };
    }>;
  };
}

// Coldest air temperature across timeseries entries whose time is in
// [now, now + hours]. null if no entry falls in the window.
export function minTempWithinHours(forecast: Forecast, hours: number, now: number): number | null {
  const end = now + hours * 60 * 60 * 1000;
  let min: number | null = null;
  for (const e of forecast.properties.timeseries) {
    const t = Date.parse(e.time);
    if (Number.isNaN(t) || t < now || t > end) continue;
    const temp = e.data.instant.details.air_temperature;
    if (min === null || temp < min) min = temp;
  }
  return min;
}

export function isColdSnapForecast(forecast: Forecast, now: number): boolean {
  const min = minTempWithinHours(forecast, FORECAST_HOURS, now);
  return min !== null && min < 0;
}

// 180-day cooldown: fire if never fired, or the cooldown has fully elapsed.
export function shouldFire(lastFiredTs: number | null, now: number): boolean {
  return lastFiredTs === null || now - lastFiredTs >= COOLDOWN_MS;
}

// In-memory cache of the last good response so we can send If-Modified-Since and
// honour MET's 304s — required to be a well-behaved MET client.
let cache: { lastModified: string | null; body: Forecast } | null = null;

const FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

// Fetch the compact forecast for a coordinate. Returns null on ANY failure
// (network, non-200, malformed/empty body) so callers can simply skip the tick.
export async function fetchForecast(lat: number, lon: number): Promise<Forecast | null> {
  const url = `${FORECAST_URL}?lat=${lat}&lon=${lon}`;
  const headers: Record<string, string> = { 'User-Agent': MET_USER_AGENT };
  if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;
  try {
    const res = await fetch(url, { headers });
    if (res.status === 304 && cache) return cache.body;
    if (!res.ok) {
      console.warn(`[weather] forecast fetch failed: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Forecast;
    if (!json?.properties?.timeseries?.length) {
      console.warn('[weather] forecast response had no timeseries');
      return null;
    }
    cache = { lastModified: res.headers.get('last-modified'), body: json };
    return json;
  } catch (err) {
    console.warn('[weather] forecast fetch error', err);
    return null;
  }
}
