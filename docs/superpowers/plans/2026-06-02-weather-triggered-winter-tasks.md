# Weather-triggered Winter Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make opted-in maintenance tasks become due and fire a push notification when the MET Norway forecast shows sub-zero temperatures within 48h, at most once per winter.

**Architecture:** A daily in-process `setInterval` loop in `boot.ts` (alongside the existing maintenance-reminder loop) fetches the MET Norway forecast for Spjelkavik, Ålesund, and — when a cold snap is forecast — sets `due_ts = now` and sends a push for each enabled task flagged `weather_trigger`, guarded by a 180-day cooldown column. Forecast parsing and the trigger decision are pure functions; the DB mutation and orchestration are thin and injectable for testing.

**Tech Stack:** SvelteKit (Node server), TypeScript, `better-sqlite3`, `web-push`, `vitest`. Forecast source: MET Norway Locationforecast 2.0 (no API key; requires a `User-Agent`).

**Spec:** `docs/superpowers/specs/2026-06-02-weather-triggered-winter-tasks-design.md`

---

## Environment note (read before running tests)

`better-sqlite3`'s native binary in this checkout is a **Windows DLL**; under WSL, `node`/`vitest` fail to load it (invalid ELF / SHMOPEN). Therefore:

- **Pure-function tests** (Task 4, Task 5) touch no DB and run **anywhere** (WSL or Windows).
- **DB-touching tests** (Tasks 1, 3, 6, 7) must be run from a **Windows** shell:
  `npm test -- <file>` (e.g. `npm test -- tests/weather-trigger.test.ts`).

When a step below says "run on Windows", run the vitest command from a Windows terminal in the repo root, not WSL.

## File structure

- **Create** `src/lib/server/weather.ts` — forecast fetch + pure decision functions (`minTempWithinHours`, `isColdSnapForecast`, `shouldFire`), location/threshold constants, `Forecast` type.
- **Create** `src/lib/server/weather-trigger.ts` — `checkWeatherTriggers(db, now, deps)` orchestration (fetch → decide → mutate → push).
- **Create** `tests/weather.test.ts` — pure-function unit tests (run anywhere).
- **Create** `tests/weather-trigger.test.ts` — orchestration + DB tests (Windows).
- **Modify** `src/lib/server/db.ts` — add `weather_trigger` + `last_weather_fired_ts` to schema & migration.
- **Modify** `src/lib/server/maintenance-types.ts` — add the two fields to `MaintenanceTask`.
- **Modify** `src/lib/server/maintenance.ts` — map the new columns; add `selectWeatherTriggerTasks` + `markWeatherTriggered`.
- **Modify** `tests/maintenance.test.ts` — cover the two new query helpers (Windows).
- **Modify** `src/lib/server/boot.ts` — schedule the daily weather loop.
- **Modify** `scripts/seed-maintenance.mjs` — add the column to schema/upsert; flag `general-snolast`.
- **Modify** `tests/seed-maintenance.test.ts` — assert `general-snolast` is flagged.

**Naming contract (used across all tasks):**
- DB columns: `weather_trigger` (INTEGER 0/1), `last_weather_fired_ts` (INTEGER, nullable).
- TS fields on `MaintenanceTask`: `weatherTrigger: boolean`, `lastWeatherFiredTs: number | null`.
- Functions: `minTempWithinHours(forecast, hours, now)`, `isColdSnapForecast(forecast, now)`, `shouldFire(lastFiredTs, now)`, `fetchForecast(lat, lon)`, `selectWeatherTriggerTasks(db)`, `markWeatherTriggered(db, id, now)`, `checkWeatherTriggers(db, now, deps?)`.

---

## Task 1: Schema + migration for the two new columns

