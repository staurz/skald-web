# House Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the spa app into a unified home app with a password-gated house-maintenance task list (todos, dated one-offs, interval upkeep, seasonal/annual jobs) that sends web-push reminders when tasks are due.

**Architecture:** Add in place, mirroring the existing alerts subsystem. New pure-logic modules (recurrence math, access crypto) are unit-tested in isolation; SQLite access reuses `openDb()`; reminders run from a new `setInterval` loop in `startBackend()`; a site-wide access gate is enforced in `hooks.server.ts` via a signed `HttpOnly` cookie. Spec: `docs/superpowers/specs/2026-06-01-house-maintenance-design.md`.

**Tech Stack:** SvelteKit (adapter-node), better-sqlite3, web-push, Vitest, `node:crypto` (scrypt + HMAC), `Intl.DateTimeFormat` for timezone math (no new dependencies).

**Execution note — three phases, executable independently:**
- **Phase A — Access gate** (Tasks A1–A7): foundational, independently shippable.
- **Phase B — Maintenance core** (Tasks B1–B5): data model, recurrence logic, scheduler.
- **Phase C — API & UI** (Tasks C1–C5): endpoints, Tasks page, rebrand.

Recommended order is A → B → C, but B/C do not depend on A.

---

## File Structure

**Phase A — Access gate**
- Create `src/lib/server/access.ts` — password hash/verify (scrypt), cookie sign/verify (HMAC), path allowlist helper.
- Modify `src/lib/server/secrets.ts` — add `SITE_PASSWORD_HASH`, `SESSION_SECRET` to `SecretKey`.
- Modify `src/hooks.server.ts` — enforce the gate.
- Create `src/routes/api/unlock/+server.ts` — verify password, set cookie.
- Create `src/routes/unlock/+page.svelte` — password screen.
- Modify the setup flow to set `SITE_PASSWORD_HASH` (Task A7 locates the exact file).
- Test: `tests/access.test.ts`.

**Phase B — Maintenance core**
- Modify `src/lib/server/db.ts` — add `maintenance_task` table.
- Create `src/lib/server/clock.ts` — timezone wall-clock ↔ epoch helpers.
- Create `src/lib/server/maintenance-types.ts` — shared types.
- Create `src/lib/server/recurrence.ts` — next-due + initial-due math.
- Create `src/lib/server/maintenance.ts` — task store (CRUD, complete) + due selection.
- Modify `src/lib/server/boot.ts` — start the hourly reminder loop.
- Tests: `tests/clock.test.ts`, `tests/recurrence.test.ts`, `tests/maintenance.test.ts`.

**Phase C — API & UI**
- Create `src/routes/api/maintenance/tasks/+server.ts` — GET list, POST create.
- Create `src/routes/api/maintenance/tasks/[id]/+server.ts` — PUT, DELETE.
- Create `src/routes/api/maintenance/tasks/[id]/complete/+server.ts` — POST complete.
- Create `src/routes/tasks/+page.svelte` — Tasks UI.
- Modify `src/lib/components/TabBar.svelte` + app shell — add Tasks tab, rebrand.

---

# Phase A — Access gate

## Task A1: Password hashing (scrypt)

**Files:**
- Create: `src/lib/server/access.ts`
- Test: `tests/access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/access.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/server/access';

describe('password hashing', () => {
  it('verifies the correct password', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct horse', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('battery staple', stored)).toBe(false);
  });

  it('produces a distinct salt each call (no rainbow reuse)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects a malformed stored value without throwing', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access.test.ts`
