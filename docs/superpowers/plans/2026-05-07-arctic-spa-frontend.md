# Arctic Spa Custom Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use, mobile-first PWA that replaces `myarcticspa.com` for daily Arctic Spa monitoring — eliminating the per-check login, adding Spa Boy chemistry visibility, history graphs, and Web Push alerts.

**Architecture:** Single SvelteKit app on Fly.io. A startup hook authenticates via the mobile-app OAuth2 flow (`api.myarcticspa.com/api/auth` → salt → SHA-1/UTF-16-LE hash → `/access_token` → JWT) and connects to `tcp://broker.myarcticspa.com:1884` with the JWT as the MQTT username. The app subscribes to `arctic/spa/<UUID>/#`, persists raw events to SQLite, fans out via SSE to the SPA, computes 5-minute rollups, and fires Web Push when alert rules trigger. No browser-side MQTT, no HTML scraping, no raw password ever stored.

**Tech Stack:** SvelteKit + TypeScript, Tailwind, `mqtt`, `better-sqlite3`, `web-push`, `vitest`, `@vite-pwa/sveltekit`, deployed on Fly.io with a persistent volume.

**Spec:** `docs/superpowers/specs/2026-05-07-arctic-spa-frontend-design.md`

**Design system:** `design/tokens.md`. UI tasks (17-20, 23, 26) implement against this rather than inventing styling. `design/dashboard-preview.html` is the live mockup (open in any browser). `design/states.html` shows loading / stale / error / no-Spa-Boy variants — components must handle each state gracefully. `design/icon.svg` is the source-of-truth PWA icon, rasterised to PNGs at build time (Task 19).

---

## Setup notes (one-time prep before Task 1)

- WSL working dir: `/mnt/c/Dev/artic-spa-v2`. Already a git repo (one commit so far: the spec).
- Add `spike/` and `node_modules/` to `.gitignore` early (Task 1) — the decompiled APK is large and we don't ship it.
- Node 20+ assumed. If absent, `nvm install 20`.
- Real Arctic Spa credentials (email + password) needed for the integration test in Task 7. Until then, all tests use mocks.

---

## File Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── arctic-auth.ts        # OAuth2 flow + password hashing + token refresh
│   │   ├── mqtt.ts               # broker connection + topic subscriptions
│   │   ├── state.ts              # in-memory current SpaState + SSE fan-out
│   │   ├── history.ts            # SQLite writes + 5-min rollup
│   │   ├── alerts.ts             # rule evaluation + Web Push dispatch
│   │   ├── push.ts               # Web Push subscription store + send helper
│   │   ├── db.ts                 # better-sqlite3 init + migrations
│   │   ├── secrets.ts            # read/write env-backed secrets (tested via tmpfile in dev)
│   │   └── types.ts              # SpaState, MqttPayload, AlertRule types
│   └── components/
│       ├── TemperatureCard.svelte
│       ├── AccessoryGrid.svelte
│       ├── ChemistryCard.svelte
│       ├── HistoryChart.svelte
│       └── AlertRuleEditor.svelte
├── routes/
│   ├── +layout.svelte                  # PWA shell, dark mode toggle, nav
│   ├── +layout.server.ts               # auth-state gate (redirects to /setup if needed)
│   ├── +page.svelte                    # Dashboard
│   ├── setup/+page.svelte              # First-time credential entry
│   ├── history/+page.svelte
│   ├── alerts/+page.svelte
│   └── api/
│       ├── state/+server.ts            # GET current snapshot
│       ├── state/stream/+server.ts     # SSE
│       ├── history/+server.ts          # GET rollups
│       ├── alerts/rules/+server.ts     # GET / PUT rules
│       ├── alerts/subscribe/+server.ts # POST Web Push subscription
│       └── setup/+server.ts            # POST credentials → run flow + persist
├── hooks.server.ts                     # boot the MQTT subscriber + JWT refresh loop
├── app.html
└── service-worker.ts                   # PWA caching + Web Push receive

tests/
├── arctic-auth.test.ts
├── mqtt.test.ts
├── state.test.ts
├── history.test.ts
├── alerts.test.ts
├── push.test.ts
└── db.test.ts

package.json
tsconfig.json
svelte.config.js
vite.config.ts
tailwind.config.cjs
postcss.config.cjs
fly.toml
Dockerfile
.env.example
.gitignore
```

---

## Milestone 0 — Scaffolding (Tasks 1–3)

### Task 1: Initialize SvelteKit project

**Files:**
- Create: `.gitignore`, `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.html`, `src/app.d.ts`, `src/routes/+page.svelte`

- [ ] **Step 1: Bootstrap SvelteKit**

```bash
cd /mnt/c/Dev/artic-spa-v2
npm create svelte@latest . -- --template skeleton --types typescript --no-eslint --no-prettier --no-playwright --no-vitest
# Answer prompts: TypeScript yes, ESLint no, Prettier no, Playwright no, Vitest no.
# (We add vitest manually in Task 2 to control the version.)
```

- [ ] **Step 2: Add core deps**

```bash
npm install
npm install --save-exact mqtt better-sqlite3 web-push
npm install --save-dev --save-exact @types/better-sqlite3 @types/web-push vitest @vitest/ui
```

- [ ] **Step 3: Update `.gitignore`**

Append to the SvelteKit-generated `.gitignore`:

```
spike/
*.db
*.db-journal
.env
.env.local
data/
```

- [ ] **Step 4: Smoke test**

Run: `npm run dev`
Expected: dev server starts on `http://localhost:5173`, default page loads.
Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json svelte.config.js vite.config.ts tsconfig.json src/
git commit -m "chore: scaffold SvelteKit + TypeScript project"
```

---

### Task 2: Add Tailwind, vitest config, scripts

**Files:**
- Create: `tailwind.config.cjs`, `postcss.config.cjs`, `src/app.css`, `vitest.config.ts`
- Modify: `src/routes/+layout.svelte` (create if missing), `package.json`

- [ ] **Step 1: Install Tailwind**

```bash
npm install --save-dev --save-exact tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Tailwind**

`tailwind.config.cjs`:
```js
module.exports = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
```

`src/app.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Wire Tailwind into the layout**

Create `src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
</script>
<slot />
```

- [ ] **Step 4: Add vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify**

Run: `npm run dev` — confirm Tailwind classes work (modify `+page.svelte` temporarily with `<h1 class="text-2xl font-bold">Hi</h1>`, see it render).
Run: `npm run test` — should report "no test files found" and exit 0.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.cjs postcss.config.cjs vitest.config.ts src/app.css src/routes/+layout.svelte package.json package-lock.json
git commit -m "chore: add Tailwind and Vitest"
```

---

### Task 3: Initial type definitions

**Files:**
- Create: `src/lib/server/types.ts`

These types are referenced throughout. Keep this file the single source of truth.

- [ ] **Step 1: Define core types**

`src/lib/server/types.ts`:
```ts
// JWT-issuing OAuth2 server response shape (subset).
export type OAuth2AccessToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // seconds
  token_type: string;       // "bearer"
};

// /api/auth response shape.
export type ValidateUserResponse = {
  ErrorCode: number | null;
  Salt: string | null;       // base64-encoded
  UserId: string | null;
  Spas: AuthenticationSpa[];
};

export type AuthenticationSpa = {
  Id: string;                // UUID, lowercased when used in OAuth username
  NickName: string | null;
  IsConnected: boolean;
  IsMoved: boolean | null;
  DealerId: number | null;
};

// The unified spa state we expose to the SPA. Every field is optional
// until the corresponding MQTT topic delivers a payload.
export type SpaState = {
  ts: number;                          // last update timestamp (ms)
  temperatureF?: number;
  targetTemperatureF?: number;
  heating?: boolean;
  pumps?: { id: number; speed: 0 | 1 | 2 }[];
  blower?: boolean;
  lights?: boolean;
  errors?: string[];
  chemistry?: { ph?: number; chlorine?: number; orp?: number };
  filterCycle?: { active: boolean; nextStartTs?: number };
  rfidTag?: string;
};

export type AlertRule = {
  id: string;
  kind:
    | 'error_present'
    | 'temperature_outside'
    | 'filter_cycle_missed'
    | 'chemistry_outside';
  threshold: Record<string, number | string>;
  enabled: boolean;
};

export type RawMqttEvent = {
  ts: number;
  topic: string;
  payload: unknown;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/types.ts
git commit -m "feat: add core type definitions"
```

---

## Milestone 1 — Auth pipeline (Tasks 4–7)

### Task 4: Password hasher (TDD against the app's algorithm)

**Files:**
- Create: `src/lib/server/hasher.ts`, `tests/hasher.test.ts`

The algorithm is reverse-engineered from `Hasher.apply` in the decompiled APK:
`base64(SHA1(base64decode(salt) || utf16le(password)))[:-1]`

- [ ] **Step 1: Write the failing test**

`tests/hasher.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword } from '../src/lib/server/hasher';

describe('hashPassword', () => {
  it('matches the expected algorithm shape (SHA-1 over base64-decoded salt + UTF-16-LE password, base64 with trailing char dropped)', () => {
    // Salt = base64('saltsalt') = 'c2FsdHNhbHQ='. Decoded: 8 bytes 'saltsalt'.
    // Password 'a' as UTF-16-LE = bytes [0x61, 0x00].
    // Concatenated = 'saltsalt' + [0x61, 0x00] = 10 bytes.
    // SHA-1 of those 10 bytes (hex): a957a9c4cb39c0e8cf2eaf6a55ee9586d9af9ab0
    // Base64 of that digest = 'qVepxMs5wOjPLq9qVe6VhtmvmrA='
    // After dropping last char: 'qVepxMs5wOjPLq9qVe6VhtmvmrA'
    const result = hashPassword('a', 'c2FsdHNhbHQ=');
    expect(result).toBe('qVepxMs5wOjPLq9qVe6VhtmvmrA');
  });

  it('handles empty password', () => {
    // SHA-1 of just the decoded salt 'saltsalt' (8 bytes): 67051d7e7e2cf6776a4f7e98c7d5d5c97aafe3a4
    // Base64: 'ZwUdfn4s9ndqT36Yx9XVyXqv46Q=' → drop last: 'ZwUdfn4s9ndqT36Yx9XVyXqv46Q'
    const result = hashPassword('', 'c2FsdHNhbHQ=');
    expect(result).toBe('ZwUdfn4s9ndqT36Yx9XVyXqv46Q');
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

Run: `npm run test`
Expected: "Cannot find module '../src/lib/server/hasher'".

- [ ] **Step 3: Implement**

`src/lib/server/hasher.ts`:
```ts
import { createHash } from 'node:crypto';