**Files:**
- Modify: `src/lib/server/db.ts:56-79` (SCHEMA `maintenance_task`), `:103-113` (`MAINTENANCE_TASK_COLUMNS`)
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/db.test.ts` (mirror the existing temp-db helper already in that file; if none, use this one):

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

describe('weather-trigger columns', () => {
  it('fresh db has weather_trigger (default 0) and last_weather_fired_ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wx-'));
    const db = openDb(join(dir, 'fresh.db'));
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('weather_trigger');
    expect(cols).toContain('last_weather_fired_ts');
  });

  it('migrates a pre-existing db that lacks the columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wx-old-'));
    const path = join(dir, 'old.db');
    const raw = new Database(path);
    raw.exec(`CREATE TABLE maintenance_task (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, recurrence_kind TEXT NOT NULL,
      interval_value INTEGER, interval_unit TEXT, annual_month INTEGER, annual_day INTEGER,
      due_ts INTEGER, last_completed_ts INTEGER, last_reminded_ts INTEGER, enabled INTEGER NOT NULL DEFAULT 1
    )`);
    raw.close();
    const db = openDb(path); // must not throw
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('weather_trigger');
    expect(cols).toContain('last_weather_fired_ts');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (Windows)**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — `expect(cols).toContain('weather_trigger')` fails (column absent).

- [ ] **Step 3: Add the columns to the fresh-db SCHEMA**

In `src/lib/server/db.ts`, inside the `maintenance_task` CREATE TABLE, add the two columns right after `seed_key TEXT` (line 78), before the closing `)`:

```typescript
  seed_key TEXT,
  -- Weather-triggered tasks: opt-in flag + cooldown timestamp (added later; see
  -- MAINTENANCE_TASK_COLUMNS migration below).
  weather_trigger INTEGER NOT NULL DEFAULT 0,
  last_weather_fired_ts INTEGER
```

- [ ] **Step 4: Add the columns to the migration map**

In `MAINTENANCE_TASK_COLUMNS` (db.ts:103-113), add two entries after `seed_key`:

```typescript
  seed_key: 'TEXT',
  weather_trigger: 'INTEGER NOT NULL DEFAULT 0',
  last_weather_fired_ts: 'INTEGER',
};
```

(The existing `migrate()` loop ALTERs any missing column, so this back-fills old databases. No index needed — neither column is queried by range.)

- [ ] **Step 5: Run the test to verify it passes (Windows)**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (both new cases + existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db.ts tests/db.test.ts
git commit -m "feat(tasks): add weather_trigger + last_weather_fired_ts columns"
```

---

## Task 2: Surface the columns on `MaintenanceTask`

**Files:**
- Modify: `src/lib/server/maintenance-types.ts:27-50` (`MaintenanceTask`)
- Modify: `src/lib/server/maintenance.ts:8-29` (`Row`), `:31-55` (`toTask`), `:57-60` (`SELECT`)

No test of its own — exercised by Task 3. This task only widens the read path so later tasks compile.

- [ ] **Step 1: Add fields to the `MaintenanceTask` interface**

In `src/lib/server/maintenance-types.ts`, add after `seedKey` (line 48), before `subTasks`:

```typescript
  seedKey: string | null; // stable id for idempotent seeding; null for manual tasks
  weatherTrigger: boolean; // opt-in: react to a sub-zero forecast
  lastWeatherFiredTs: number | null; // epoch ms of last weather trigger; null = never
  subTasks: SubTask[];
```

- [ ] **Step 2: Add fields to the `Row` interface**

In `src/lib/server/maintenance.ts`, add to `interface Row` after `seed_key` (line 28):

```typescript
  seed_key: string | null;
  weather_trigger: number;
  last_weather_fired_ts: number | null;
}
```

- [ ] **Step 3: Map them in `toTask`**

In `toTask` (maintenance.ts), add after `seedKey: r.seed_key,` (line 52):

```typescript
    seedKey: r.seed_key,
    weatherTrigger: !!r.weather_trigger,
    lastWeatherFiredTs: r.last_weather_fired_ts,
    subTasks: [],
```