Expected: FAIL — cannot resolve `../src/lib/server/access`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/access.ts
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, dkHex] = stored.split(':');
  if (!saltHex || !dkHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(dkHex, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/access.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/access.ts tests/access.test.ts
git commit -m "feat(access): scrypt password hashing"
```

## Task A2: Cookie signing + allowlist

**Files:**
- Modify: `src/lib/server/access.ts`
- Modify: `tests/access.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```ts
// append to tests/access.test.ts
import { signCookie, verifyCookie, isAllowlisted, ACCESS_COOKIE } from '../src/lib/server/access';

describe('access cookie', () => {
  // sessionSecret() reads SESSION_SECRET from env first (see secrets store),
  // so set it deterministically for the test.
  process.env.SESSION_SECRET = 'test-session-secret';

  it('verifies a freshly signed cookie', () => {
    expect(verifyCookie(signCookie())).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const good = signCookie();
    const tampered = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
    expect(verifyCookie(tampered)).toBe(false);
  });

  it('rejects undefined / malformed cookies', () => {
    expect(verifyCookie(undefined)).toBe(false);
    expect(verifyCookie('garbage')).toBe(false);
  });

  it('exposes a stable cookie name', () => {
    expect(ACCESS_COOKIE).toBe('home_access');
  });
});

describe('isAllowlisted', () => {
  it('allows unlock and setup routes', () => {
    expect(isAllowlisted('/unlock')).toBe(true);
    expect(isAllowlisted('/api/unlock')).toBe(true);
    expect(isAllowlisted('/setup')).toBe(true);
    expect(isAllowlisted('/api/setup')).toBe(true);
  });
  it('allows framework assets', () => {
    expect(isAllowlisted('/_app/immutable/chunk.js')).toBe(true);
    expect(isAllowlisted('/service-worker.js')).toBe(true);
    expect(isAllowlisted('/favicon.png')).toBe(true);
  });
  it('gates application routes', () => {
    expect(isAllowlisted('/')).toBe(false);
    expect(isAllowlisted('/tasks')).toBe(false);
    expect(isAllowlisted('/api/maintenance/tasks')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access.test.ts`
Expected: FAIL — `signCookie` / `isAllowlisted` not exported.

- [ ] **Step 3: Implement (append to `access.ts`)**

```ts
// append to src/lib/server/access.ts
import { createHmac } from 'node:crypto';
import { defaultSecrets } from './secrets';

export const ACCESS_COOKIE = 'home_access';
const COOKIE_TOKEN = 'unlocked';

function sessionSecret(): string {
  let s = defaultSecrets.get('SESSION_SECRET');
  if (!s) {
    s = randomBytes(32).toString('hex');
    defaultSecrets.set('SESSION_SECRET', s);
  }
  return s;
}

export function signCookie(): string {
  const sig = createHmac('sha256', sessionSecret()).update(COOKIE_TOKEN).digest('hex');
  return `${COOKIE_TOKEN}.${sig}`;
}

export function verifyCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [token, sig] = value.split('.');
  if (token !== COOKIE_TOKEN || !sig) return false;
  const expected = createHmac('sha256', sessionSecret()).update(COOKIE_TOKEN).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ALLOW_PREFIXES = ['/unlock', '/api/unlock', '/setup', '/api/setup', '/_app'];
const ALLOW_EXACT = new Set(['/service-worker.js', '/favicon.png', '/favicon.ico', '/manifest.webmanifest', '/robots.txt']);

export function isAllowlisted(pathname: string): boolean {
  if (ALLOW_EXACT.has(pathname)) return true;
  return ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
```

Note: `secrets.ts` must already include `SESSION_SECRET` in its `SecretKey` union — that is Task A3. If you are running tasks out of order, do Task A3 first.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access.test.ts`
Expected: PASS (all access tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/access.ts tests/access.test.ts
git commit -m "feat(access): signed cookie + route allowlist"
```

## Task A3: Register new secret keys

**Files:**
- Modify: `src/lib/server/secrets.ts:6-14` (the `SecretKey` union)

- [ ] **Step 1: Edit the union**

Add two members to the existing `SecretKey` type so it reads:

```ts
export type SecretKey =
  | 'ARCTIC_USERNAME'
  | 'ARCTIC_USER_ID'
  | 'ARCTIC_SPA_UUID'
  | 'ARCTIC_PASSWORD_HASH'
  | 'ARCTIC_REFRESH_TOKEN'
  | 'INSTALLATION_ID'
  | 'VAPID_PUBLIC_KEY'
  | 'VAPID_PRIVATE_KEY'
  | 'SITE_PASSWORD_HASH'
  | 'SESSION_SECRET';
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no new errors referencing `SecretKey`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/secrets.ts
git commit -m "feat(access): add SITE_PASSWORD_HASH and SESSION_SECRET keys"
```

## Task A4: Enforce the gate in hooks.server.ts

**Files:**
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Replace the file contents**

```ts
// src/hooks.server.ts
import { redirect, type Handle } from '@sveltejs/kit';
import { startBackend } from '$lib/server/boot';
import { defaultSecrets } from '$lib/server/secrets';
import { ACCESS_COOKIE, isAllowlisted, verifyCookie } from '$lib/server/access';

startBackend();

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const gateActive = !!defaultSecrets.get('SITE_PASSWORD_HASH');

  if (gateActive && !isAllowlisted(pathname)) {
    const ok = verifyCookie(event.cookies.get(ACCESS_COOKIE));
    if (!ok) {
      if (pathname.startsWith('/api/')) {
        return new Response('Unauthorized', { status: 401 });
      }
      throw redirect(307, '/unlock');
    }
  }

  return resolve(event);
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Manual smoke (sandbox disabled, host 0.0.0.0 per project memory)**

With no `SITE_PASSWORD_HASH` set yet, the gate is inactive — the app loads normally. (Full gate behavior is verified after Task A5/A6.) Run `npm run dev -- --host 0.0.0.0` and confirm `/` still loads.

- [ ] **Step 4: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(access): gate all routes behind unlock cookie in hooks"
```

## Task A5: Unlock API endpoint

**Files:**
- Create: `src/routes/api/unlock/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/unlock/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { defaultSecrets } from '$lib/server/secrets';
import { ACCESS_COOKIE, signCookie, verifyPassword } from '$lib/server/access';

const TEN_YEARS_SEC = 60 * 60 * 24 * 365 * 10;

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { password } = (await request.json()) as { password?: string };
  const stored = defaultSecrets.get('SITE_PASSWORD_HASH');
  if (!stored) throw error(400, 'No site password configured');
  if (!password || !verifyPassword(password, stored)) {
    throw error(401, 'Wrong password');
  }
  cookies.set(ACCESS_COOKIE, signCookie(), {
    path: '/',
    httpOnly: true,
    // `secure` is intentionally omitted: SvelteKit defaults it to true in
    // production but relaxes it for http://localhost, so dev unlock works.
    sameSite: 'lax',
    maxAge: TEN_YEARS_SEC,
  });
  return json({ ok: true });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/unlock/+server.ts
git commit -m "feat(access): unlock endpoint sets signed cookie"
```

## Task A6: Unlock page

**Files:**
- Create: `src/routes/unlock/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- src/routes/unlock/+page.svelte -->
<script lang="ts">
  let password = $state('');
  let err = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    err = '';
    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        window.location.href = '/';
      } else {
        err = r.status === 401 ? 'Wrong password' : 'Could not unlock';
      }
    } catch {
      err = 'Network error';
    } finally {
      busy = false;
    }
  }
</script>

<main class="unlock">
  <form onsubmit={submit}>
    <h1>Locked</h1>
    <input
      type="password"
      bind:value={password}
      placeholder="Password"
      autocomplete="current-password"
      aria-label="Password"
    />
    {#if err}<p class="err">{err}</p>{/if}
    <button type="submit" disabled={busy || !password}>{busy ? 'Unlocking…' : 'Unlock'}</button>
  </form>
</main>

<style>
  .unlock {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 22px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 320px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }
  input,
  button {
    padding: 12px 14px;
    border-radius: var(--radius, 10px);
    border: 1px solid var(--border, #3334);
    font: inherit;
  }
  button {
    cursor: pointer;
  }
  .err {
    color: var(--danger, #d33);
    margin: 0;
    font-size: 0.9rem;
  }
</style>
```

- [ ] **Step 2: Manual verification (the real gate test)**

1. Set a password hash so the gate activates. In a Node REPL or a throwaway script:
   `node -e "import('./src/lib/server/access.ts')"` is awkward under SvelteKit; instead set it via the secrets file directly for the smoke test — add `"SITE_PASSWORD_HASH": "<paste hashPassword('test') output>"` to `./data/secrets.json`. Generate the hash with a one-off: create `scratch.mjs` containing `import {hashPassword} from './src/lib/server/access.ts'; console.log(hashPassword('test'));` is not runnable as `.ts` directly — instead temporarily add a `console.log(hashPassword('test'))` to a vitest test, or use Task A7 (setup) once implemented. Simplest: run Task A7 first, set the password through the setup UI, then return here.
2. With the gate active, visit `/` → expect redirect to `/unlock`.
3. Enter the wrong password → "Wrong password".
4. Enter the right password → redirected to `/`, and refreshing keeps you in (cookie persists).
5. `curl -i http://localhost:5173/api/maintenance/tasks` with no cookie → `401`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/unlock/+page.svelte
git commit -m "feat(access): unlock page"
```

## Task A7: Set the site password during setup

**Files:**
- Locate the setup endpoint first: `git ls-files | grep -i setup` (expected `src/routes/api/setup/+server.ts` and `src/routes/setup/+page.svelte`).
- Modify both: add a "site access password" field to the setup form and hash it on the server.

- [ ] **Step 1: Read the setup endpoint and page**

Run: `cat src/routes/api/setup/+server.ts src/routes/setup/+page.svelte`
Identify where it calls `defaultSecrets.set(...)` and where the form posts its JSON body.

- [ ] **Step 2: Server — hash and store the access password**

In `src/routes/api/setup/+server.ts`, read a new `sitePassword` field from the request body and, when present and non-empty, store its hash. Add the import and the set call alongside the existing secret writes:

```ts
import { hashPassword } from '$lib/server/access';

// ...inside the POST handler, after parsing the body and before returning success:
if (typeof body.sitePassword === 'string' && body.sitePassword.length > 0) {
  defaultSecrets.set('SITE_PASSWORD_HASH', hashPassword(body.sitePassword));
}
```

(Use the body variable name already present in the file; if it destructures fields individually, add `sitePassword` to that destructuring.)

- [ ] **Step 3: Client — add the field**

In `src/routes/setup/+page.svelte`, add a password input bound to a new `sitePassword` variable and include it in the POST body alongside the existing fields:

```svelte
<!-- add near the other inputs -->
<input
  type="password"
  bind:value={sitePassword}
  placeholder="Site access password"
  autocomplete="new-password"
  aria-label="Site access password"
/>
```

Declare `let sitePassword = $state('');` with the other state, and add `sitePassword` to the JSON body object in the existing submit/fetch call.

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Fresh setup (delete or rename `./data/secrets.json` first if testing end-to-end): complete setup with a site password → app loads → open a private window → `/` redirects to `/unlock` → the chosen password unlocks it.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/setup/+server.ts src/routes/setup/+page.svelte
git commit -m "feat(access): set site password during setup"
```

---

# Phase B — Maintenance core

## Task B1: Add the maintenance_task table

**Files:**
- Modify: `src/lib/server/db.ts` (the `SCHEMA` string)
- Test: `tests/maintenance.test.ts` (created here, expanded in B5)

- [ ] **Step 1: Write a failing schema test**

```ts
// tests/maintenance.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'maint-'));
  return openDb(join(dir, 'test.db'));
}

describe('maintenance_task schema', () => {
  it('creates the table with the expected columns', () => {
    const db = tempDb();
    const cols = db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'annual_day',
        'annual_month',
        'due_ts',
        'enabled',
        'id',
        'interval_unit',
        'interval_value',
        'last_completed_ts',
        'last_reminded_ts',
        'notes',
        'recurrence_kind',
        'title',
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/maintenance.test.ts`
Expected: FAIL — no such table `maintenance_task`.

- [ ] **Step 3: Add the table to `SCHEMA`**

Append inside the `SCHEMA` template string in `src/lib/server/db.ts`, after the `push_subscription` table:

```sql
CREATE TABLE IF NOT EXISTS maintenance_task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  recurrence_kind TEXT NOT NULL,
  interval_value INTEGER,
  interval_unit TEXT,
  annual_month INTEGER,
  annual_day INTEGER,
  due_ts INTEGER,
  last_completed_ts INTEGER,
  last_reminded_ts INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_task_due ON maintenance_task(due_ts);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db.ts tests/maintenance.test.ts
git commit -m "feat(maintenance): add maintenance_task table"
```

## Task B2: Timezone clock helpers

**Files:**
- Create: `src/lib/server/clock.ts`
- Test: `tests/clock.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/clock.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/clock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/clock.ts
export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(utcMs: number, tz: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value;
  return {
    year: +m.year,
    month: +m.month,
    day: +m.day,
    hour: +m.hour % 24, // guard against the "24" midnight quirk
    minute: +m.minute,
    second: +m.second,
  };
}

export function zonedParts(utcMs: number, tz: string): WallParts {
  return partsOf(utcMs, tz);
}

function offsetMs(utcMs: number, tz: string): number {
  const p = partsOf(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

// Convert a wall-clock time *in tz* to the corresponding UTC epoch ms.
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const o1 = offsetMs(guess, tz);
  const o2 = offsetMs(guess - o1, tz);
  return guess - o2;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/clock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/clock.ts tests/clock.test.ts
git commit -m "feat(maintenance): timezone wall-clock helpers"
```

## Task B3: Types + recurrence math

**Files:**
- Create: `src/lib/server/maintenance-types.ts`
- Create: `src/lib/server/recurrence.ts`
- Test: `tests/recurrence.test.ts`

- [ ] **Step 1: Create the shared types**

```ts
// src/lib/server/maintenance-types.ts
export type RecurrenceKind = 'once' | 'interval' | 'annual';
export type IntervalUnit = 'day' | 'week' | 'month';

export interface MaintenanceTask {
  id: string;
  title: string;
  notes: string | null;
  recurrenceKind: RecurrenceKind;
  intervalValue: number | null;
  intervalUnit: IntervalUnit | null;
  annualMonth: number | null; // 1-12
  annualDay: number | null; // 1-31
  dueTs: number | null; // epoch ms; null = undated todo
  lastCompletedTs: number | null;
  lastRemindedTs: number | null;
  enabled: boolean;
}

// Fields accepted when creating/editing a task. dueTs is derived server-side.
export interface TaskInput {
  title: string;
  notes?: string | null;
  recurrenceKind: RecurrenceKind;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  annualMonth?: number | null;
  annualDay?: number | null;
  // For 'once' (dated) and 'interval' start: an explicit first date, YYYY-MM-DD.
  // Omit for an undated todo.
  firstDueDate?: string | null;
}

export const REMINDER_HOUR = 9;
```

- [ ] **Step 2: Write the failing recurrence tests**

```ts
// tests/recurrence.test.ts
import { describe, it, expect } from 'vitest';
import { nextIntervalDue, nextAnnualDue, computeInitialDue } from '../src/lib/server/recurrence';
import type { TaskInput } from '../src/lib/server/maintenance-types';

const OSLO = 'Europe/Oslo';
const at = (iso: string) => Date.parse(iso);
const localDate = (ts: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: OSLO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
const localHour = (ts: number) =>
  +new Intl.DateTimeFormat('en-US', { timeZone: OSLO, hour12: false, hour: '2-digit' }).format(ts) % 24;

describe('nextIntervalDue', () => {
  it('advances by whole days at 09:00 local', () => {
    const next = nextIntervalDue(at('2025-03-10T14:00:00Z'), 10, 'day', OSLO);
    expect(localDate(next)).toBe('2025-03-20');
    expect(localHour(next)).toBe(9);
  });

  it('advances by weeks', () => {
    const next = nextIntervalDue(at('2025-03-10T14:00:00Z'), 2, 'week', OSLO);
    expect(localDate(next)).toBe('2025-03-24');
  });

  it('advances by months keeping the day-of-month', () => {
    const next = nextIntervalDue(at('2025-01-15T08:00:00Z'), 3, 'month', OSLO);
    expect(localDate(next)).toBe('2025-04-15');
  });

  it('clamps month overflow to the last valid day (Jan 31 + 3mo -> Apr 30)', () => {
    const next = nextIntervalDue(at('2025-01-31T08:00:00Z'), 3, 'month', OSLO);
    expect(localDate(next)).toBe('2025-04-30');
  });
});

describe('nextAnnualDue', () => {
  it('returns this year if the date is still ahead', () => {
    const next = nextAnnualDue(at('2025-03-01T00:00:00Z'), 10, 15, OSLO);
    expect(localDate(next)).toBe('2025-10-15');
    expect(localHour(next)).toBe(9);
  });

  it('rolls to next year if the date has passed', () => {
    const next = nextAnnualDue(at('2025-11-01T00:00:00Z'), 10, 15, OSLO);
    expect(localDate(next)).toBe('2026-10-15');
  });

  it('clamps Feb 29 to Feb 28 in a non-leap year', () => {
    const next = nextAnnualDue(at('2025-01-01T00:00:00Z'), 2, 29, OSLO);
    expect(localDate(next)).toBe('2025-02-28');
  });
});

describe('computeInitialDue', () => {
  const base: TaskInput = { title: 't', recurrenceKind: 'once' };
  const now = at('2025-06-01T10:00:00Z');

  it('is null for an undated todo', () => {
    expect(computeInitialDue({ ...base, recurrenceKind: 'once' }, now, OSLO)).toBeNull();
  });

  it('uses firstDueDate at 09:00 for a dated one-off', () => {
    const due = computeInitialDue({ ...base, recurrenceKind: 'once', firstDueDate: '2025-09-20' }, now, OSLO);
    expect(localDate(due!)).toBe('2025-09-20');
    expect(localHour(due!)).toBe(9);
  });

  it('uses firstDueDate when given for an interval task', () => {
    const due = computeInitialDue(
      { ...base, recurrenceKind: 'interval', intervalValue: 1, intervalUnit: 'month', firstDueDate: '2025-06-10' },
      now,
      OSLO,
    );
    expect(localDate(due!)).toBe('2025-06-10');
  });

  it('defaults an interval task with no firstDueDate to now + interval', () => {
    const due = computeInitialDue(
      { ...base, recurrenceKind: 'interval', intervalValue: 2, intervalUnit: 'week' },
      now,
      OSLO,
    );
    expect(localDate(due!)).toBe('2025-06-15');
  });

  it('computes the next annual occurrence', () => {
    const due = computeInitialDue({ ...base, recurrenceKind: 'annual', annualMonth: 10, annualDay: 15 }, now, OSLO);
    expect(localDate(due!)).toBe('2025-10-15');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/recurrence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/server/recurrence.ts
import { zonedParts, wallTimeToUtc, lastDayOfMonth } from './clock';
import { REMINDER_HOUR, type IntervalUnit, type TaskInput } from './maintenance-types';

function atNine(year: number, month: number, day: number, tz: string): number {
  const d = Math.min(day, lastDayOfMonth(year, month));
  return wallTimeToUtc(year, month, d, REMINDER_HOUR, 0, 0, tz);
}

// Parse a YYYY-MM-DD string into a dueTs at 09:00 local.
export function resolveDateAtNine(isoDate: string, tz: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return atNine(y, m, d, tz);
}

export function nextIntervalDue(fromTs: number, value: number, unit: IntervalUnit, tz: string): number {
  const p = zonedParts(fromTs, tz);
  if (unit === 'day') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  if (unit === 'week') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value * 7));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  // month
  const totalMonths = p.month - 1 + value;
  const year = p.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return atNine(year, month, p.day, tz); // atNine clamps the day
}

export function nextAnnualDue(fromTs: number, month: number, day: number, tz: string): number {
  const p = zonedParts(fromTs, tz);
  let year = p.year;
  let candidate = atNine(year, month, day, tz);
  if (candidate <= fromTs) {
    year += 1;
    candidate = atNine(year, month, day, tz);
  }
  return candidate;
}

// The due_ts a task should have at creation time.
export function computeInitialDue(input: TaskInput, now: number, tz: string): number | null {
  switch (input.recurrenceKind) {
    case 'once':
      return input.firstDueDate ? resolveDateAtNine(input.firstDueDate, tz) : null;
    case 'interval':
      if (input.firstDueDate) return resolveDateAtNine(input.firstDueDate, tz);
      return nextIntervalDue(now, input.intervalValue ?? 1, input.intervalUnit ?? 'day', tz);
    case 'annual':
      return nextAnnualDue(now, input.annualMonth ?? 1, input.annualDay ?? 1, tz);
  }
}

// The due_ts after completing a recurring task. null means "archive" (once).
export function nextDueAfterComplete(
  task: { recurrenceKind: string; intervalValue: number | null; intervalUnit: IntervalUnit | null; annualMonth: number | null; annualDay: number | null },
  completedTs: number,
  tz: string,
): number | null {
  if (task.recurrenceKind === 'interval') {
    return nextIntervalDue(completedTs, task.intervalValue ?? 1, task.intervalUnit ?? 'day', tz);
  }
  if (task.recurrenceKind === 'annual') {
    return nextAnnualDue(completedTs, task.annualMonth ?? 1, task.annualDay ?? 1, tz);
  }
  return null; // once
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/recurrence.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/maintenance-types.ts src/lib/server/recurrence.ts tests/recurrence.test.ts
git commit -m "feat(maintenance): recurrence + initial-due math with tz and clamping"
```

## Task B4: Task store (CRUD, complete, due selection)

**Files:**
- Create: `src/lib/server/maintenance.ts`
- Modify: `tests/maintenance.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// append to tests/maintenance.test.ts
import {
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  completeTask,
  selectDueTasks,
  TZ,
} from '../src/lib/server/maintenance';

describe('task store', () => {
  it('creates and lists a dated one-off', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'Fix gate', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    expect(t.title).toBe('Fix gate');
    expect(t.dueTs).not.toBeNull();
    const all = listTasks(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
  });

  it('creates an undated todo with null due', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'Buy bulbs', recurrenceKind: 'once' }, Date.now());
    expect(t.dueTs).toBeNull();
  });

  it('updates a task title', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'old', recurrenceKind: 'once' }, Date.now());
    updateTask(db, t.id, { title: 'new', recurrenceKind: 'once' }, Date.now());
    expect(listTasks(db)[0].title).toBe('new');
  });

  it('deletes a task', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'x', recurrenceKind: 'once' }, Date.now());
    deleteTask(db, t.id);
    expect(listTasks(db)).toHaveLength(0);
  });

  it('archives a once task on completion (drops from active list)', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'one off', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    completeTask(db, t.id, Date.parse('2025-09-01T12:00:00Z'));
    expect(listTasks(db)).toHaveLength(0); // active list excludes archived
  });

  it('reschedules an interval task on completion', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'filter', recurrenceKind: 'interval', intervalValue: 3, intervalUnit: 'month', firstDueDate: '2025-06-01' },
      Date.parse('2025-05-01T10:00:00Z'),
    );
    completeTask(db, t.id, Date.parse('2025-06-02T10:00:00Z'));
    const after = listTasks(db)[0];
    expect(after.dueTs).toBeGreaterThan(Date.parse('2025-09-01T00:00:00Z')); // ~3 months out
    expect(after.lastCompletedTs).toBe(Date.parse('2025-06-02T10:00:00Z'));
  });
});

describe('selectDueTasks', () => {
  it('returns enabled, dated tasks at/after due that have not been reminded this cycle', () => {
    const db = tempDb();
    const due = createTask(db, { title: 'due', recurrenceKind: 'once', firstDueDate: '2025-06-01' }, Date.parse('2025-05-01T10:00:00Z'));
    createTask(db, { title: 'todo', recurrenceKind: 'once' }, Date.now()); // undated, excluded
    createTask(db, { title: 'future', recurrenceKind: 'once', firstDueDate: '2030-01-01' }, Date.now()); // not due
    const now = Date.parse('2025-06-01T09:30:00Z');
    const picked = selectDueTasks(db, now);
    expect(picked.map((t) => t.id)).toEqual([due.id]);
  });

  it('excludes a task already reminded for its current due cycle', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'due', recurrenceKind: 'once', firstDueDate: '2025-06-01' }, Date.parse('2025-05-01T10:00:00Z'));
    const now = Date.parse('2025-06-01T09:30:00Z');
    db.prepare('UPDATE maintenance_task SET last_reminded_ts = ? WHERE id = ?').run(now, t.id);
    expect(selectDueTasks(db, now)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/maintenance.test.ts`
Expected: FAIL — module `../src/lib/server/maintenance` not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/maintenance.ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { computeInitialDue, nextDueAfterComplete } from './recurrence';
import type { MaintenanceTask, TaskInput } from './maintenance-types';

export const TZ = process.env.TIMEZONE ?? 'Europe/Oslo';

interface Row {
  id: string;
  title: string;
  notes: string | null;
  recurrence_kind: string;
  interval_value: number | null;
  interval_unit: string | null;
  annual_month: number | null;
  annual_day: number | null;
  due_ts: number | null;
  last_completed_ts: number | null;
  last_reminded_ts: number | null;
  enabled: number;
}

function toTask(r: Row): MaintenanceTask {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    recurrenceKind: r.recurrence_kind as MaintenanceTask['recurrenceKind'],
    intervalValue: r.interval_value,
    intervalUnit: r.interval_unit as MaintenanceTask['intervalUnit'],
    annualMonth: r.annual_month,
    annualDay: r.annual_day,
    dueTs: r.due_ts,
    lastCompletedTs: r.last_completed_ts,
    lastRemindedTs: r.last_reminded_ts,
    enabled: !!r.enabled,
  };
}

const SELECT = `SELECT id, title, notes, recurrence_kind, interval_value, interval_unit,
  annual_month, annual_day, due_ts, last_completed_ts, last_reminded_ts, enabled
  FROM maintenance_task`;

export function createTask(db: Database.Database, input: TaskInput, now: number): MaintenanceTask {
  const id = randomUUID();
  const due = computeInitialDue(input, now, TZ);
  db.prepare(
    `INSERT INTO maintenance_task
      (id, title, notes, recurrence_kind, interval_value, interval_unit, annual_month, annual_day, due_ts, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
  );
  return getTask(db, id)!;
}

export function getTask(db: Database.Database, id: string): MaintenanceTask | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? toTask(r) : null;
}

// Active list: enabled tasks only (completed once-tasks are disabled = archived).
export function listTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY due_ts IS NULL, due_ts ASC`).all() as Row[];
  return rows.map(toTask);
}

export function updateTask(db: Database.Database, id: string, input: TaskInput, now: number): MaintenanceTask | null {
  if (!getTask(db, id)) return null;
  const due = computeInitialDue(input, now, TZ);
  db.prepare(
    `UPDATE maintenance_task SET title = ?, notes = ?, recurrence_kind = ?, interval_value = ?,
      interval_unit = ?, annual_month = ?, annual_day = ?, due_ts = ? WHERE id = ?`,
  ).run(
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
    id,
  );
  return getTask(db, id);
}

export function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM maintenance_task WHERE id = ?').run(id);
}