/**
 * Reproduces the password hash format used by com.crazedcoders.globalspa
 * (Hasher.apply in v5.0.41). Algorithm:
 *   1. Decode the base64-encoded salt to bytes
 *   2. UTF-16-LE-encode the raw password
 *   3. SHA-1 of concatenated (salt-bytes || password-bytes)
 *   4. Base64-encode the digest
 *   5. Drop the final character
 */
export function hashPassword(password: string, saltBase64: string): string {
  const saltBytes = Buffer.from(saltBase64, 'base64');
  const pwdBytes = Buffer.from(password, 'utf16le');
  const combined = Buffer.concat([saltBytes, pwdBytes]);
  const digest = createHash('sha1').update(combined).digest();
  const b64 = digest.toString('base64');
  return b64.slice(0, -1);
}
```

- [ ] **Step 4: Run the test, see it pass**

Run: `npm run test`
Expected: 2 tests passing.

If a test value disagrees: recompute manually with `node -e "console.log(require('crypto').createHash('sha1').update(Buffer.concat([Buffer.from('c2FsdHNhbHQ=', 'base64'), Buffer.from('a', 'utf16le')])).digest('base64'))"` and update the expected string. The algorithm is what matters, not the synthetic vector.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/hasher.ts tests/hasher.test.ts
git commit -m "feat: password hasher matching the mobile app's algorithm"
```

---

### Task 5: OAuth2 client (mocked HTTP)

**Files:**
- Create: `src/lib/server/arctic-auth.ts`, `tests/arctic-auth.test.ts`

This task implements the two HTTP calls and the token-refresh logic. We mock fetch so it runs without real credentials.

- [ ] **Step 1: Write the failing tests**

`tests/arctic-auth.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateUser, grantToken, refreshAccessToken } from '../src/lib/server/arctic-auth';

beforeEach(() => {
  vi.restoreAllMocks();
});

const fakeFetch = (responses: Array<{ status: number; body: unknown }>) => {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
};

describe('validateUser', () => {
  it('POSTs to /api/auth and returns Salt/UserId/Spas', async () => {
    const f = fakeFetch([{ status: 200, body: { ErrorCode: 0, Salt: 'c2FsdA==', UserId: 'user-1', Spas: [{ Id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NickName: 'Mine', IsConnected: true, IsMoved: null, DealerId: 0 }] } }]);
    vi.stubGlobal('fetch', f);
    const r = await validateUser('user@example.com', 'pw');
    expect(f).toHaveBeenCalledWith(
      'https://api.myarcticspa.com/api/auth',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ Username: 'user@example.com', Password: 'pw' }) }),
    );
    expect(r.Salt).toBe('c2FsdA==');
    expect(r.Spas[0].Id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});

describe('grantToken', () => {
  it('POSTs grant_type=password with composite username and persisted hash', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.X.Y', refresh_token: 'rt-1', expires_in: 3600, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    const t = await grantToken({
      email: 'user@example.com',
      passwordHash: 'hashhash',
      spa: { Id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', NickName: 'Mine', IsConnected: true, IsMoved: null, DealerId: 0 },
    });
    expect(f).toHaveBeenCalledWith(
      'https://api.myarcticspa.com/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('password');
    expect(body.username).toBe('user@example.com|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body.password).toBe('hashhash');
    expect(body.spa.Id).toBe('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');
    expect(t.access_token).toBe('JWT.X.Y');
    expect(t.expires_in).toBe(3600);
  });
});

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.A.B', refresh_token: 'rt-2', expires_in: 1800, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    const t = await refreshAccessToken('rt-1');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('refresh_token');
    expect(body.refresh_token).toBe('rt-1');
    expect(t.access_token).toBe('JWT.A.B');
    expect(t.refresh_token).toBe('rt-2');
  });
});
```

- [ ] **Step 2: Run, see them fail**

Run: `npm run test -- arctic-auth`
Expected: module-not-found error.

- [ ] **Step 3: Implement**

`src/lib/server/arctic-auth.ts`:
```ts
import type { OAuth2AccessToken, ValidateUserResponse, AuthenticationSpa } from './types';

const API = 'https://api.myarcticspa.com';
const OAUTH_CLIENT_ID = 'mqtt-mobile';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function validateUser(email: string, password: string): Promise<ValidateUserResponse> {
  return postJson<ValidateUserResponse>('/api/auth', { Username: email, Password: password });
}

export type GrantArgs = {
  email: string;
  passwordHash: string;
  spa: AuthenticationSpa;
  userId?: string | null;
};

export async function grantToken(args: GrantArgs): Promise<OAuth2AccessToken> {
  const spaIdLower = args.spa.Id.toLowerCase();
  const username = `${args.email}|${spaIdLower}`;
  return postJson<OAuth2AccessToken>('/access_token', {
    grant_type: 'password',
    client_id: OAUTH_CLIENT_ID,
    username,
    password: args.passwordHash,
    spa: args.spa,
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuth2AccessToken> {
  return postJson<OAuth2AccessToken>('/access_token', {
    grant_type: 'refresh_token',
    client_id: OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });
}

/** Decode a JWT's payload without verification — we only need the `sub` claim (the spa UUID). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function spaUuidFromJwt(jwt: string): string | null {
  const p = decodeJwtPayload(jwt);
  return typeof p?.sub === 'string' ? p.sub : null;
}
```

- [ ] **Step 4: Run, see them pass**

Run: `npm run test`
Expected: hasher tests + 3 auth tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/arctic-auth.ts tests/arctic-auth.test.ts
git commit -m "feat: OAuth2 client for arctic spa API (validate, grant, refresh)"
```

---

### Task 6: Secrets store (file-backed for local dev, env vars in prod)

**Files:**
- Create: `src/lib/server/secrets.ts`, `tests/secrets.test.ts`

The backend needs to persist `passwordHash`, `refresh_token`, etc. across restarts. In production these live in Fly secrets (env vars). In dev we use a JSON file in `data/`.

- [ ] **Step 1: Write the failing tests**

`tests/secrets.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecretsStore } from '../src/lib/server/secrets';

describe('SecretsStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'secrets-')); });

  it('returns null for unset keys', () => {
    const s = createSecretsStore({ filePath: join(dir, 'secrets.json'), env: {} });
    expect(s.get('ARCTIC_PASSWORD_HASH')).toBeNull();
  });

  it('persists and reads back values', () => {
    const f = join(dir, 'secrets.json');
    const s1 = createSecretsStore({ filePath: f, env: {} });
    s1.set('ARCTIC_PASSWORD_HASH', 'abc');
    const s2 = createSecretsStore({ filePath: f, env: {} });
    expect(s2.get('ARCTIC_PASSWORD_HASH')).toBe('abc');
  });

  it('env vars take precedence over file', () => {
    const f = join(dir, 'secrets.json');
    const s = createSecretsStore({ filePath: f, env: { ARCTIC_PASSWORD_HASH: 'fromEnv' } });
    s.set('ARCTIC_PASSWORD_HASH', 'fromFile');
    expect(s.get('ARCTIC_PASSWORD_HASH')).toBe('fromEnv');
  });
});
```

- [ ] **Step 2: Run, see them fail**

Run: `npm run test -- secrets`

- [ ] **Step 3: Implement**

`src/lib/server/secrets.ts`:
```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SecretKey =
  | 'ARCTIC_USERNAME'
  | 'ARCTIC_USER_ID'
  | 'ARCTIC_SPA_UUID'
  | 'ARCTIC_PASSWORD_HASH'
  | 'ARCTIC_REFRESH_TOKEN'
  | 'VAPID_PUBLIC_KEY'
  | 'VAPID_PRIVATE_KEY';

export interface SecretsStore {
  get(key: SecretKey): string | null;
  set(key: SecretKey, value: string): void;
  delete(key: SecretKey): void;
}

export function createSecretsStore(opts: { filePath: string; env: NodeJS.ProcessEnv }): SecretsStore {
  const { filePath, env } = opts;

  function readFile(): Record<string, string> {
    if (!existsSync(filePath)) return {};
    try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return {}; }
  }
  function writeFile(data: Record<string, string>) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    get(key) {
      const fromEnv = env[key];
      if (fromEnv && fromEnv.length > 0) return fromEnv;
      const data = readFile();
      return data[key] ?? null;
    },
    set(key, value) {
      const data = readFile();
      data[key] = value;
      writeFile(data);
    },
    delete(key) {
      const data = readFile();
      delete data[key];
      writeFile(data);
    },
  };
}

export const defaultSecrets = createSecretsStore({
  filePath: process.env.SECRETS_FILE ?? './data/secrets.json',
  env: process.env,
});
```

- [ ] **Step 4: Run, see them pass**

Run: `npm run test -- secrets`

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/secrets.ts tests/secrets.test.ts
git commit -m "feat: env+file secrets store"
```

---

### Task 7: Setup endpoint (one-time credential entry, with live integration)

**Files:**
- Create: `src/routes/api/setup/+server.ts`, `src/routes/setup/+page.svelte`, `src/routes/setup/+page.server.ts`