- [ ] **Step 4: Add the columns to the `SELECT` constant**

In `src/lib/server/maintenance.ts`, change the `SELECT` (lines 57-60) so the column list includes the two new columns:

```typescript
const SELECT = `SELECT id, title, notes, recurrence_kind, interval_value, interval_unit,
  annual_month, annual_day, due_ts, last_completed_ts, last_reminded_ts, enabled,
  description, category, source, priority, season, estimated_minutes, cost_estimate, seed_key,
  weather_trigger, last_weather_fired_ts
  FROM maintenance_task`;
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (No behavior change yet; runs anywhere — type-check only, no DB.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/maintenance-types.ts src/lib/server/maintenance.ts
git commit -m "feat(tasks): expose weatherTrigger + lastWeatherFiredTs on MaintenanceTask"
```

---

## Task 3: DB helpers — `selectWeatherTriggerTasks` + `markWeatherTriggered`

**Files:**
- Modify: `src/lib/server/maintenance.ts` (append after `markReminded`, line 270)
- Test: `tests/maintenance.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/maintenance.test.ts`. Add the two new helpers to the existing import from `../src/lib/server/maintenance` at the top of the file, then add:

```typescript
import {
  // ...existing imports...
  selectWeatherTriggerTasks,
  markWeatherTriggered,
} from '../src/lib/server/maintenance';

describe('weather-trigger helpers', () => {
  it('selectWeatherTriggerTasks returns only enabled flagged tasks', () => {
    const db = tempDb();
    const now = Date.parse('2026-06-01T08:00:00Z');
    // Insert directly: createTask does not set weather_trigger (no UI path).
    db.prepare(
      `INSERT INTO maintenance_task (id, title, recurrence_kind, enabled, weather_trigger)
       VALUES ('w1','Flagged on','annual',1,1),
              ('w2','Flagged disabled','annual',0,1),
              ('w3','Not flagged','annual',1,0)`,
    ).run();
    const tasks = selectWeatherTriggerTasks(db);
    expect(tasks.map((t) => t.id)).toEqual(['w1']);
    expect(tasks[0].weatherTrigger).toBe(true);
    expect(tasks[0].lastWeatherFiredTs).toBeNull();
  });

  it('markWeatherTriggered sets due_ts, last_weather_fired_ts and last_reminded_ts to now', () => {
    const db = tempDb();
    const now = Date.parse('2026-06-01T08:00:00Z');
    db.prepare(
      `INSERT INTO maintenance_task (id, title, recurrence_kind, enabled, weather_trigger)
       VALUES ('w1','Snow load','annual',1,1)`,
    ).run();
    markWeatherTriggered(db, 'w1', now);
    const r = db
      .prepare(`SELECT due_ts, last_weather_fired_ts, last_reminded_ts FROM maintenance_task WHERE id='w1'`)
      .get() as { due_ts: number; last_weather_fired_ts: number; last_reminded_ts: number };
    expect(r.due_ts).toBe(now);
    expect(r.last_weather_fired_ts).toBe(now);
    expect(r.last_reminded_ts).toBe(now); // suppresses the generic "Task due" push
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (Windows)**

Run: `npm test -- tests/maintenance.test.ts`
Expected: FAIL — `selectWeatherTriggerTasks is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/server/maintenance.ts`:

```typescript
// Enabled tasks opted into weather triggering. Ordered for stable iteration.
export function selectWeatherTriggerTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db
    .prepare(`${SELECT} WHERE enabled = 1 AND weather_trigger = 1 ORDER BY sort_order ASC, rowid ASC`)
    .all() as Row[];
  return rows.map(toTask);
}

