# Weather-triggered winter tasks — design

**Date:** 2026-06-02
**Status:** Approved (brainstorming)
**Branch:** feat/task-reorder-complete (new work will branch from main)

## Summary

Add an opt-in mechanism where selected maintenance tasks become **due** and fire a
**push notification** when the local weather forecast shows sub-zero temperatures. The
motivating case is the "check snow load / icicles / icing" (`general-snolast`) task: it
should surface automatically when the first real cold snap of the winter is forecast,
rather than waiting on a fixed calendar date.

The check runs once a day as an in-process loop, reads the MET Norway (yr.no) forecast for
the house location (Spjelkavik, Ålesund), and triggers each opted-in task at most once per
winter.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Which tasks react | New opt-in `weather_trigger` flag per task (not all `season='winter'` tasks) |
| What happens on trigger | Set the task **due** (`due_ts = now`) **and** send a push notification |
| Trigger condition | Minimum forecast air temperature **< 0 °C within the next 48 hours** |
| Re-trigger | **Once per winter** — after firing, suppress for 180 days (covers a multi-day snap and the Dec→Jan year boundary; re-arms ~12 months later) |
| Check cadence | **Daily** (24h loop) plus one run on boot |
| Forecast source | MET Norway Locationforecast 2.0 (free, no API key) |
| Location | Spjelkavik, Ålesund ≈ **lat 62.468, lon 6.394** |

## Architecture

In-process `setInterval` loop in `src/lib/server/boot.ts`, alongside the existing
maintenance-reminder loop and history-rollup loop. No external cron, no new API route —
this matches the codebase's existing scheduling pattern.

```
daily tick (+ on boot)
   │
   ▼
fetchForecast(lat, lon) ──► null on any failure ──► log + skip tick (no mutation)
   │ timeseries
   ▼
isColdSnapForecast(forecast)  =  minTempWithinHours(forecast, 48) < 0
   │ true
   ▼
for each enabled task with weather_trigger = 1:
   shouldFire(last_weather_fired_ts, now)?      // now - last >= 180d, or last is null
      │ yes
      ▼
   markWeatherTriggered(task, now):
      due_ts             = now
      last_weather_fired_ts = now
      last_reminded_ts   = now          // suppresses the generic "Task due" push
   sendToAll({ title: "Kuldevarsel", body: task.title, tag: "task:<id>" })
```

## Data model

Two additive columns on `maintenance_task`, applied via the same idempotent
`ALTER TABLE` migration pattern used for `sort_order` and `seed_key` in
`src/lib/server/db.ts`:

- `weather_trigger INTEGER NOT NULL DEFAULT 0` — opt-in flag. `1` = react to forecast.
- `last_weather_fired_ts INTEGER` — nullable epoch ms; when the trigger last fired.
  Drives the 180-day cooldown. Untouched by task completion.

No change to `sub_task`.

## Components

### `src/lib/server/weather.ts` (new)

Pure-where-possible functions so decision logic is testable without network or DB.

- `WEATHER_LAT` / `WEATHER_LON` — constants (default 62.468 / 6.394), overridable via
  env (`WEATHER_LAT`, `WEATHER_LON`). Not secrets; not stored in `secrets.json`.
- `MET_USER_AGENT` — `"artic-spa-v2/1.0 emil.staurset@miles.no"` (MET ToS requires an
  identifying User-Agent with contact).
- `fetchForecast(lat, lon): Promise<Forecast | null>` — GETs
  `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=<lat>&lon=<lon>` with
  the User-Agent header. Returns parsed timeseries, or `null` on any failure (network
  error, non-200, malformed JSON). Honours caching with `If-Modified-Since` /
  `Last-Modified` (in-memory last-response cache); backs off (returns `null`) on 429/403.
- `minTempWithinHours(forecast, hours, now): number | null` — coldest
  `air_temperature` across timeseries entries whose time is within `[now, now+hours]`.
  `null` if no entries in window.