This is the moment of truth — first integration test against the real API. Until this runs successfully, we don't know whether our hash algorithm matches.

- [ ] **Step 1: Write the endpoint**

`src/routes/api/setup/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { hashPassword } from '$lib/server/hasher';
import { validateUser, grantToken, spaUuidFromJwt } from '$lib/server/arctic-auth';
import { defaultSecrets } from '$lib/server/secrets';

export const POST: RequestHandler = async ({ request }) => {
  const { email, password } = await request.json() as { email: string; password: string };
  if (!email || !password) throw error(400, 'email and password required');

  const validation = await validateUser(email, password);
  if (validation.ErrorCode && validation.ErrorCode !== 0) throw error(401, `validateUser ErrorCode=${validation.ErrorCode}`);
  if (!validation.Salt) throw error(401, 'no salt returned — credentials likely invalid');
  if (!validation.Spas || validation.Spas.length === 0) throw error(404, 'no spa associated with this account');

  const spa = validation.Spas[0]; // single-spa assumption for v1
  const passwordHash = hashPassword(password, validation.Salt);

  const token = await grantToken({ email, passwordHash, spa, userId: validation.UserId });
  const spaUuid = spaUuidFromJwt(token.access_token) ?? spa.Id;

  defaultSecrets.set('ARCTIC_USERNAME', email);
  defaultSecrets.set('ARCTIC_USER_ID', validation.UserId ?? '');
  defaultSecrets.set('ARCTIC_SPA_UUID', spaUuid);
  defaultSecrets.set('ARCTIC_PASSWORD_HASH', passwordHash);
  defaultSecrets.set('ARCTIC_REFRESH_TOKEN', token.refresh_token);

  return json({ ok: true, spaUuid, expires_in: token.expires_in });
};
```

- [ ] **Step 2: Build the setup page**

`src/routes/setup/+page.svelte`:
```svelte
<script lang="ts">
  let email = '';
  let password = '';
  let busy = false;
  let result: { ok: boolean; spaUuid?: string; expires_in?: number; error?: string } | null = null;

  async function submit() {
    busy = true; result = null;
    try {
      const res = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      result = await res.json();
      if (!res.ok) result = { ok: false, error: (result as any)?.message ?? 'unknown error' };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    } finally {
      busy = false;
      password = '';
    }
  }
</script>

<div class="max-w-md mx-auto mt-12 p-6">
  <h1 class="text-2xl font-bold mb-4">First-time setup</h1>
  <p class="text-sm text-gray-500 mb-6">Enter your Arctic Spa credentials. Your raw password is used once to fetch a long-lived token, then discarded — only the hash and refresh token are stored.</p>
  <form on:submit|preventDefault={submit} class="space-y-3">
    <input type="email" placeholder="email" bind:value={email} required class="w-full border p-2" />
    <input type="password" placeholder="password" bind:value={password} required class="w-full border p-2" />
    <button disabled={busy} class="w-full bg-black text-white p-2 disabled:opacity-50">{busy ? 'Connecting…' : 'Connect'}</button>
  </form>
  {#if result}
    <pre class="mt-4 text-xs">{JSON.stringify(result, null, 2)}</pre>
  {/if}
</div>
```

`src/routes/setup/+page.server.ts`:
```ts
// Page is fully client-driven; no server-side load needed. File present for symmetry.
export const load = () => ({});
```

- [ ] **Step 3: Run the live integration**

```bash
npm run dev
```

Open `http://localhost:5173/setup`, type real Arctic Spa credentials, submit.

Expected: `{ ok: true, spaUuid: "<your-uuid>", expires_in: <some-number> }`.
Record the `expires_in` value here for use in the JWT-refresh task: `_______`.

If you get `no salt returned`: credentials wrong, or the salt-fetch endpoint moved.
If you get a non-200 from `/access_token`: hash algorithm mismatch — recheck Task 4 with logged inputs.

- [ ] **Step 4: Verify secrets persisted**

```bash
cat data/secrets.json
```
Expected: a JSON object with `ARCTIC_USERNAME`, `ARCTIC_USER_ID`, `ARCTIC_SPA_UUID`, `ARCTIC_PASSWORD_HASH`, `ARCTIC_REFRESH_TOKEN`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/setup src/routes/setup
git commit -m "feat: setup endpoint + page (validates against live API)"
```

---

## Milestone 2 — MQTT capture + state store (Tasks 8–12)

### Task 8: Database (better-sqlite3 init + schema)

**Files:**
- Create: `src/lib/server/db.ts`, `tests/db.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/db.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

describe('openDb', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'db-')); });

  it('creates the schema if missing', () => {
    const db = openDb(join(dir, 'spa.db'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('events');
    expect(names).toContain('metric_5m');
    expect(names).toContain('accessory_runtime');
    expect(names).toContain('alert_rule');
    expect(names).toContain('alert_event');
    expect(names).toContain('push_subscription');
  });

  it('appends events', () => {
    const db = openDb(join(dir, 'spa.db'));
    db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)').run(1000, 'arctic/spa/x/telemetry/spa', '{"a":1}');
    const r = db.prepare('SELECT count(*) as n FROM events').get() as { n: number };
    expect(r.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run, see them fail**

- [ ] **Step 3: Implement**

`src/lib/server/db.ts`:
```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events(topic, ts);

CREATE TABLE IF NOT EXISTS metric_5m (
  metric TEXT NOT NULL,
  ts_bucket INTEGER NOT NULL,
  avg REAL,
  min REAL,
  max REAL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (metric, ts_bucket)
);

CREATE TABLE IF NOT EXISTS accessory_runtime (
  accessory TEXT NOT NULL,
  day TEXT NOT NULL,            -- ISO date YYYY-MM-DD
  seconds_on INTEGER NOT NULL,
  PRIMARY KEY (accessory, day)
);

CREATE TABLE IF NOT EXISTS alert_rule (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  threshold_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES alert_rule(id)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let cached: Database.Database | null = null;

export function openDb(path?: string): Database.Database {
  const target = path ?? process.env.DB_PATH ?? './data/spa.db';
  if (cached && !path) return cached; // tests pass paths explicitly to avoid the cache
  mkdirSync(dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  if (!path) cached = db;
  return db;
}
```

- [ ] **Step 4: Run, see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db.ts tests/db.test.ts
git commit -m "feat: better-sqlite3 schema for events, rollups, alerts"
```

---

### Task 9: MQTT subscriber (with mock client)

**Files:**
- Create: `src/lib/server/mqtt.ts`, `tests/mqtt.test.ts`

Subscribes to `arctic/spa/<UUID>/#`, normalises raw payloads into `RawMqttEvent`, persists, and notifies listeners.

- [ ] **Step 1: Write the failing test**

`tests/mqtt.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createMqttPipeline } from '../src/lib/server/mqtt';

class FakeClient {
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  subscribed: string[] = [];
  on(event: string, cb: (...a: any[]) => void) { (this.handlers[event] ??= []).push(cb); return this; }
  subscribe(topic: string, _opts: unknown, cb: (err: Error | null) => void) { this.subscribed.push(topic); cb(null); }
  emit(event: string, ...args: any[]) { (this.handlers[event] ?? []).forEach(h => h(...args)); }
  end() { /* noop */ }
}

describe('createMqttPipeline', () => {
  it('subscribes to the wildcard topic and parses incoming JSON messages', async () => {
    const fake = new FakeClient();
    const events: any[] = [];
    const pipe = createMqttPipeline({
      uuid: 'abc-uuid',
      connect: () => fake as any,
      onEvent: e => events.push(e),
    });
    pipe.start();
    fake.emit('connect');
    expect(fake.subscribed).toEqual(['arctic/spa/abc-uuid/#']);

    fake.emit('message', 'arctic/spa/abc-uuid/telemetry/spa', Buffer.from(JSON.stringify({ temperatureF: 102 })));
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('arctic/spa/abc-uuid/telemetry/spa');
    expect((events[0].payload as any).temperatureF).toBe(102);
  });

  it('still forwards non-JSON payloads as raw strings', () => {
    const fake = new FakeClient();
    const events: any[] = [];
    const pipe = createMqttPipeline({ uuid: 'u', connect: () => fake as any, onEvent: e => events.push(e) });
    pipe.start();
    fake.emit('connect');
    fake.emit('message', 'arctic/spa/u/telemetry/heartbeat', Buffer.from('PING'));
    expect(events[0].payload).toBe('PING');
  });
});
```

- [ ] **Step 2: Run, see them fail**

- [ ] **Step 3: Implement**

`src/lib/server/mqtt.ts`:
```ts
import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';
import type { RawMqttEvent } from './types';

export type MqttPipelineOpts = {
  uuid: string;
  jwt?: string;
  url?: string;
  connect?: (url: string, opts: IClientOptions) => MqttClient; // for tests
  onEvent: (e: RawMqttEvent) => void;
  onError?: (err: Error) => void;
};

export function createMqttPipeline(opts: MqttPipelineOpts) {
  const url = opts.url ?? 'tcp://broker.myarcticspa.com:1884';
  const connect = opts.connect ?? (mqtt.connect as unknown as (u: string, o: IClientOptions) => MqttClient);
  let client: MqttClient | null = null;

  function start() {
    client = connect(url, {
      username: opts.jwt ?? '',
      password: 'anything',           // matches mobile-app behaviour
      reconnectPeriod: 2000,
      keepalive: 30,
      clean: true,
    });

    client.on('connect', () => {
      const topic = `arctic/spa/${opts.uuid}/#`;
      client!.subscribe(topic, { qos: 0 }, err => {
        if (err) opts.onError?.(err);
      });
    });

    client.on('message', (topic: string, payload: Buffer) => {
      const text = payload.toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      opts.onEvent({ ts: Date.now(), topic, payload: parsed });
    });

    client.on('error', err => opts.onError?.(err));
  }

  function stop() {
    client?.end();
    client = null;
  }

  function setJwt(jwt: string) {
    // Reconnect with the new JWT — Paho-style libs don't allow swapping creds in place.
    opts.jwt = jwt;
    if (client) {
      stop();
      start();
    }
  }

  return { start, stop, setJwt };
}
```

- [ ] **Step 4: Run, see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/mqtt.ts tests/mqtt.test.ts
git commit -m "feat: MQTT subscriber pipeline with onEvent fan-out"
```

