# House Maintenance — Design (v1)

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Author:** Emil Staurset (with Claude)

## Summary

Extend the existing `artic-spa-v2` app from a spa monitor into a unified
personal **home app**. The first new feature area is **house maintenance**: a
single list that spans quick TODOs, dated one-off reminders, recurring upkeep
chores, and seasonal/annual jobs — with web-push reminders when something is
due.

This is a **personal, single-user** app. No multi-tenancy, no accounts. It runs
in the same always-on Fly.io machine as the spa monitor and reuses that app's
SQLite database, web-push setup, design system, and background-loop pattern.

## Goals (v1)

- Add tasks of four shapes from one form:
  - **TODO** — no due date, no recurrence. A plain checklist item.
  - **One-off** — a single dated reminder.
  - **Interval** — repeats every _N_ days/weeks/months, anchored to completion.
  - **Annual** — repeats yearly on a calendar anchor (month/day). Covers
    seasonal work (winter prep, spring prep, seasonal plant care).
- Web-push reminders when a dated task becomes due/overdue, reusing the
  existing `push.ts` / `sendToAll` plumbing.
- Auto-scheduling: completing a recurring task computes its next due date.
- A **Tasks** section in the app, alongside the existing spa pages, under a
  rebranded neutral "home app" shell.
- **Site-wide password protection** — a single dedicated access password gates
  the whole app, enforced server-side, remembered indefinitely per device.

## Non-goals (v1 — deferred to later iterations)

These were discussed and explicitly deferred so v1 ships:

- Conditional rules driven by **weather forecast** data.
- Conditional rules driven by **spa MQTT sensor** data.
- **Notification escalation** (overdue tasks nudging harder over time).
- **Templated routines** (bundles that spawn several tasks at once).

The data model leaves room for these but implements none of them yet.

## Architecture

No new app, no new infrastructure, no added hosting cost. The maintenance
feature is added in place, mirroring the existing **alerts** subsystem, which is
the closest analog (rules stored in SQLite, evaluated on a loop, pushed via
web-push).

Reused as-is:

- `src/lib/server/db.ts` — single `openDb()`, schema embedded as `CREATE TABLE
  IF NOT EXISTS` statements.
- `src/lib/server/push.ts` — `sendToAll({title, body, tag})`, dead-subscription
  cleanup, VAPID config.
- `src/lib/server/boot.ts` — `startBackend()` already runs several
  `setInterval` background loops; we add one more.
- Skålda design system (`src/app.css` tokens) and the `TabBar` component.

New code:

- `src/lib/server/maintenance.ts` — task queries + recurrence/next-due logic
  (mirrors `alerts.ts`).
- `src/routes/api/maintenance/tasks/` — CRUD endpoints (mirrors
  `api/alerts/rules`).
- `src/routes/tasks/+page.svelte` — the Tasks UI.
- TabBar gains a **Tasks** entry; shell rebranded to a neutral home app.
- `src/lib/server/access.ts` — password hashing/verification + cookie
  signing/verification (see Access protection).
- `src/routes/unlock/+page.svelte` and `src/routes/api/unlock/+server.ts` — the
  unlock screen and its verify endpoint.
- `src/hooks.server.ts` — extended `handle` to enforce the access gate on every
  request.

## Data model

One new table, following the `alert_rule` convention (text id, JSON-free
typed columns, `enabled` flag):

```sql
CREATE TABLE IF NOT EXISTS maintenance_task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  recurrence_kind TEXT NOT NULL,   -- 'once' | 'interval' | 'annual'
  interval_value INTEGER,          -- interval: e.g. 3
  interval_unit TEXT,              -- interval: 'day' | 'week' | 'month'
  annual_month INTEGER,            -- annual: 1-12
  annual_day INTEGER,              -- annual: 1-31
  due_ts INTEGER,                  -- next due (epoch ms); NULL = undated TODO
  last_completed_ts INTEGER,       -- NULL until first completion
  last_reminded_ts INTEGER,        -- de-dupe guard, like the alert cooldown
  enabled INTEGER NOT NULL DEFAULT 1
);
```

Mapping each task shape onto the model:

| Shape    | recurrence_kind | due_ts        | other fields                       |
| -------- | --------------- | ------------- | ---------------------------------- |
| TODO     | `once`          | `NULL`        | —                                  |
| One-off  | `once`          | concrete date | —                                  |
| Interval | `interval`      | concrete date | `interval_value`, `interval_unit`  |
| Annual   | `annual`        | concrete date | `annual_month`, `annual_day`       |

