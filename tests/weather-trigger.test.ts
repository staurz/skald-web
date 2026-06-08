import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import { checkWeatherTriggers } from '../src/lib/server/weather-trigger';
import type { Forecast } from '../src/lib/server/weather';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wxtrig-'));
  return openDb(join(dir, 'test.db'));
}

const NOW = Date.parse('2026-01-10T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const cold: Forecast = {
  properties: { timeseries: [{ time: '2026-01-11T00:00:00Z', data: { instant: { details: { air_temperature: -4 } } } }] },
};
const warm: Forecast = {
  properties: { timeseries: [{ time: '2026-01-11T00:00:00Z', data: { instant: { details: { air_temperature: 5 } } } }] },
};

function deps(forecast: Forecast | null) {
  return {
    fetchForecast: vi.fn(async (_lat: number, _lon: number) => forecast),
    sendToAll: vi.fn(async (_payload: { title: string; body: string; tag?: string }) => {}),
  };
}

function insert(db: ReturnType<typeof tempDb>, id: string, flag: number, lastFired: number | null, enabled = 1) {
  db.prepare(
    `INSERT INTO maintenance_task (id, title, recurrence_kind, enabled, weather_trigger, last_weather_fired_ts)
     VALUES (?, ?, 'annual', ?, ?, ?)`,
  ).run(id, `task-${id}`, enabled, flag, lastFired);
}

describe('checkWeatherTriggers', () => {
  it('fires an eligible flagged task on a cold snap: sets due + pushes', async () => {
    const db = tempDb();
    insert(db, 'snow', 1, null);
    const d = deps(cold);
    const fired = await checkWeatherTriggers(db, NOW, d);
    expect(fired).toBe(1);
    expect(d.sendToAll).toHaveBeenCalledTimes(1);
    expect(d.sendToAll.mock.calls[0][0]).toMatchObject({ title: 'Kuldevarsel', body: 'task-snow' });
    const r = db.prepare(`SELECT due_ts, last_weather_fired_ts FROM maintenance_task WHERE id='snow'`).get() as { due_ts: number; last_weather_fired_ts: number };
    expect(r.due_ts).toBe(NOW);
    expect(r.last_weather_fired_ts).toBe(NOW);
  });

  it('skips a task still inside its cooldown', async () => {
    const db = tempDb();
    insert(db, 'snow', 1, NOW - 30 * DAY); // fired 30 days ago
    const d = deps(cold);
    expect(await checkWeatherTriggers(db, NOW, d)).toBe(0);
    expect(d.sendToAll).not.toHaveBeenCalled();
  });

  it('does nothing when the forecast is not a cold snap', async () => {
    const db = tempDb();
    insert(db, 'snow', 1, null);
    const d = deps(warm);
    expect(await checkWeatherTriggers(db, NOW, d)).toBe(0);
    expect(d.sendToAll).not.toHaveBeenCalled();
  });

  it('does nothing when the forecast is unavailable (null)', async () => {
    const db = tempDb();
    insert(db, 'snow', 1, null);
    const d = deps(null);
    expect(await checkWeatherTriggers(db, NOW, d)).toBe(0);
    const r = db.prepare(`SELECT due_ts FROM maintenance_task WHERE id='snow'`).get() as { due_ts: number | null };
    expect(r.due_ts).toBeNull(); // untouched
  });

  it('ignores unflagged tasks even in a cold snap', async () => {
    const db = tempDb();
    insert(db, 'plain', 0, null);
    const d = deps(cold);
    expect(await checkWeatherTriggers(db, NOW, d)).toBe(0);
  });
});