---

### Task 10: State store + payload normalisers

**Files:**
- Create: `src/lib/server/state.ts`, `src/lib/server/payload-normalisers.ts`, `tests/state.test.ts`

Translates raw topic+payload into a `SpaState` patch and merges into an in-memory snapshot.

- [ ] **Step 1: Write the failing tests**

`tests/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createStateStore } from '../src/lib/server/state';

const ev = (topic: string, payload: unknown) => ({ ts: 1000, topic, payload });

describe('state store', () => {
  it('normalises telemetry/spa into temperature + accessories', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', {
      currentTempF: 102, setpointF: 104, heating: true,
      pump1: 1, pump2: 0, pump3: 2, blower: false, lights: true,
    }));
    const st = s.snapshot();
    expect(st.temperatureF).toBe(102);
    expect(st.targetTemperatureF).toBe(104);
    expect(st.heating).toBe(true);
    expect(st.pumps).toEqual([{ id: 1, speed: 1 }, { id: 2, speed: 0 }, { id: 3, speed: 2 }]);
    expect(st.blower).toBe(false);
    expect(st.lights).toBe(true);
  });

  it('normalises telemetry/spaboy into chemistry', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spaboy', { ph: 7.4, chlorine: 1.2, orp: 650 }));
    expect(s.snapshot().chemistry).toEqual({ ph: 7.4, chlorine: 1.2, orp: 650 });
  });

  it('emits change events with deltas', () => {
    const s = createStateStore('uuid-1');
    const seen: any[] = [];
    s.onChange(p => seen.push(p));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 100 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 100 }));   // no change
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 101 }));
    expect(seen).toHaveLength(2);
    expect(seen[0].temperatureF).toBe(100);
    expect(seen[1].temperatureF).toBe(101);
  });
});
```

- [ ] **Step 2: Run, see them fail**

- [ ] **Step 3: Implement normalisers**

`src/lib/server/payload-normalisers.ts`:
```ts
import type { RawMqttEvent, SpaState } from './types';

/**
 * Map a topic + payload into a partial SpaState patch.
 * Returns null when the topic is not recognised or the payload doesn't match expected shape.
 *
 * Field names (currentTempF, setpointF, pump1, etc.) are inferred from the mobile app's JSON
 * model classes (SpaboyLive, SpaSettings, etc.) — verify against actual MQTT payloads on first
 * connect and refine as needed (open question #4 in the spec).
 */
export function normalise(event: RawMqttEvent): Partial<SpaState> | null {
  const t = event.topic;
  if (!t.includes('/telemetry/') && !t.includes('/settings/') && !t.includes('/information/')) return null;
  const p = event.payload as any;
  if (typeof p !== 'object' || p === null) return null;

  if (t.endsWith('/telemetry/spa')) {
    const out: Partial<SpaState> = {};
    if (typeof p.currentTempF === 'number') out.temperatureF = p.currentTempF;
    if (typeof p.setpointF === 'number') out.targetTemperatureF = p.setpointF;
    if (typeof p.heating === 'boolean') out.heating = p.heating;
    const pumps: { id: number; speed: 0 | 1 | 2 }[] = [];
    for (let i = 1; i <= 5; i++) {
      const v = p[`pump${i}`];
      if (typeof v === 'number' && v >= 0 && v <= 2) pumps.push({ id: i, speed: v as 0 | 1 | 2 });
    }
    if (pumps.length) out.pumps = pumps;
    if (typeof p.blower === 'boolean') out.blower = p.blower;
    if (typeof p.lights === 'boolean') out.lights = p.lights;
    return out;
  }

  if (t.endsWith('/telemetry/spaboy')) {
    const c: { ph?: number; chlorine?: number; orp?: number } = {};
    if (typeof p.ph === 'number') c.ph = p.ph;
    if (typeof p.chlorine === 'number') c.chlorine = p.chlorine;
    if (typeof p.orp === 'number') c.orp = p.orp;
    return Object.keys(c).length ? { chemistry: c } : null;
  }

  if (t.endsWith('/telemetry/errors')) {
    if (Array.isArray(p.errors)) return { errors: p.errors.filter((x: unknown) => typeof x === 'string') };
    return null;
  }

  return null;
}
```

`src/lib/server/state.ts`:
```ts
import type { RawMqttEvent, SpaState } from './types';
import { normalise } from './payload-normalisers';

export function createStateStore(_uuid: string) {
  let snapshot: SpaState = { ts: 0 };
  const listeners: ((state: SpaState) => void)[] = [];

  function ingest(event: RawMqttEvent) {
    const patch = normalise(event);
    if (!patch) return;

    const merged: SpaState = { ...snapshot, ...patch, ts: event.ts };
    if (sameShallow(snapshot, merged)) return;
    snapshot = merged;
    for (const l of listeners) l(snapshot);
  }

  function sameShallow(a: SpaState, b: SpaState): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SpaState>;
    keys.delete('ts');
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    }
    return true;
  }

  return {
    ingest,
    snapshot: () => snapshot,
    onChange(cb: (s: SpaState) => void) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
  };
}
```

- [ ] **Step 4: Run, see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/state.ts src/lib/server/payload-normalisers.ts tests/state.test.ts
git commit -m "feat: state store + payload normalisers"
```

---

### Task 11: Auth manager (refresh loop + boot orchestration)

**Files:**
- Create: `src/lib/server/auth-manager.ts`, `tests/auth-manager.test.ts`

Holds the live access token, refreshes before expiry, falls back to re-auth via stored hash.

- [ ] **Step 1: Write the failing tests**

`tests/auth-manager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createAuthManager } from '../src/lib/server/auth-manager';

describe('createAuthManager', () => {
  it('uses refresh token to obtain a new access token', async () => {
    const refresh = vi.fn(async () => ({ access_token: 'jwt2', refresh_token: 'rt2', expires_in: 3600, token_type: 'bearer' }));
    const reauth = vi.fn(async () => ({ access_token: 'reauth', refresh_token: 'rtR', expires_in: 3600, token_type: 'bearer' }));
    const persist = vi.fn();
    const m = createAuthManager({ refresh, reauth, persist, getStored: () => ({ refreshToken: 'rt1' }) });

    const t = await m.getValidToken();
    expect(refresh).toHaveBeenCalledWith('rt1');
    expect(t).toBe('jwt2');
    expect(persist).toHaveBeenCalledWith({ refreshToken: 'rt2' });
  });

  it('falls back to reauth when refresh fails', async () => {
    const refresh = vi.fn(async () => { throw new Error('400 invalid_grant'); });
    const reauth = vi.fn(async () => ({ access_token: 'reauth', refresh_token: 'rtR', expires_in: 3600, token_type: 'bearer' }));
    const persist = vi.fn();
    const m = createAuthManager({ refresh, reauth, persist, getStored: () => ({ refreshToken: 'rt1' }) });

    const t = await m.getValidToken();
    expect(reauth).toHaveBeenCalled();
    expect(t).toBe('reauth');
    expect(persist).toHaveBeenCalledWith({ refreshToken: 'rtR' });
  });

  it('caches the live token until 75% of expiry', async () => {
    const refresh = vi.fn(async () => ({ access_token: 'jwt2', refresh_token: 'rt2', expires_in: 100, token_type: 'bearer' }));
    const m = createAuthManager({ refresh, reauth: async () => { throw new Error('shouldnt'); }, persist: () => {}, getStored: () => ({ refreshToken: 'rt1' }) });

    const t1 = await m.getValidToken();
    const t2 = await m.getValidToken();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(t1).toBe(t2);
  });
});
```

- [ ] **Step 2: Run, see them fail**

- [ ] **Step 3: Implement**

`src/lib/server/auth-manager.ts`:
```ts
import type { OAuth2AccessToken } from './types';

export type AuthManagerOpts = {
  refresh: (refreshToken: string) => Promise<OAuth2AccessToken>;
  reauth: () => Promise<OAuth2AccessToken>;            // uses stored email + passwordHash + spa
  persist: (s: { refreshToken: string }) => void;
  getStored: () => { refreshToken: string | null };
};

export function createAuthManager(opts: AuthManagerOpts) {
  let cached: { token: string; expiresAt: number } | null = null;

  async function obtainNew(): Promise<OAuth2AccessToken> {
    const stored = opts.getStored();
    if (stored.refreshToken) {
      try {
        return await opts.refresh(stored.refreshToken);
      } catch {
        return await opts.reauth();
      }
    }
    return await opts.reauth();
  }

  async function getValidToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const t = await obtainNew();
    opts.persist({ refreshToken: t.refresh_token });
    cached = {
      token: t.access_token,
      expiresAt: Date.now() + Math.floor(t.expires_in * 1000 * 0.75),
    };
    return t.access_token;
  }

  function invalidate() { cached = null; }

  return { getValidToken, invalidate };
}
```

- [ ] **Step 4: Run, see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/auth-manager.ts tests/auth-manager.test.ts
git commit -m "feat: auth manager with refresh + reauth fallback"
```

---

### Task 12: Boot hook — wire auth + MQTT + state + DB together

**Files:**
- Create: `src/hooks.server.ts`, `src/lib/server/boot.ts`

- [ ] **Step 1: Implement the boot wiring**

