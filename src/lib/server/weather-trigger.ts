import type Database from 'better-sqlite3';
import { fetchForecast, isColdSnapForecast, shouldFire, WEATHER_LAT, WEATHER_LON } from './weather';
import { selectWeatherTriggerTasks, markWeatherTriggered } from './maintenance';
import { sendToAll } from './push';

// Injected so the loop can be tested without network or real push delivery.
export interface WeatherTriggerDeps {
  fetchForecast: typeof fetchForecast;
  sendToAll: typeof sendToAll;
}

const defaultDeps: WeatherTriggerDeps = { fetchForecast, sendToAll };

// One pass: if a sub-zero snap is forecast, set each eligible flagged task due
// now and push a cold-snap notification. Eligibility = enabled, flagged, and
// outside its 180-day cooldown. Returns the number of tasks fired.
export async function checkWeatherTriggers(
  db: Database.Database,
  now: number,
  deps: WeatherTriggerDeps = defaultDeps,
): Promise<number> {
  const forecast = await deps.fetchForecast(WEATHER_LAT, WEATHER_LON);
  if (!forecast || !isColdSnapForecast(forecast, now)) return 0;

  let fired = 0;
  for (const t of selectWeatherTriggerTasks(db)) {
    if (!shouldFire(t.lastWeatherFiredTs, now)) continue;
    markWeatherTriggered(db, t.id, now);
    deps
      .sendToAll({ title: 'Kuldevarsel', body: t.title, tag: `task:${t.id}` })
      .catch((err) => console.error('[weather] push failed', err));
    fired++;
  }
  return fired;
}