// Pull a weather-triggered task forward to "due now". last_reminded_ts is set to
// now (= due_ts) so the hourly maintenance-reminder loop does NOT also send a
// generic "Task due" push — the weather loop sends its own cold-snap push.
export function markWeatherTriggered(db: Database.Database, id: string, now: number): void {
  db.prepare(
    'UPDATE maintenance_task SET due_ts = ?, last_weather_fired_ts = ?, last_reminded_ts = ? WHERE id = ?',
  ).run(now, now, now, id);
}
```

- [ ] **Step 4: Run the test to verify it passes (Windows)**

Run: `npm test -- tests/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/maintenance.ts tests/maintenance.test.ts
git commit -m "feat(tasks): selectWeatherTriggerTasks + markWeatherTriggered helpers"
```

---

## Task 4: `weather.ts` pure decision functions

**Files:**
- Create: `src/lib/server/weather.ts`
- Test: `tests/weather.test.ts`

This task has **no DB or network** — runs anywhere.

- [ ] **Step 1: Write the failing test**

Create `tests/weather.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails (anywhere)**

Run: `npm test -- tests/weather.test.ts`
Expected: FAIL — cannot resolve `../src/lib/server/weather`.

- [ ] **Step 3: Implement the pure functions + types**

Create `src/lib/server/weather.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes (anywhere)**

Run: `npm test -- tests/weather.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/weather.ts tests/weather.test.ts
git commit -m "feat(weather): MET forecast decision functions (cold-snap + cooldown)"
```

---

## Task 5: `weather.ts` — `fetchForecast`

**Files:**
- Modify: `src/lib/server/weather.ts` (append `fetchForecast`)
- Test: `tests/weather.test.ts` (append)

No DB — runs anywhere (stubs `fetch`).

- [ ] **Step 1: Write the failing test**

Append to `tests/weather.test.ts`:

```typescript
import { afterEach, vi } from 'vitest';
import { fetchForecast } from '../src/lib/server/weather';

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
```

- [ ] **Step 2: Run the test to verify it fails (anywhere)**

Run: `npm test -- tests/weather.test.ts`
Expected: FAIL — `fetchForecast is not a function`.

- [ ] **Step 3: Implement `fetchForecast`**

Append to `src/lib/server/weather.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes (anywhere)**