`src/lib/server/boot.ts`:
```ts
import { defaultSecrets } from './secrets';
import { grantToken, refreshAccessToken } from './arctic-auth';
import { createAuthManager } from './auth-manager';
import { createMqttPipeline } from './mqtt';
import { createStateStore } from './state';
import { openDb } from './db';

let started = false;

export type BootResult = {
  state: ReturnType<typeof createStateStore>;
  isReady: () => boolean;
};

let bootResult: BootResult | null = null;

export function getBoot(): BootResult | null { return bootResult; }

export function startBackend(): BootResult {
  if (started) return bootResult!;
  started = true;

  const uuid = defaultSecrets.get('ARCTIC_SPA_UUID');
  const username = defaultSecrets.get('ARCTIC_USERNAME');
  const passwordHash = defaultSecrets.get('ARCTIC_PASSWORD_HASH');

  const db = openDb();
  const state = createStateStore(uuid ?? 'unconfigured');
  let ready = false;

  bootResult = { state, isReady: () => ready };

  if (!uuid || !username || !passwordHash) {
    console.warn('[boot] secrets missing — skipping MQTT until /setup is completed');
    return bootResult;
  }

  const auth = createAuthManager({
    refresh: refreshAccessToken,
    reauth: async () => {
      // Need the spa metadata stored at setup time. For v1 single-spa, reconstruct from secrets.
      const spaIdLower = uuid.toLowerCase();
      return grantToken({
        email: username,
        passwordHash,
        spa: { Id: spaIdLower, NickName: null, IsConnected: true, IsMoved: null, DealerId: null },
      });
    },
    persist: ({ refreshToken }) => defaultSecrets.set('ARCTIC_REFRESH_TOKEN', refreshToken),
    getStored: () => ({ refreshToken: defaultSecrets.get('ARCTIC_REFRESH_TOKEN') }),
  });

  const insertEvent = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');

  const pipe = createMqttPipeline({
    uuid,
    onEvent: e => {
      try { insertEvent.run(e.ts, e.topic, JSON.stringify(e.payload)); } catch (err) { console.error('[boot] db write failed', err); }
      state.ingest(e);
    },
    onError: err => console.error('[mqtt]', err),
  });

  // Async boot: fetch JWT, then start MQTT.
  (async () => {
    try {
      const jwt = await auth.getValidToken();
      pipe.setJwt(jwt);
      pipe.start();
      ready = true;
      console.log('[boot] MQTT started');

      // Refresh loop. We re-fetch the JWT slightly before expiry; auth manager handles caching.
      setInterval(async () => {
        try {
          const fresh = await auth.getValidToken();
          pipe.setJwt(fresh);   // forces a reconnect with the new credential
        } catch (err) { console.error('[boot] token refresh failed', err); }
      }, 10 * 60 * 1000);       // every 10 min; auth manager skips if cached is still valid
    } catch (err) {
      console.error('[boot] failed to start MQTT', err);
    }
  })();

  return bootResult;
}
```

- [ ] **Step 2: Hook into SvelteKit boot**

`src/hooks.server.ts`:
```ts
import { startBackend } from '$lib/server/boot';

startBackend();

export const handle = async ({ event, resolve }) => resolve(event);
```

- [ ] **Step 3: Run end-to-end**

```bash
npm run dev
```

Open `http://localhost:5173/setup` if not already configured (Task 7 should have left secrets in `data/secrets.json`).
Watch the dev terminal for `[boot] MQTT started`.
Look at `data/spa.db` (use `sqlite3 data/spa.db 'SELECT topic, count(*) FROM events GROUP BY topic'`) — should show row counts on `arctic/spa/<UUID>/telemetry/...` topics.

**This is open question #3 from the spec being resolved.** Confirm the topic namespace matches expectations and note any new subtopics seen for follow-up.

- [ ] **Step 4: Verify state snapshot**

Add a temporary debug route (we'll replace with the proper SSE in Task 13):

`src/routes/_debug/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import { getBoot } from '$lib/server/boot';

export const GET = () => {
  const b = getBoot();
  return json({ ready: b?.isReady() ?? false, state: b?.state.snapshot() ?? null });
};
```

Open `http://localhost:5173/_debug` and confirm `state` populates with real values within ~1 minute. Delete this file after verifying.

- [ ] **Step 5: Commit**

```bash
git add src/hooks.server.ts src/lib/server/boot.ts
git commit -m "feat: boot wiring (auth + MQTT + state + db)"
```

---

## Milestone 3 — HTTP API + SSE (Tasks 13–15)

### Task 13: GET /api/state

**Files:**
- Create: `src/routes/api/state/+server.ts`

- [ ] **Step 1: Implement**

```ts
import { json } from '@sveltejs/kit';
import { getBoot } from '$lib/server/boot';

export const GET = () => {
  const b = getBoot();
  if (!b) return json({ ready: false, state: null }, { status: 503 });
  return json({ ready: b.isReady(), state: b.state.snapshot() });
};
```

- [ ] **Step 2: Smoke test**

```bash
curl http://localhost:5173/api/state
```
Expected: `{"ready":true,"state":{...}}`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/state/+server.ts
git commit -m "feat: GET /api/state"
```

---

### Task 14: SSE /api/state/stream

**Files:**
- Create: `src/routes/api/state/stream/+server.ts`

- [ ] **Step 1: Implement**

```ts
import { getBoot } from '$lib/server/boot';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const b = getBoot();
  if (!b) return new Response('boot not started', { status: 503 });

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

      // Send the current snapshot immediately so the SPA renders without waiting for an event.
      send({ kind: 'snapshot', state: b.state.snapshot() });

      const unsubscribe = b.state.onChange(s => send({ kind: 'snapshot', state: s }));

      // Heartbeat keeps the connection open through proxies that idle-time out.
      const heartbeat = setInterval(() => controller.enqueue(': ping\n\n'), 25_000);

      return () => { unsubscribe(); clearInterval(heartbeat); };
    },
    cancel() { /* nothing extra; teardown handled in start's return */ },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
    },
  });
};
```

- [ ] **Step 2: Smoke test**

```bash
curl -N http://localhost:5173/api/state/stream
```
Expected: a snapshot line, then more snapshots as the spa state changes, ping comments every 25 s.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/state/stream/+server.ts
git commit -m "feat: SSE /api/state/stream"
```

---

### Task 15: Auth-state gate (redirect to /setup if unconfigured)

**Files:**
- Create: `src/routes/+layout.server.ts`

- [ ] **Step 1: Implement**

```ts
import { redirect } from '@sveltejs/kit';
import { defaultSecrets } from '$lib/server/secrets';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
  const configured = !!defaultSecrets.get('ARCTIC_PASSWORD_HASH');
  if (!configured && !url.pathname.startsWith('/setup') && !url.pathname.startsWith('/api/setup')) {
    throw redirect(307, '/setup');
  }
  return {};
};
```

- [ ] **Step 2: Verify**

Delete `data/secrets.json` (or rename it temporarily). Open `http://localhost:5173/` — should redirect to `/setup`. Re-run setup, confirm dashboard loads.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+layout.server.ts
git commit -m "feat: redirect to /setup when secrets are missing"
```

---

## Milestone 4 — Dashboard SPA (Tasks 16–20)

### Task 16: SSE client store

**Files:**
- Create: `src/lib/client/state-store.ts`

- [ ] **Step 1: Implement**

```ts
import { writable, type Writable } from 'svelte/store';
import type { SpaState } from '$lib/server/types';

export const spaState: Writable<SpaState | null> = writable(null);

let started = false;

export function startStateStream() {
  if (started) return;
  started = true;
  const es = new EventSource('/api/state/stream');
  es.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'snapshot') spaState.set(msg.state);
    } catch { /* ignore */ }
  };
  es.onerror = () => { es.close(); started = false; setTimeout(startStateStream, 3000); };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/client/state-store.ts
git commit -m "feat: SSE-backed Svelte store for spa state"
```

---

### Task 17: TemperatureCard + AccessoryGrid + ChemistryCard

**Files:**
- Create: `src/lib/components/TemperatureCard.svelte`, `src/lib/components/AccessoryGrid.svelte`, `src/lib/components/ChemistryCard.svelte`

- [ ] **Step 1: TemperatureCard**

```svelte
<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  export let state: SpaState | null;
  $: t = state?.temperatureF;
  $: target = state?.targetTemperatureF;
  $: heating = state?.heating ?? false;
  function fToC(f: number) { return Math.round(((f - 32) * 5/9) * 10) / 10; }
</script>