`due_ts` is nullable specifically to support undated TODOs. All recurring and
dated tasks always carry a concrete `due_ts`.

## Behavior

### Next-due computation (auto-scheduling)

On marking a task **complete**, set `last_completed_ts = now`, then:

- **`once`** — archive it: set `enabled = 0` so it drops out of the active
  list. (No reschedule. A future "completed" view can surface these.)
- **`interval`** — `due_ts = now + interval_value × interval_unit`. Months and
  weeks advance by calendar (e.g. "every 3 months" lands on the same day-of-month
  three months out), so intervals don't drift into day-count drift. Anchored to
  **completion**, so doing a chore late pushes the whole schedule forward.
- **`annual`** — `due_ts =` the next occurrence of `(annual_month, annual_day)`
  strictly after `now` (normally next year). Anchored to the **calendar**, so
  doing seasonal work late does not shift next year's date.

**Day-of-month clamping.** When advancing to a target month that has fewer days
than the source day-of-month, clamp to the **last valid day** of the target
month. Applies to both interval-by-month (Jan 31 + 3 months → Apr 30) and annual
dates (`annual_day = 29, annual_month = 2` → Feb 28 in non-leap years). This is
a fixed rule, applied consistently everywhere a next date is computed.

### Date resolution, timezone, and reminder time

A dated task carries a calendar intent ("due Oct 15"), but `due_ts` is a concrete
epoch-ms instant. Resolving one to the other needs a timezone and a time of day,
both of which are fixed app-wide (single-user app):

- **Timezone** — a single configured zone, from a `TIMEZONE` secret/env var
  (e.g. `Europe/Oslo`), defaulting to that if unset. All calendar math (interval
  month advancement, annual anchors, "due Oct 15") resolves in this zone, not the
  server's UTC. This keeps reminders on the correct calendar day regardless of
  where the Fly machine runs.
- **Reminder time of day** — dated tasks resolve to **09:00 local** by default,
  so a task "due Oct 15" produces a `due_ts` at 09:00 `TIMEZONE` on Oct 15. The
  hourly scheduler then fires the push on the first tick at/after that instant —
  i.e. around 9am local, never the middle of the night. (A per-task reminder
  hour is a possible later refinement; v1 uses the single default.)

### Reminder scheduler

A new background loop registered in `startBackend()`, running **hourly**
(matching the existing interval-loop pattern; hourly is ample granularity for
maintenance reminders and keeps the always-on machine idle most of the time):

1. Query active, dated, due tasks:
   `SELECT … WHERE enabled = 1 AND due_ts IS NOT NULL AND due_ts <= now`.
2. For each, skip if already reminded for the current due cycle
   (`last_reminded_ts >= due_ts`) — the de-dupe guard, analogous to the alert
   cooldown.
3. `sendToAll({ title: 'Task due', body: title, tag: 'task:' + id })`.
4. Stamp `last_reminded_ts = now`.

Undated TODOs (`due_ts IS NULL`) are never selected, so they never trigger a
push — they just live in the list until checked off.

Because the app is always-on, this runs in-process. No external cron, no
scale-to-zero waker.

### API routes

Under `src/routes/api/maintenance/tasks/`, mirroring the alerts rules endpoint
style:

| Route                          | Method | Purpose                                   |
| ------------------------------ | ------ | ----------------------------------------- |
| `/api/maintenance/tasks`       | GET    | List active tasks (optionally all)        |
| `/api/maintenance/tasks`       | POST   | Create a task                             |
| `/api/maintenance/tasks/[id]`  | PUT    | Update a task (edit fields)               |
| `/api/maintenance/tasks/[id]`  | DELETE | Delete a task                             |
| `/api/maintenance/tasks/[id]/complete` | POST | Mark complete → run next-due logic |

Validation lives in `maintenance.ts` so both the API and the scheduler share one
source of truth for what a valid task is.

### UI

- A new **Tasks** tab in the `TabBar`, peer to the spa pages.
- `src/routes/tasks/+page.svelte`: a list grouped by status —
  **Overdue**, **Due soon**, **Upcoming**, **No date (todos)** — each row with a
  complete (check) action. An add/edit form lets you pick the recurrence kind and
  its parameters; the form shows only the fields relevant to the chosen kind.
- Styling uses existing Skålda tokens/components (StatusPill, TabBar, etc.) for
  visual consistency with the spa pages.
- The app shell is rebranded from spa-specific to a neutral home identity; spa
  and maintenance are co-equal sections.