Run: `npm test -- tests/weather.test.ts`
Expected: PASS (all cases, including Task 4's).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/weather.ts tests/weather.test.ts
git commit -m "feat(weather): fetchForecast with User-Agent + If-Modified-Since caching"
```

---

## Task 6: `weather-trigger.ts` orchestration

**Files:**
- Create: `src/lib/server/weather-trigger.ts`
- Test: `tests/weather-trigger.test.ts`

Touches the DB → tests run on **Windows**.

- [ ] **Step 1: Write the failing test**

Create `tests/weather-trigger.test.ts`:

```typescript
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
    fetchForecast: vi.fn(async () => forecast),
    sendToAll: vi.fn(async () => {}),
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
```

- [ ] **Step 2: Run the test to verify it fails (Windows)**

Run: `npm test -- tests/weather-trigger.test.ts`
Expected: FAIL — cannot resolve `../src/lib/server/weather-trigger`.

- [ ] **Step 3: Implement the orchestration**

Create `src/lib/server/weather-trigger.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes (Windows)**

Run: `npm test -- tests/weather-trigger.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/weather-trigger.ts tests/weather-trigger.test.ts
git commit -m "feat(weather): checkWeatherTriggers orchestration (fetch → due + push)"
```

---

## Task 7: Schedule the daily loop in `boot.ts`

**Files:**
- Modify: `src/lib/server/boot.ts:10` (import), `:42-56` (after the maintenance loop)

No automated test (boot wires side-effecting timers; the logic is covered by Task 6). Verified by type-check + a manual boot-time log.

- [ ] **Step 1: Add the import**

In `src/lib/server/boot.ts`, after line 10 (`import { selectDueTasks, markReminded } from './maintenance';`):

```typescript
import { selectDueTasks, markReminded } from './maintenance';
import { checkWeatherTriggers } from './weather-trigger';
```

- [ ] **Step 2: Schedule the daily check after the maintenance reminder loop**

In `src/lib/server/boot.ts`, immediately after the maintenance reminder `setInterval(...)` block closes (after line 56), add:

```typescript
  // Weather-triggered winter tasks: once a day (and once on boot), pull any
  // flagged task forward to "due" + push when a sub-zero snap is forecast.
  // Runs independently of MQTT for the same reason as the reminder loop above.
  const WEATHER_CHECK_MS = 24 * 60 * 60 * 1000;
  const runWeatherCheck = () =>
    checkWeatherTriggers(db, Date.now()).catch((err) =>
      console.error('[weather] check loop failed', err),
    );
  runWeatherCheck();
  setInterval(runWeatherCheck, WEATHER_CHECK_MS);
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/boot.ts
git commit -m "feat(weather): run the cold-snap check daily on boot"
```

---

## Task 8: Seed `general-snolast` as weather-triggered

**Files:**
- Modify: `scripts/seed-maintenance.mjs:135-144` (`MAINTENANCE_COLUMNS`), `:146-180` (`ensureSchema` CREATE TABLE), `:871-892` (upsert SQL), `:904-922` (upsert params), `:622-636` (the `general-snolast` entry)
- Test: `tests/seed-maintenance.test.ts`

> Note: `general-snolast` already has an `annual` recurrence on Jan 15 (`annualMonth: 1, annualDay: 15`). That existing annual date IS the calendar fallback the spec calls for, so no recurrence change is needed — the weather trigger simply pulls `due_ts` forward when a snap arrives before mid-January. We only add the flag.

- [ ] **Step 1: Write the failing test**

Append to `tests/seed-maintenance.test.ts`:

```typescript
describe('weather-triggered seed', () => {
  it('flags general-snolast with weather_trigger = 1 and nothing else', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);
    const rows = db
      .prepare(`SELECT seed_key, weather_trigger FROM maintenance_task`)
      .all() as { seed_key: string; weather_trigger: number }[];
    const flagged = rows.filter((r) => r.weather_trigger === 1).map((r) => r.seed_key);
    expect(flagged).toEqual(['general-snolast']);
  });

  it('re-seeding preserves last_weather_fired_ts (runtime state)', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);
    db.prepare(`UPDATE maintenance_task SET last_weather_fired_ts = 123 WHERE seed_key='general-snolast'`).run();
    seedMaintenance(db, FIXED_NOW + 86_400_000);
    const r = db
      .prepare(`SELECT last_weather_fired_ts FROM maintenance_task WHERE seed_key='general-snolast'`)
      .get() as { last_weather_fired_ts: number };
    expect(r.last_weather_fired_ts).toBe(123);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (Windows)**

Run: `npm test -- tests/seed-maintenance.test.ts`
Expected: FAIL — `flagged` is empty (`[]`), and/or `no such column: weather_trigger`.

- [ ] **Step 3: Add the columns to the seed schema**

In `scripts/seed-maintenance.mjs`, add to `MAINTENANCE_COLUMNS` (after `seed_key`, line 143):

```javascript
  seed_key: 'TEXT',
  weather_trigger: 'INTEGER NOT NULL DEFAULT 0',
  last_weather_fired_ts: 'INTEGER',
};
```

And in the `ensureSchema` CREATE TABLE (after `seed_key TEXT`, line 168):

```javascript
      seed_key TEXT,
      weather_trigger INTEGER NOT NULL DEFAULT 0,
      last_weather_fired_ts INTEGER
    );