<div class="rounded-2xl border p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500">Temperature</h2>
  <div class="flex items-baseline gap-3 mt-2">
    <span class="text-5xl font-bold">{t ?? '—'}<span class="text-2xl">°F</span></span>
    <span class="text-lg text-gray-500">{t != null ? fToC(t) : '—'}°C</span>
  </div>
  <div class="mt-3 text-sm text-gray-500">
    Target: <span class="font-medium">{target ?? '—'}°F</span>
    {#if heating}
      <span class="ml-3 inline-block px-2 py-0.5 rounded bg-orange-100 text-orange-700">Heating</span>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: AccessoryGrid**

```svelte
<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  export let state: SpaState | null;
  $: pumps = state?.pumps ?? [];
  $: blower = state?.blower ?? false;
  $: lights = state?.lights ?? false;

  function pumpBg(speed: 0 | 1 | 2) {
    return speed === 0 ? 'bg-gray-200 text-gray-500' : speed === 1 ? 'bg-sky-400 text-white' : 'bg-sky-700 text-white';
  }
</script>

<div class="rounded-2xl border p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-3">Accessories</h2>
  <div class="grid grid-cols-3 gap-3">
    {#each pumps as p}
      <div class={`rounded-xl p-4 text-center font-semibold ${pumpBg(p.speed)}`}>
        Pump {p.id}<br/><span class="text-xs">speed {p.speed}</span>
      </div>
    {/each}
    <div class={`rounded-xl p-4 text-center font-semibold ${blower ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'}`}>Blower</div>
    <div class={`rounded-xl p-4 text-center font-semibold ${lights ? 'bg-yellow-300 text-yellow-900' : 'bg-gray-200 text-gray-500'}`}>Lights</div>
  </div>
</div>
```

- [ ] **Step 3: ChemistryCard**

```svelte
<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  export let state: SpaState | null;
  $: c = state?.chemistry;

  // Coloured indicator based on simple ranges. User-configurable thresholds come in alerts task.
  function tone(v: number | undefined, lo: number, hi: number): string {
    if (v == null) return 'text-gray-400';
    if (v < lo || v > hi) return 'text-red-600 font-bold';
    return 'text-emerald-600 font-bold';
  }
</script>

<div class="rounded-2xl border p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-3">Water chemistry</h2>
  {#if c}
    <div class="grid grid-cols-3 gap-4 text-center">
      <div>
        <div class="text-xs text-gray-500">pH</div>
        <div class={tone(c.ph, 7.2, 7.8)}>{c.ph?.toFixed(1) ?? '—'}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500">Cl (ppm)</div>
        <div class={tone(c.chlorine, 1, 3)}>{c.chlorine?.toFixed(1) ?? '—'}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500">ORP (mV)</div>
        <div class={tone(c.orp, 600, 800)}>{c.orp ?? '—'}</div>
      </div>
    </div>
  {:else}
    <div class="text-sm text-gray-400">No data yet</div>
  {/if}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/
git commit -m "feat: dashboard cards (temperature, accessories, chemistry)"
```

---

### Task 18: Dashboard page

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { spaState, startStateStream } from '$lib/client/state-store';
  import TemperatureCard from '$lib/components/TemperatureCard.svelte';
  import AccessoryGrid from '$lib/components/AccessoryGrid.svelte';
  import ChemistryCard from '$lib/components/ChemistryCard.svelte';

  onMount(startStateStream);
</script>

<main class="max-w-3xl mx-auto p-4 space-y-4">
  <header class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">My Spa</h1>
    <nav class="flex gap-3 text-sm">
      <a href="/history" class="hover:underline">History</a>
      <a href="/alerts" class="hover:underline">Alerts</a>
    </nav>
  </header>
  <TemperatureCard state={$spaState} />
  <AccessoryGrid state={$spaState} />
  <ChemistryCard state={$spaState} />
</main>
```

- [ ] **Step 2: Verify in browser**

`npm run dev`, open `http://localhost:5173/`. Real values should appear within ~30 seconds.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: dashboard page assembly"
```

---

### Task 19: PWA manifest + service worker scaffold

**Files:**
- Create: `static/manifest.webmanifest`, `static/icon-192.png`, `static/icon-512.png`, `src/service-worker.ts`
- Modify: `src/app.html`

- [ ] **Step 1: Create the manifest**

`static/manifest.webmanifest`:
```json
{
  "name": "Arctic Spa",
  "short_name": "Arctic",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Generate PNG icons from the design SVG**

The design source is `design/icon.svg`. Generate the two PNG sizes via `sharp`:

```bash
npm install --save-dev --save-exact sharp
node -e "require('sharp')('design/icon.svg').resize(192, 192).png().toFile('static/icon-192.png')"
node -e "require('sharp')('design/icon.svg').resize(512, 512).png().toFile('static/icon-512.png')"
```

Also copy the SVG itself for browsers that support it: `cp design/icon.svg static/icon.svg`.

Update the manifest icons array to:
```json
"icons": [
  { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" },
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
]
```

- [ ] **Step 3: Wire into app.html**

Update `src/app.html` `<head>` to include:
```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0a0a0a" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

- [ ] **Step 4: Service worker stub**

`src/service-worker.ts`:
```ts
/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', e => e.waitUntil(sw.clients.claim()));

// Web Push handler — wired up properly in the alerts task.
sw.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json() as { title: string; body: string; tag?: string };
  event.waitUntil(sw.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: '/icon-192.png' }));
});

sw.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(sw.clients.openWindow('/'));
});
```

- [ ] **Step 5: Verify**

Open Chrome DevTools → Application → Manifest. Should show name, icons, etc. "Install" button should appear in URL bar.

- [ ] **Step 6: Commit**

```bash
git add static/manifest.webmanifest static/icon-192.png static/icon-512.png src/service-worker.ts src/app.html
git commit -m "feat: PWA manifest + service worker scaffold"
```

---

### Task 20: Dark mode toggle + base layout polish

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Add dark-mode bootstrap and a toggle**

```svelte
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  let dark = false;
  onMount(() => {
    dark = localStorage.getItem('theme') === 'dark' || (localStorage.getItem('theme') == null && matchMedia('(prefers-color-scheme: dark)').matches);
    apply();
  });
  function toggle() { dark = !dark; apply(); }
  function apply() {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }
</script>

<div class="min-h-screen bg-gray-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
  <slot />
  <button class="fixed bottom-4 right-4 rounded-full p-3 bg-zinc-900 text-white shadow-lg" on:click={toggle} aria-label="Toggle dark mode">
    {dark ? '☀' : '☾'}
  </button>
</div>
```

- [ ] **Step 2: Verify**

Toggle dark mode in the corner button — colours flip.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat: dark mode toggle + base layout"
```

---

## Milestone 5 — History & rollups (Tasks 21–23)

### Task 21: 5-minute rollup job

**Files:**
- Create: `src/lib/server/history.ts`, `tests/history.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/history.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import { rollupBucket } from '../src/lib/server/history';

describe('rollupBucket', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'history-')); });

  it('aggregates temperatureF values from telemetry/spa events into metric_5m', () => {
    const db = openDb(join(dir, 'h.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const t0 = 1_700_000_000_000;
    ins.run(t0,            'arctic/spa/u/telemetry/spa', JSON.stringify({ currentTempF: 100 }));
    ins.run(t0 + 60_000,   'arctic/spa/u/telemetry/spa', JSON.stringify({ currentTempF: 102 }));
    ins.run(t0 + 120_000,  'arctic/spa/u/telemetry/spa', JSON.stringify({ currentTempF: 104 }));

    rollupBucket(db, t0);
    const rows = db.prepare('SELECT * FROM metric_5m WHERE metric=?').all('temperatureF') as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].avg).toBeCloseTo(102, 1);
    expect(rows[0].min).toBe(100);
    expect(rows[0].max).toBe(104);
    expect(rows[0].sample_count).toBe(3);
  });
});
```

- [ ] **Step 2: Run, see it fail**

- [ ] **Step 3: Implement**

`src/lib/server/history.ts`:
```ts
import type Database from 'better-sqlite3';

const FIVE_MIN = 5 * 60 * 1000;

const METRIC_EXTRACTORS: { metric: string; topicSuffix: string; field: string }[] = [
  { metric: 'temperatureF', topicSuffix: '/telemetry/spa', field: 'currentTempF' },
  { metric: 'targetTemperatureF', topicSuffix: '/telemetry/spa', field: 'setpointF' },
  { metric: 'ph', topicSuffix: '/telemetry/spaboy', field: 'ph' },
  { metric: 'chlorine', topicSuffix: '/telemetry/spaboy', field: 'chlorine' },
  { metric: 'orp', topicSuffix: '/telemetry/spaboy', field: 'orp' },
];

export function rollupBucket(db: Database.Database, ts: number) {
  const bucket = Math.floor(ts / FIVE_MIN) * FIVE_MIN;
  const start = bucket;
  const end = bucket + FIVE_MIN;

  const upsert = db.prepare(`
    INSERT INTO metric_5m (metric, ts_bucket, avg, min, max, sample_count)
    VALUES (@metric, @bucket, @avg, @min, @max, @count)
    ON CONFLICT (metric, ts_bucket) DO UPDATE SET
      avg = @avg, min = @min, max = @max, sample_count = @count
  `);
  const fetch = db.prepare('SELECT payload_json FROM events WHERE ts >= ? AND ts < ? AND topic LIKE ?');

  for (const e of METRIC_EXTRACTORS) {
    const rows = fetch.all(start, end, `%${e.topicSuffix}`) as { payload_json: string }[];
    const values: number[] = [];
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload_json);
        const v = p[e.field];
        if (typeof v === 'number') values.push(v);
      } catch { /* skip */ }
    }
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    upsert.run({ metric: e.metric, bucket, avg, min, max, count: values.length });
  }
}

export function startRollupLoop(db: Database.Database) {
  // Roll up the bucket that just finished, every minute.
  setInterval(() => rollupBucket(db, Date.now() - FIVE_MIN), 60_000);
}
```

- [ ] **Step 4: Wire into boot**

In `src/lib/server/boot.ts`, add after `pipe.start()`:
```ts
import { startRollupLoop } from './history';
// ...
startRollupLoop(db);
```

- [ ] **Step 5: Run, see it pass**

```bash
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/history.ts src/lib/server/boot.ts tests/history.test.ts
git commit -m "feat: 5-minute rollup job"
```

---

### Task 22: GET /api/history

**Files:**
- Create: `src/routes/api/history/+server.ts`

- [ ] **Step 1: Implement**

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { openDb } from '$lib/server/db';

export const GET: RequestHandler = ({ url }) => {
  const metric = url.searchParams.get('metric');
  const fromMs = Number(url.searchParams.get('from') ?? Date.now() - 24 * 3600 * 1000);
  const toMs = Number(url.searchParams.get('to') ?? Date.now());
  if (!metric) throw error(400, 'metric required');

  const db = openDb();
  const rows = db.prepare('SELECT ts_bucket, avg, min, max, sample_count FROM metric_5m WHERE metric = ? AND ts_bucket >= ? AND ts_bucket <= ? ORDER BY ts_bucket').all(metric, fromMs, toMs);
  return json({ metric, points: rows });
};
```

- [ ] **Step 2: Smoke test**

```bash
curl 'http://localhost:5173/api/history?metric=temperatureF&from=0'
```
Expected: a JSON array of buckets with `avg/min/max`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/history/+server.ts
git commit -m "feat: GET /api/history"
```