## Access protection

The app currently has **no access gate**: `+layout.server.ts` only redirects to
`/setup` when unconfigured; once set up, the URL is open to anyone. v1 adds a
single shared **dedicated access password** (separate from the Arctic account
credential), enforced server-side and remembered per device.

### Secrets

Two new keys in the secrets store (`SecretKey` union in `secrets.ts`):

- `SITE_PASSWORD_HASH` — hash of the dedicated access password. Hashed with
  `node:crypto` `scrypt` (no new dependency): a random per-password salt, stored
  as `salt:derivedKey`. Verified with `timingSafeEqual`.
- `SESSION_SECRET` — random key used to sign the unlock cookie. Generated once
  (`crypto.randomBytes`) on first need and persisted, so cookies survive
  restarts.

The access password is set during `/setup` (a new field) and can also be
provided via the `SITE_PASSWORD_HASH` env var on Fly.

### Cookie (the "remembered indefinitely" mechanism)

On successful unlock, set one cookie:

- Value: an HMAC signature over a fixed token, keyed by `SESSION_SECRET` (so it
  can't be forged without the server secret). No personal data in the cookie.
- Attributes: `HttpOnly` (JS can't read it → XSS-safe), `Secure`,
  `SameSite=Lax`, `Path=/`, `Max-Age` ≈ 10 years (effectively indefinite).

A signed `HttpOnly` cookie is chosen over `localStorage` deliberately: the gate
must hold for SSR pages, `/api/*`, and the SSE stream, all of which are
server-side. `localStorage` is never sent to the server, so a client-only check
would leave every server route open — security theater. The user experience is
identical: enter the password once per device, never again.

### Enforcement

Extend the `handle` hook in `hooks.server.ts`:

1. Allowlist (always pass through): the unlock route (`/unlock`,
   `/api/unlock`), the setup route (`/setup`, `/api/setup`), and static assets
   (`/_app/`, service worker, manifest, icons, favicon).
2. If `SITE_PASSWORD_HASH` is not set yet, the gate is inactive (so the device
   can reach `/setup` to establish it).
3. Otherwise, read and verify the signed cookie. Valid → continue. Invalid or
   missing → `307` redirect to `/unlock` for page requests, `401` for `/api/*`.

### Unlock flow

`/unlock` renders a single password field → `POST /api/unlock` with the
password → server verifies against `SITE_PASSWORD_HASH` with `timingSafeEqual`
→ on success sets the signed cookie and redirects to `/`; on failure returns a
friendly "wrong password" error. No lockout/rate-limit in v1 (single user,
low-value target); can be added later if desired.

## Error handling

- Follow the existing loops' pattern: wrap each scheduler tick in try/catch and
  `console.error` so one bad task can't kill the loop.
- Push failures are already handled inside `sendToAll` (410/404 prune dead
  subscriptions); no extra handling needed.
- API input is validated in `maintenance.ts`; invalid payloads return 400.

## Testing

Mirror the existing test style (`vitest`):

- **Unit — next-due logic** (the highest-value target): interval day/week/month
  advancement, annual roll-to-next-year, late-completion behavior for both
  anchored-to-completion and anchored-to-calendar, `once` archival,
  day-of-month clamping (Jan 31 + 3mo → Apr 30; Feb 29 → Feb 28 non-leap), and
  timezone resolution (a "due Oct 15" task lands at 09:00 in `TIMEZONE`, not UTC).
- **Unit — scheduler selection**: due vs not-due, undated TODOs excluded,
  de-dupe guard prevents repeat pushes within a cycle (inject a fake `sendToAll`).
- **API**: create/list/update/delete/complete round-trips against a temp DB.
- **Access**: scrypt hash round-trips (correct password verifies, wrong fails),
  cookie sign/verify (a tampered cookie is rejected), and the hook gating
  (no cookie → redirect/401; valid cookie → pass; allowlisted routes always
  pass; gate inactive when no password is set).

## Future iterations (context, not v1 scope)

The deferred automations layer onto this foundation later, each its own
spec → plan cycle:

1. **Notification escalation** — re-remind overdue tasks on a back-off schedule.
2. **Weather-driven rules** — one weather-API integration; rules like "frost
   tonight → disconnect the hose."
3. **Spa-sensor-driven rules** — the maintenance loop subscribes to the same
   MQTT broker the spa app already uses (pub/sub allows a second subscriber).
4. **Templated routines** — seed several tasks from a named bundle
   ("Spring checklist").