```

- [ ] **Step 4: Write `weather_trigger` in the upsert (insert + declarative update)**

In the `upsert` prepared statement (lines 871-892), add the column to the INSERT list and VALUES, and to the `ON CONFLICT DO UPDATE SET` (it is declarative config, so it must be refreshed on re-seed). `last_weather_fired_ts` is runtime state — do NOT write it here (preserved like `last_reminded_ts`).

Column list (line ~874) and VALUES (line ~877):

```javascript
       due_ts, enabled, description, category, source, priority, season, estimated_minutes, cost_estimate, seed_key, weather_trigger)
    VALUES
      (@id, @title, NULL, @recurrence_kind, @interval_value, @interval_unit, @annual_month, @annual_day,
       @due_ts, 1, @description, @category, @source, @priority, @season, @estimated_minutes, @cost_estimate, @seed_key, @weather_trigger)
```

Add to the `ON CONFLICT(seed_key) DO UPDATE SET` block (after `cost_estimate = excluded.cost_estimate`):

```javascript
      cost_estimate = excluded.cost_estimate,
      weather_trigger = excluded.weather_trigger
```

- [ ] **Step 5: Pass the param in the upsert call**

In the `upsert.run({ ... })` object (lines 904-922), add after `seed_key: t.seedKey,`:

```javascript
        seed_key: t.seedKey,
        weather_trigger: t.weatherTrigger ? 1 : 0,
```

- [ ] **Step 6: Flag the `general-snolast` seed entry**

In the `general-snolast` task object (lines 622-636), add `weatherTrigger: true` (place it after `season: 'winter',`):

```javascript
    category: 'roof',
    source: 'general',
    priority: 'medium',
    season: 'winter',
    weatherTrigger: true,
    recurrenceKind: 'annual',
    annualMonth: 1,
    annualDay: 15,
  },
```

- [ ] **Step 7: Run the test to verify it passes (Windows)**

Run: `npm test -- tests/seed-maintenance.test.ts`
Expected: PASS (new cases + existing idempotency/preservation cases still green).

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-maintenance.mjs tests/seed-maintenance.test.ts
git commit -m "feat(seed): flag snølast/istapper task as weather-triggered"
```

---

## Task 9: Full verification + reseed

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite (Windows)**

Run: `npm test`
Expected: all green, including the existing maintenance/seed/db suites.

- [ ] **Step 2: Type-check (anywhere)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Reseed the live DB (Windows)**

Run: `npm run seed`
Expected: stats print `updated` for existing rows; no errors. The `general-snolast` row now has `weather_trigger = 1`.

- [ ] **Step 4: (Optional) smoke-test the loop**

Temporarily set `WEATHER_LAT`/`WEATHER_LON` and start `npm run dev` (disable sandbox + `--host 0.0.0.0` per project memory). On boot the log should show no `[weather]` errors. To force a fire for a manual check, you can temporarily lower the threshold or point at a cold location — revert afterward. (No commit; this is a manual check.)

---

## Self-review notes

- **Spec coverage:** data model (Task 1, 2), forecast source + User-Agent + caching (Task 5), pure decision functions (Task 4), daily loop (Task 7), once-per-winter cooldown (Task 4 `shouldFire` + Task 6 use), set-due-and-notify with `last_reminded_ts` suppression (Task 3 `markWeatherTriggered` + Task 6), seed flag (Task 8), error handling = `fetchForecast` returns null → no mutation (Task 5, 6), testing split pure/DB (every task). All spec sections map to a task.
- **Deviation from spec:** spec said "give snølast an annual December fallback"; the task already has an annual Jan 15 recurrence which serves the same purpose, so Task 8 only adds the flag. Functionally equivalent (a calendar fallback exists); noted in Task 8.
- **Type consistency:** `weatherTrigger`/`lastWeatherFiredTs` (camel) ↔ `weather_trigger`/`last_weather_fired_ts` (snake) used consistently; `checkWeatherTriggers(db, now, deps?)`, `selectWeatherTriggerTasks(db)`, `markWeatherTriggered(db, id, now)`, `isColdSnapForecast(forecast, now)`, `shouldFire(lastFiredTs, now)`, `minTempWithinHours(forecast, hours, now)`, `fetchForecast(lat, lon)` — signatures match across tasks.