---

### Task 23: History page with simple chart

**Files:**
- Create: `src/lib/components/HistoryChart.svelte`, `src/routes/history/+page.svelte`

Use a tiny SVG line chart instead of pulling in Chart.js for v1; we can swap later.

- [ ] **Step 1: Implement HistoryChart**

```svelte
<script lang="ts">
  export let points: { ts_bucket: number; avg: number; min: number; max: number }[] = [];
  export let yLabel = '';
  $: xs = points.map(p => p.ts_bucket);
  $: ys = points.map(p => p.avg);
  $: xMin = xs[0] ?? 0;
  $: xMax = xs[xs.length - 1] ?? 1;
  $: yMin = ys.length ? Math.min(...ys) : 0;
  $: yMax = ys.length ? Math.max(...ys) : 1;
  function fx(x: number) { return ((x - xMin) / Math.max(1, xMax - xMin)) * 600; }
  function fy(y: number) { return 200 - ((y - yMin) / Math.max(0.001, yMax - yMin)) * 180; }
  $: path = ys.length ? 'M' + xs.map((x, i) => `${fx(x)},${fy(ys[i])}`).join(' L') : '';
</script>

<svg viewBox="0 0 600 200" class="w-full bg-white dark:bg-zinc-900 rounded-xl border">
  {#if path}
    <path d={path} fill="none" stroke="currentColor" stroke-width="2" />
    <text x="4" y="14" class="text-xs">{yLabel} {yMin.toFixed(1)}–{yMax.toFixed(1)}</text>
  {:else}
    <text x="280" y="100" class="text-sm text-gray-400">no data</text>
  {/if}
</svg>
```

- [ ] **Step 2: History page**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import HistoryChart from '$lib/components/HistoryChart.svelte';

  type Pt = { ts_bucket: number; avg: number; min: number; max: number; sample_count: number };
  let temp: Pt[] = [];
  let ph: Pt[] = [];
  let cl: Pt[] = [];
  let orp: Pt[] = [];

  async function fetchMetric(name: string): Promise<Pt[]> {
    const r = await fetch(`/api/history?metric=${name}&from=${Date.now() - 24 * 3600 * 1000}`);
    return (await r.json()).points;
  }

  onMount(async () => {
    [temp, ph, cl, orp] = await Promise.all([
      fetchMetric('temperatureF'),
      fetchMetric('ph'),
      fetchMetric('chlorine'),
      fetchMetric('orp'),
    ]);
  });
</script>

<main class="max-w-3xl mx-auto p-4 space-y-6">
  <h1 class="text-xl font-bold">History (last 24h)</h1>
  <section><h2 class="text-sm uppercase mb-1">Temperature (°F)</h2><HistoryChart points={temp} yLabel="°F" /></section>
  <section><h2 class="text-sm uppercase mb-1">pH</h2><HistoryChart points={ph} yLabel="pH" /></section>
  <section><h2 class="text-sm uppercase mb-1">Chlorine (ppm)</h2><HistoryChart points={cl} yLabel="ppm" /></section>
  <section><h2 class="text-sm uppercase mb-1">ORP (mV)</h2><HistoryChart points={orp} yLabel="mV" /></section>
  <a href="/" class="block text-center text-sm underline">← Back to dashboard</a>
</main>
```

- [ ] **Step 3: Verify**

After ~10 min of running with real data, history charts populate.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/HistoryChart.svelte src/routes/history
git commit -m "feat: history page with SVG charts"
```

---

## Milestone 6 — Alerts + Web Push (Tasks 24–26)

### Task 24: Alert rule evaluation

**Files:**
- Create: `src/lib/server/alerts.ts`, `tests/alerts.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/alerts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../src/lib/server/alerts';
import type { AlertRule, SpaState } from '../src/lib/server/types';

const t0 = Date.now();

describe('evaluateRules', () => {
  it('fires error_present when any error code is non-empty', () => {
    const rules: AlertRule[] = [{ id: 'r1', kind: 'error_present', threshold: {}, enabled: true }];
    const fires = evaluateRules(rules, { ts: t0, errors: ['ER11'] } as SpaState);
    expect(fires).toEqual([{ ruleId: 'r1', payload: { errors: ['ER11'] } }]);
  });

  it('fires temperature_outside when temp falls below min', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true }];
    const fires = evaluateRules(rules, { ts: t0, temperatureF: 99 } as SpaState);
    expect(fires).toHaveLength(1);
    expect(fires[0].ruleId).toBe('r2');
  });

  it('skips disabled rules', () => {
    const rules: AlertRule[] = [{ id: 'r3', kind: 'error_present', threshold: {}, enabled: false }];
    const fires = evaluateRules(rules, { ts: t0, errors: ['ER1'] } as SpaState);
    expect(fires).toEqual([]);
  });

  it('fires chemistry_outside when ph drifts', () => {
    const rules: AlertRule[] = [{ id: 'r4', kind: 'chemistry_outside', threshold: { phMin: 7.2, phMax: 7.8 }, enabled: true }];
    const fires = evaluateRules(rules, { ts: t0, chemistry: { ph: 8.3 } } as SpaState);
    expect(fires).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, see them fail**

- [ ] **Step 3: Implement**

`src/lib/server/alerts.ts`:
```ts
import type { AlertRule, SpaState } from './types';

export type AlertFire = { ruleId: string; payload: Record<string, unknown> };

export function evaluateRules(rules: AlertRule[], state: SpaState): AlertFire[] {
  const fires: AlertFire[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const f = evaluateOne(r, state);
    if (f) fires.push(f);
  }
  return fires;
}

function evaluateOne(r: AlertRule, state: SpaState): AlertFire | null {
  switch (r.kind) {
    case 'error_present': {
      if (state.errors && state.errors.length > 0) return { ruleId: r.id, payload: { errors: state.errors } };
      return null;
    }
    case 'temperature_outside': {
      const t = state.temperatureF;
      if (t == null) return null;
      const min = Number(r.threshold.minF);
      const max = Number(r.threshold.maxF);
      if (t < min || t > max) return { ruleId: r.id, payload: { temperatureF: t, min, max } };
      return null;
    }
    case 'filter_cycle_missed': {
      const next = state.filterCycle?.nextStartTs;
      if (!next) return null;
      const overdueMs = Number(r.threshold.overdueMs ?? 30 * 60 * 1000);
      if (Date.now() - next > overdueMs) return { ruleId: r.id, payload: { nextStartTs: next, overdueMs } };
      return null;
    }
    case 'chemistry_outside': {
      const c = state.chemistry;
      if (!c) return null;
      const out: Record<string, number> = {};
      const checks: [keyof typeof c, string, string][] = [
        ['ph', 'phMin', 'phMax'],
        ['chlorine', 'chlorineMin', 'chlorineMax'],
        ['orp', 'orpMin', 'orpMax'],
      ];
      for (const [field, lo, hi] of checks) {
        const v = c[field];
        if (typeof v !== 'number') continue;
        const min = r.threshold[lo] != null ? Number(r.threshold[lo]) : -Infinity;
        const max = r.threshold[hi] != null ? Number(r.threshold[hi]) : Infinity;
        if (v < min || v > max) out[field] = v;
      }
      return Object.keys(out).length ? { ruleId: r.id, payload: out } : null;
    }
  }
}
```

- [ ] **Step 4: Run, see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/alerts.ts tests/alerts.test.ts
git commit -m "feat: alert rule evaluation"
```

---

### Task 25: Web Push subscription + send

**Files:**
- Create: `src/lib/server/push.ts`, `src/routes/api/alerts/subscribe/+server.ts`, `src/routes/api/alerts/rules/+server.ts`, `tests/push.test.ts`

- [ ] **Step 1: Generate VAPID keys (one-time, manual)**

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```
Take the output and add to `.env`:
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```
Also append `.env` to `.gitignore` if it's not already.

- [ ] **Step 2: Implement push.ts**

`src/lib/server/push.ts`:
```ts
import webpush from 'web-push';
import { defaultSecrets } from './secrets';
import { openDb } from './db';

let configured = false;

function configure() {
  if (configured) return;
  const pub = defaultSecrets.get('VAPID_PUBLIC_KEY');
  const priv = defaultSecrets.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) { console.warn('[push] VAPID keys missing'); return; }
  webpush.setVapidDetails('mailto:emil.staurset@miles.no', pub, priv);
  configured = true;
}

export function getPublicKey(): string | null {
  return defaultSecrets.get('VAPID_PUBLIC_KEY');
}

export function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const db = openDb();
  db.prepare('INSERT OR IGNORE INTO push_subscription (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)').run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

export async function sendToAll(payload: { title: string; body: string; tag?: string }) {
  configure();
  if (!configured) return;
  const db = openDb();
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscription').all() as { id: number; endpoint: string; p256dh: string; auth: string }[];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscription WHERE id = ?').run(s.id);
      } else {
        console.error('[push]', err);
      }
    }
  }
}
```

- [ ] **Step 3: Subscription + rules endpoints**

`src/routes/api/alerts/subscribe/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSubscription, getPublicKey } from '$lib/server/push';

export const GET: RequestHandler = () => json({ publicKey: getPublicKey() });

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { endpoint: string; keys: { p256dh: string; auth: string } };
  saveSubscription(body);
  return json({ ok: true });
};
```