- `isColdSnapForecast(forecast, now): boolean` — `minTempWithinHours(forecast, 48, now)`
  is non-null and `< 0`.
- `shouldFire(lastFiredTs: number | null, now: number): boolean` — pure cooldown:
  `lastFiredTs == null || now - lastFiredTs >= COOLDOWN_MS` where
  `COOLDOWN_MS = 180 * 24 * 60 * 60 * 1000`.

### `src/lib/server/db.ts` (extend)

- Migration: add the two columns if absent.
- `selectWeatherTriggerTasks(db): Task[]` — `enabled = 1 AND weather_trigger = 1`.
- `markWeatherTriggered(db, id, now)` — sets `due_ts = now`,
  `last_weather_fired_ts = now`, `last_reminded_ts = now` in one statement.

### `src/lib/server/boot.ts` (extend)

- `WEATHER_CHECK_MS = 24 * 60 * 60 * 1000`.
- New loop: run `checkWeatherTriggers()` once on boot, then every `WEATHER_CHECK_MS`.
- `checkWeatherTriggers()` orchestrates: fetch → if cold snap → iterate tasks → for each
  passing `shouldFire`, `markWeatherTriggered` + `sendToAll`. All wrapped so a failure
  logs and never throws out of the interval callback.

### `scripts/seed-maintenance.mjs` (extend)

- Set `weather_trigger: 1` on `general-snolast`.
- Give it an annual December fallback (`recurrence_kind: 'annual'`, `annual_month: 12`)
  so it still gets done in a freakishly mild winter where no sub-zero snap is forecast.
  The weather trigger simply pulls `due_ts` forward when a snap arrives first.

## Data flow / interaction with existing loops

- The existing **maintenance-reminder loop** (60 min) selects due tasks and sends a
  generic "Task due" push, then sets `last_reminded_ts`. Its re-fire guard is
  `last_reminded_ts IS NULL OR last_reminded_ts < due_ts`.
- By setting `last_reminded_ts = due_ts (= now)` when we weather-trigger, the maintenance
  loop sees the task as already reminded and does **not** send a second generic push.
  The user receives exactly one, richer, cold-snap notification.
- On completion, normal recurrence (`nextDueAfterComplete`) resumes. `last_weather_fired_ts`
  is left set, so completion does not re-arm the weather trigger — only the 180-day
  cooldown does. This matches the "once per winter" intent.

## Error handling

- MET fetch failure / non-200 / malformed JSON → `fetchForecast` returns `null` → tick
  logs a warning and makes no mutation. Next daily tick (or boot) retries.
- 429/403 from MET → treat as failure (return `null`); next tick is a day later, well
  within rate limits.
- No push subscriptions registered → `sendToAll` no-ops (existing behaviour).
- The interval callback never throws; all work is inside a try/catch that logs.

## Testing

Pure functions run anywhere; DB-touching paths run on Windows only, because
`better-sqlite3`'s native binary is a Windows DLL that fails to load under WSL
(invalid ELF / SHMOPEN) — see project memory.

- **Unit (anywhere):**
  - `minTempWithinHours` against a fixture forecast JSON — window boundaries, empty
    window, all-positive vs containing-negative.
  - `isColdSnapForecast` — true when a sub-zero hour falls in the 48h window, false
    otherwise.
  - `shouldFire` — fires when `lastFiredTs` is null; suppressed at 179 days; fires at
    181 days.
- **Integration (Windows):**
  - `markWeatherTriggered` sets the three columns correctly.
  - `checkWeatherTriggers` with a stubbed `fetchForecast`: cold-snap fixture triggers an
    eligible task and skips one inside its cooldown; non-cold fixture triggers nothing;
    `null` fixture mutates nothing.

## Out of scope

- Per-task custom thresholds or horizons (single global rule for now).
- Heat / wind / precipitation triggers.
- Surfacing forecast data in the UI. (The trigger acts behind the scenes; the task simply
  appears due.)
- Configurable location in the UI (constant/env only for now).