export function completeTask(db: Database.Database, id: string, now: number): MaintenanceTask | null {
  const task = getTask(db, id);
  if (!task) return null;
  const next = nextDueAfterComplete(task, now, TZ);
  if (next === null) {
    // once: archive
    db.prepare('UPDATE maintenance_task SET last_completed_ts = ?, enabled = 0 WHERE id = ?').run(now, id);
  } else {
    db.prepare(
      'UPDATE maintenance_task SET last_completed_ts = ?, due_ts = ?, last_reminded_ts = NULL WHERE id = ?',
    ).run(now, next, id);
  }
  return getTask(db, id);
}

// Tasks that should fire a reminder right now.
export function selectDueTasks(db: Database.Database, now: number): MaintenanceTask[] {
  const rows = db
    .prepare(
      `${SELECT} WHERE enabled = 1 AND due_ts IS NOT NULL AND due_ts <= ?
        AND (last_reminded_ts IS NULL OR last_reminded_ts < due_ts)`,
    )
    .all(now) as Row[];
  return rows.map(toTask);
}

export function markReminded(db: Database.Database, id: string, now: number): void {
  db.prepare('UPDATE maintenance_task SET last_reminded_ts = ? WHERE id = ?').run(now, id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/maintenance.test.ts`
Expected: PASS (schema + store + selection).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/maintenance.ts tests/maintenance.test.ts
git commit -m "feat(maintenance): task store with CRUD, complete, and due selection"
```

## Task B5: Reminder loop in boot.ts

**Files:**
- Modify: `src/lib/server/boot.ts`

- [ ] **Step 1: Read boot.ts to find `startBackend` and the `openDb()`/`sendToAll` usage**

Run: `cat src/lib/server/boot.ts`
Locate where other `setInterval` loops are registered and where `openDb()` and `sendToAll` are already imported (add imports if missing).

- [ ] **Step 2: Add the reminder loop**

Add this import near the other server imports:

```ts
import { selectDueTasks, markReminded } from './maintenance';
```

Then, inside `startBackend()` alongside the existing intervals, register an hourly check:

```ts
const HOUR_MS = 60 * 60 * 1000;
setInterval(() => {
  try {
    const db = openDb();
    const now = Date.now();
    const due = selectDueTasks(db, now);
    for (const t of due) {
      sendToAll({ title: 'Task due', body: t.title, tag: `task:${t.id}` }).catch((err) =>
        console.error('[maintenance] push failed', err),
      );
      markReminded(db, t.id, now);
    }
  } catch (err) {
    console.error('[maintenance] reminder loop failed', err);
  }
}, HOUR_MS);
```

Confirm `openDb` (from `./db`) and `sendToAll` (from `./push`) are imported in this file; if not, add `import { openDb } from './db';` and `import { sendToAll } from './push';`.

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/boot.ts
git commit -m "feat(maintenance): hourly reminder loop sends web-push for due tasks"
```

---

# Phase C — API & UI

## Task C1: List + create endpoint

**Files:**
- Create: `src/routes/api/maintenance/tasks/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/maintenance/tasks/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { createTask, listTasks } from '$lib/server/maintenance';
import type { TaskInput } from '$lib/server/maintenance-types';

export const GET: RequestHandler = () => {
  return json({ tasks: listTasks(openDb()) });
};

export const POST: RequestHandler = async ({ request }) => {
  const input = (await request.json()) as TaskInput;
  if (!input?.title || !input.recurrenceKind) throw error(400, 'title and recurrenceKind required');
  const task = createTask(openDb(), input, Date.now());
  return json({ task }, { status: 201 });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Manual smoke (dev server running, unlocked)**

Run:
```bash
curl -s -X POST localhost:5173/api/maintenance/tasks \
  -H 'content-type: application/json' \
  -b "home_access=$COOKIE" \
  -d '{"title":"Test filter","recurrenceKind":"interval","intervalValue":3,"intervalUnit":"month"}'
curl -s -b "home_access=$COOKIE" localhost:5173/api/maintenance/tasks
```
Expected: create returns a task with a non-null `dueTs`; list includes it. (Skip the cookie if the gate is inactive.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/maintenance/tasks/+server.ts
git commit -m "feat(maintenance): list + create API"
```

## Task C2: Update + delete endpoint

**Files:**
- Create: `src/routes/api/maintenance/tasks/[id]/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/maintenance/tasks/[id]/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { updateTask, deleteTask } from '$lib/server/maintenance';
import type { TaskInput } from '$lib/server/maintenance-types';

export const PUT: RequestHandler = async ({ params, request }) => {
  const input = (await request.json()) as TaskInput;
  if (!input?.title || !input.recurrenceKind) throw error(400, 'title and recurrenceKind required');
  const task = updateTask(openDb(), params.id!, input, Date.now());
  if (!task) throw error(404, 'not found');
  return json({ task });
};

export const DELETE: RequestHandler = ({ params }) => {
  deleteTask(openDb(), params.id!);
  return json({ ok: true });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'src/routes/api/maintenance/tasks/[id]/+server.ts'
git commit -m "feat(maintenance): update + delete API"
```

## Task C3: Complete endpoint

**Files:**
- Create: `src/routes/api/maintenance/tasks/[id]/complete/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/maintenance/tasks/[id]/complete/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { completeTask } from '$lib/server/maintenance';

export const POST: RequestHandler = ({ params }) => {
  const task = completeTask(openDb(), params.id!, Date.now());
  if (!task) throw error(404, 'not found');
  return json({ task });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'src/routes/api/maintenance/tasks/[id]/complete/+server.ts'
git commit -m "feat(maintenance): complete API reschedules or archives"
```

## Task C4: Tasks page

**Files:**
- Create: `src/routes/tasks/+page.svelte`

- [ ] **Step 1: Implement**

This page lists tasks grouped by status and provides an add form whose visible
fields depend on the chosen recurrence kind. It uses the existing Skålda CSS
tokens already defined in `src/app.css`.

```svelte
<!-- src/routes/tasks/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { MaintenanceTask, TaskInput, RecurrenceKind, IntervalUnit } from '$lib/server/maintenance-types';

  let tasks = $state<MaintenanceTask[]>([]);
  let title = $state('');
  let kind = $state<RecurrenceKind>('once');
  let firstDueDate = $state('');
  let intervalValue = $state(3);
  let intervalUnit = $state<IntervalUnit>('month');
  let annualMonth = $state(10);
  let annualDay = $state(15);

  async function load() {
    const r = await fetch('/api/maintenance/tasks');
    if (r.ok) tasks = (await r.json()).tasks;
  }
  onMount(load);

  function buildInput(): TaskInput {
    const base: TaskInput = { title, recurrenceKind: kind };
    if (kind === 'once' && firstDueDate) base.firstDueDate = firstDueDate;
    if (kind === 'interval') {
      base.intervalValue = intervalValue;
      base.intervalUnit = intervalUnit;
      if (firstDueDate) base.firstDueDate = firstDueDate;
    }
    if (kind === 'annual') {
      base.annualMonth = annualMonth;
      base.annualDay = annualDay;
    }
    return base;
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await fetch('/api/maintenance/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildInput()),
    });
    if (r.ok) {
      title = '';
      firstDueDate = '';
      await load();
    }
  }

  async function complete(id: string) {
    await fetch(`/api/maintenance/tasks/${id}/complete`, { method: 'POST' });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/maintenance/tasks/${id}`, { method: 'DELETE' });
    await load();
  }

  const DAY = 24 * 3600 * 1000;
  function group(t: MaintenanceTask): 'overdue' | 'soon' | 'upcoming' | 'todo' {
    if (t.dueTs === null) return 'todo';
    const now = Date.now();
    if (t.dueTs < now) return 'overdue';
    if (t.dueTs < now + 7 * DAY) return 'soon';
    return 'upcoming';
  }
  const order = { overdue: 0, soon: 1, upcoming: 2, todo: 3 } as const;
  const labels = { overdue: 'Overdue', soon: 'Due soon', upcoming: 'Upcoming', todo: 'No date' };

  let grouped = $derived(
    (['overdue', 'soon', 'upcoming', 'todo'] as const).map((g) => ({
      key: g,
      label: labels[g],
      items: tasks.filter((t) => group(t) === g),
    })).filter((s) => s.items.length > 0),
  );

  function fmtDue(ts: number | null): string {
    if (ts === null) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
  }
</script>

<main class="tasks">
  <h1>Tasks</h1>

  <form class="add" onsubmit={add}>
    <input placeholder="New task…" bind:value={title} aria-label="Task title" />
    <select bind:value={kind} aria-label="Recurrence">
      <option value="once">One-off / todo</option>
      <option value="interval">Repeat every…</option>
      <option value="annual">Every year</option>
    </select>

    {#if kind === 'once'}
      <input type="date" bind:value={firstDueDate} aria-label="Due date (optional)" />
    {:else if kind === 'interval'}
      <input type="number" min="1" bind:value={intervalValue} aria-label="Interval value" />
      <select bind:value={intervalUnit} aria-label="Interval unit">
        <option value="day">days</option>
        <option value="week">weeks</option>
        <option value="month">months</option>
      </select>
      <input type="date" bind:value={firstDueDate} aria-label="First due date (optional)" />
    {:else}
      <input type="number" min="1" max="12" bind:value={annualMonth} aria-label="Month" />
      <input type="number" min="1" max="31" bind:value={annualDay} aria-label="Day" />
    {/if}

    <button type="submit">Add</button>
  </form>

  {#each grouped as section (section.key)}
    <section>
      <h2>{section.label}</h2>
      <ul>
        {#each section.items as t (t.id)}
          <li class={group(t)}>
            <button class="check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete">✓</button>
            <span class="title">{t.title}</span>
            {#if t.dueTs !== null}<span class="due">{fmtDue(t.dueTs)}</span>{/if}
            <button class="del" title="Delete" onclick={() => remove(t.id)} aria-label="Delete">✕</button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if tasks.length === 0}
    <p class="empty">No tasks yet.</p>
  {/if}
</main>

<style>
  .tasks { display: flex; flex-direction: column; gap: 18px; }
  h1 { font-size: 1.3rem; margin: 0; }
  h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; margin: 0 0 6px; }
  .add { display: flex; flex-wrap: wrap; gap: 8px; }
  .add input, .add select, .add button { padding: 10px 12px; border-radius: var(--radius, 10px); border: 1px solid var(--border, #3334); font: inherit; }
  .add input[type='text'], .add input:not([type]) { flex: 1 1 160px; }
  .add button { cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius, 10px); background: var(--card, #1c1c1e0a); }
  li.overdue { border-left: 3px solid var(--danger, #d33); }
  .title { flex: 1; }
  .due { font-size: 0.85rem; opacity: 0.7; }
  .check, .del { border: none; background: none; cursor: pointer; font-size: 1rem; opacity: 0.7; }
  .check:hover { opacity: 1; color: var(--success, #2a8); }
  .del:hover { opacity: 1; color: var(--danger, #d33); }
  .empty { opacity: 0.6; }
</style>
```

- [ ] **Step 2: Manual verification**

With the dev server running and unlocked, visit `/tasks`: add a one-off with a
date, an interval task, and an undated todo. Confirm grouping (Overdue / Due
soon / Upcoming / No date), that ✓ completes (interval reschedules, one-off
disappears), and that ✕ deletes.

- [ ] **Step 3: Commit**

```bash
git add src/routes/tasks/+page.svelte
git commit -m "feat(maintenance): tasks page with add form and grouped list"
```

## Task C5: Add Tasks tab + rebrand shell

**Files:**
- Modify: `src/lib/components/TabBar.svelte`
- Modify: the app shell where the app name/title appears (locate with `git grep -n -i "arctic\\|spa" src/routes/+layout.svelte src/app.html`).

- [ ] **Step 1: Read the TabBar to learn its item structure**

Run: `cat src/lib/components/TabBar.svelte`
Identify the array/markup of tabs (each has an href, label, and icon).

- [ ] **Step 2: Add a Tasks tab**

Following the exact shape of the existing tabs, add an entry linking to `/tasks`
with a label "Tasks" and a checklist-style icon. Match the existing icon
convention (inline SVG or icon component) used by the other tabs — copy a
sibling tab entry and change its `href`, label, and icon path. Example SVG path
for a checklist icon if the project uses inline SVGs:

```svelte
<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
</svg>
```

- [ ] **Step 3: Rebrand the shell name**

Replace the user-facing app title (e.g. in `src/app.html` `<title>` and any
header text in `+layout.svelte`) from the spa-specific name to a neutral home
name (e.g. "Home"). Do not rename code identifiers, package name, the Fly app,
or DB file — UI text only.

- [ ] **Step 4: Typecheck + manual check**

Run: `npm run check`
Then load the app and confirm the TabBar shows the new Tasks tab and navigates
to `/tasks`, sitting correctly above the bottom safe-area padding fixed earlier.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/TabBar.svelte src/routes/+layout.svelte src/app.html
git commit -m "feat(ui): add Tasks tab and rebrand shell to home app"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all tests pass (access, clock, recurrence, maintenance, plus existing suites).

- [ ] **Typecheck the whole project**

Run: `npm run check`
Expected: no errors.

- [ ] **End-to-end smoke**

With the gate active: log in at `/unlock`, create one task of each kind, complete
an interval task (verify it reschedules ~correctly), complete a one-off (verify
it disappears), and confirm `curl` to `/api/maintenance/tasks` without the cookie
returns `401`.