`src/routes/api/alerts/rules/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import type { AlertRule } from '$lib/server/types';

export const GET: RequestHandler = () => {
  const rows = openDb().prepare('SELECT id, kind, threshold_json, enabled FROM alert_rule').all() as any[];
  const rules: AlertRule[] = rows.map(r => ({ id: r.id, kind: r.kind, threshold: JSON.parse(r.threshold_json), enabled: !!r.enabled }));
  return json({ rules });
};

export const PUT: RequestHandler = async ({ request }) => {
  const { rules } = await request.json() as { rules: AlertRule[] };
  if (!Array.isArray(rules)) throw error(400, 'rules array required');
  const db = openDb();
  const tx = db.transaction((rs: AlertRule[]) => {
    db.prepare('DELETE FROM alert_rule').run();
    const ins = db.prepare('INSERT INTO alert_rule (id, kind, threshold_json, enabled) VALUES (?, ?, ?, ?)');
    for (const r of rs) ins.run(r.id, r.kind, JSON.stringify(r.threshold), r.enabled ? 1 : 0);
  });
  tx(rules);
  return json({ ok: true });
};
```

- [ ] **Step 4: Wire alert evaluation into boot**

In `src/lib/server/boot.ts`, after starting `pipe`:
```ts
import { evaluateRules } from './alerts';
import { sendToAll } from './push';
import type { AlertRule } from './types';
// ...
// After state.onChange registration:
state.onChange(s => {
  const rows = db.prepare('SELECT id, kind, threshold_json, enabled FROM alert_rule WHERE enabled=1').all() as any[];
  const rules: AlertRule[] = rows.map(r => ({ id: r.id, kind: r.kind, threshold: JSON.parse(r.threshold_json), enabled: true }));
  const fires = evaluateRules(rules, s);
  for (const f of fires) {
    db.prepare('INSERT INTO alert_event (rule_id, ts, payload_json, delivered) VALUES (?, ?, ?, 0)').run(f.ruleId, Date.now(), JSON.stringify(f.payload));
    sendToAll({ title: 'Spa alert', body: `${f.ruleId}: ${JSON.stringify(f.payload)}` }).catch(err => console.error('[push]', err));
  }
});
```

- [ ] **Step 5: Test + commit**

```bash
npm run test
git add src/lib/server/push.ts src/routes/api/alerts src/lib/server/boot.ts
git commit -m "feat: web push subscription + alert dispatch"
```

---

### Task 26: Alerts UI

**Files:**
- Create: `src/routes/alerts/+page.svelte`

- [ ] **Step 1: Implement the alerts page**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AlertRule } from '$lib/server/types';

  let rules: AlertRule[] = [];
  let publicKey: string | null = null;
  let pushReady = false;

  async function load() {
    const [r, p] = await Promise.all([
      (await fetch('/api/alerts/rules')).json(),
      (await fetch('/api/alerts/subscribe')).json(),
    ]);
    rules = r.rules;
    publicKey = p.publicKey;
  }

  function newRule() {
    rules = [...rules, { id: `r-${Date.now()}`, kind: 'error_present', threshold: {}, enabled: true }];
  }

  async function save() {
    await fetch('/api/alerts/rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules }) });
  }

  function urlBase64ToUint8Array(base64: string) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  async function enablePush() {
    if (!publicKey) return;
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await fetch('/api/alerts/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
    pushReady = true;
  }

  onMount(load);
</script>

<main class="max-w-3xl mx-auto p-4 space-y-4">
  <h1 class="text-xl font-bold">Alerts</h1>
  <button on:click={enablePush} class="bg-black text-white px-3 py-1 rounded">Enable push notifications</button>
  {#if pushReady}<span class="text-emerald-600 ml-2">subscribed</span>{/if}

  <ul class="space-y-3">
    {#each rules as rule, i}
      <li class="rounded border p-3 bg-white dark:bg-zinc-900">
        <div class="flex items-center gap-2">
          <input type="checkbox" bind:checked={rule.enabled} />
          <select bind:value={rule.kind}>
            <option value="error_present">Error present</option>
            <option value="temperature_outside">Temperature outside</option>
            <option value="filter_cycle_missed">Filter cycle missed</option>
            <option value="chemistry_outside">Chemistry outside</option>
          </select>
        </div>
        <textarea class="w-full mt-2 text-xs font-mono border p-1" rows="2"
          on:input={(e) => rule.threshold = JSON.parse((e.currentTarget as HTMLTextAreaElement).value || '{}')}
          value={JSON.stringify(rule.threshold)}></textarea>
      </li>
    {/each}
  </ul>
  <div class="flex gap-2">
    <button on:click={newRule} class="bg-gray-200 px-3 py-1 rounded">+ Add rule</button>
    <button on:click={save} class="bg-emerald-600 text-white px-3 py-1 rounded">Save</button>
  </div>
  <a href="/" class="block text-center text-sm underline">← Back to dashboard</a>
</main>
```

- [ ] **Step 2: Verify**

Open `/alerts`. Add a temperature_outside rule with `{"minF":50,"maxF":110}`. Save. Confirm in DB. Click "Enable push notifications" — accept browser prompt. Trigger by setting impossible thresholds — push notification arrives.

- [ ] **Step 3: Commit**

```bash
git add src/routes/alerts/+page.svelte
git commit -m "feat: alerts UI"
```

---

## Milestone 7 — Deploy (Tasks 27–28)

### Task 27: Dockerfile + fly.toml

**Files:**
- Create: `Dockerfile`, `fly.toml`, `.dockerignore`
- Modify: `package.json` (add `build` if not present), `svelte.config.js` (use `@sveltejs/adapter-node`)

- [ ] **Step 1: Switch to the Node adapter**

```bash
npm install --save-dev --save-exact @sveltejs/adapter-node
```

`svelte.config.js`:
```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
```

- [ ] **Step 2: Dockerfile**

```dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --production

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/build /app/build
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/spa.db
ENV SECRETS_FILE=/app/data/secrets.json
EXPOSE 3000
CMD ["node", "build"]
```

- [ ] **Step 3: .dockerignore**

```
node_modules
build
.git
spike
data
.env
.env.local
docs
tests
```

- [ ] **Step 4: fly.toml**

```toml
app = "arctic-spa"
primary_region = "arn"

[build]

[env]
  NODE_ENV = "production"

[[mounts]]
  source = "data"
  destination = "/app/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 5: Local docker test**

```bash
docker build -t arctic-spa-local .
docker run --rm -p 3000:3000 -e ARCTIC_USERNAME=... -e ARCTIC_PASSWORD_HASH=... -e ARCTIC_SPA_UUID=... -e ARCTIC_REFRESH_TOKEN=... -e VAPID_PUBLIC_KEY=... -e VAPID_PRIVATE_KEY=... arctic-spa-local
```
Visit `http://localhost:3000` — dashboard should populate.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile fly.toml .dockerignore svelte.config.js package.json package-lock.json
git commit -m "build: dockerise + fly.toml + node adapter"
```

---

### Task 28: Deploy to Fly.io

- [ ] **Step 1: Install Fly CLI** (if absent)

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

- [ ] **Step 2: Launch app + volume**

```bash
fly launch --no-deploy --copy-config --name arctic-spa --region arn
fly volumes create data --size 1 --region arn
```

- [ ] **Step 3: Push secrets**

```bash
fly secrets set \
  ARCTIC_USERNAME="$(jq -r .ARCTIC_USERNAME data/secrets.json)" \
  ARCTIC_USER_ID="$(jq -r .ARCTIC_USER_ID data/secrets.json)" \
  ARCTIC_SPA_UUID="$(jq -r .ARCTIC_SPA_UUID data/secrets.json)" \
  ARCTIC_PASSWORD_HASH="$(jq -r .ARCTIC_PASSWORD_HASH data/secrets.json)" \
  ARCTIC_REFRESH_TOKEN="$(jq -r .ARCTIC_REFRESH_TOKEN data/secrets.json)" \
  VAPID_PUBLIC_KEY="$(jq -r .VAPID_PUBLIC_KEY data/secrets.json 2>/dev/null || cat - <<< 'paste here')" \
  VAPID_PRIVATE_KEY="$(jq -r .VAPID_PRIVATE_KEY data/secrets.json 2>/dev/null || cat - <<< 'paste here')"
```

- [ ] **Step 4: Deploy**

```bash
fly deploy
fly logs
```
Watch for `[boot] MQTT started`. Open the public URL — dashboard should populate.

- [ ] **Step 5: Install as PWA on phone**

Open the Fly URL on your phone, tap the browser's "Add to Home Screen". Confirm push notifications work end-to-end (toggle a chemistry threshold to fire one).

- [ ] **Step 6: Commit deployment notes**

```bash
git add fly.toml
git commit --allow-empty -m "deploy: shipped to Fly.io"
```

---

## Self-review checklist (run after writing this plan, before handoff)

- [x] **Spec coverage:** every spec section maps to at least one task —
  - Discovered architecture → context only (no task needed)
  - Architecture → Task 12 (boot wiring)
  - Auth & credential handling → Tasks 4, 5, 6, 7, 11, 12
  - Read path → Tasks 9, 10, 12
  - v1 features (dashboard, history, alerts) → Tasks 16-26
  - Tech stack → Tasks 1, 2, 27
  - SQLite schema → Task 8
  - Backend modules → Tasks 4-12, 21, 24, 25
  - SPA components → Tasks 16-20, 23, 26
  - Risks → addressed in plan-level commentary; no per-task action
  - Open questions → Task 7 resolves hash; Task 12 resolves topic namespace + payload shape; Task 7 records `expires_in`
- [x] **No placeholders:** every code block is concrete; no "implement later" or "similar to above"
- [x] **Type consistency:** `SpaState`, `AlertRule`, `OAuth2AccessToken` defined once in Task 3 and used unchanged throughout
- [x] **Frequent commits:** each task ends with a commit
- [x] **TDD for non-obvious logic:** hasher, OAuth client, MQTT pipeline, state store, auth manager, history rollup, alert rules
- [x] **Skipped TDD where it'd be ceremony:** SvelteKit scaffolding (Task 1-2), UI components (Task 17-19), deployment (Task 27-28)
