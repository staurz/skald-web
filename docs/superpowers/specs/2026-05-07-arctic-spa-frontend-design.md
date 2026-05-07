# Arctic Spa Custom Frontend — Design

**Date:** 2026-05-07
**Author:** Emil Staurset (with Claude)
**Scope:** Personal-use only. Not a redistributable product.

## Goal

Replace `myarcticspa.com` for the user's day-to-day spa monitoring with a personal, mobile-first PWA. Eliminate the manual login on every check, surface the data the user actually cares about (real-time temperature, accessory state, water chemistry, history, alerts), and lay groundwork for sending commands later.

## Non-goals

- Multi-tenant. Single-user only; the user's own credentials, the user's own spa.
- Public distribution. Self-hosted personal tool.
- Replicating every page of the web portal — only what the user actually uses.
- Replacing the spa's local control panel or the official mobile app's setup flows (e.g. Wi-Fi onboarding stays on the mobile app).

## Discovered architecture

Resolved by combination of: (a) inspecting the web portal's authenticated MQTT traffic, (b) running a wildcard MQTT broker probe with a real account UUID, and (c) decompiling the Android app `com.crazedcoders.globalspa` v5.0.41 with jadx 1.5.0.

### Web portal (`myarcticspa.com`)

- ASP.NET WebForms, version label "V2.0.3", actively maintained (2025 copyright).
- After login, the browser opens an MQTT-over-WebSockets connection at `wss://broker.myarcticspa.com:8081` with `username=<spa-UUID>, password=<empty>`.
- Subscribes only to `web/spa/<UUID>/UpdateWebClient` and `..._Error`.
- Real-account probe (2026-05-07): 9 messages over a 60s window with the user toggling Pump 1, all on the single topic `web/spa/<UUID>/UpdateWebClient`, each with a 2-byte JSON body (`{}` ping). Wildcard subscriptions (`#`, `spa/#`, `device/#`, etc.) accepted at subscribe-time but delivered nothing — the broker enforces strict delivery-time ACL based on the auth strength of the connection.
- The portal's render pipeline relies on the MQTT ping to trigger ASP.NET UpdatePanel postbacks; real values live in HTML fragments. **The web portal does not expose Spa Boy chemistry data at all.**

### Mobile app (`com.crazedcoders.globalspa`, v5.0.41)

Decompiled successfully (124 MB output, 299 source files in `com.crazedcoders.globalspa.*`). Code is **not obfuscated** — full descriptive class names preserved. Uses standard libraries: OkHttp + Retrofit for REST, Paho MQTT for broker, Gson for JSON, `de.rheinfabrik.heimdall2` for OAuth2, RxJava2 for async.

**API endpoints (declared in `BuildConfig`):**

- `API_SERVER = "https://api.myarcticspa.com"` — REST host
- `MQTT_ENDPOINT = "tcp://broker.myarcticspa.com:1884"` — MQTT broker (same broker the web portal uses, different port + auth)
- `OAUTH2_CLIENT_ID = "mqtt-mobile"` — OAuth2 client identifier
- `AWS_IOT_ENDPOINT = "wss://a2t84nz00o45m2-ats.iot.ca-central-1.amazonaws.com:443/mqtt"` — alternative path for newer device generations; not used for v1.

**Auth flow:**

1. `POST https://api.myarcticspa.com/api/auth` body `{ Username, Password }` (raw password, over TLS) → response `{ ErrorCode, Salt, UserId, Spas: [{ Id, NickName, IsConnected, IsMoved, DealerId }] }`.
2. Compute `passwordHash`:
   ```
   passwordHash = base64(SHA1(base64decode(salt) || utf16le(password)))[:-1]
   ```
   (The `[:-1]` drops one trailing character, observed verbatim in `Hasher.apply`. UTF-16-LE input is the .NET string default — strongly suggests an ASP.NET-derived backend.)
3. `POST https://api.myarcticspa.com/access_token` body:
   ```json
   {
     "grant_type": "password",
     "username":   "<email>|<spa-uuid-lowercase>",
     "password":   "<passwordHash>",
     "spa":        { "Id": "...", "NickName": "...", "IsConnected": true, "IsMoved": null, "DealerId": 0 }
   }
   ```
   → response `{ access_token, refresh_token, expires_in, ... }`.
4. Refresh: `POST /access_token { grant_type: "refresh_token", refresh_token }`. If refresh fails, re-run step 3 using stored `passwordHash` — the raw password is never needed again after first login.
5. `access_token` is a JWT whose `sub` claim holds the spa UUID (parsed by `Hasher.getSpaFromToken`).

**MQTT auth:**

```
mqtt.connect("tcp://broker.myarcticspa.com:1884", {
    username: <access_token JWT>,
    password: "anything",          // literal string; broker validates JWT in username only
    reconnectPeriod: 1000,         // setAutomaticReconnect(true) in app
})
```

The broker has a JWT-validating plugin on the username field. The password is unused — Paho requires non-empty so the app sends the literal string `"anything"`.

**MQTT topics — subscribe (the rich data, what we want):**

| Topic | Payload |
|---|---|
| `arctic/spa/<spaGuid>/telemetry/spa` | Current state: temperature, target temperature, pumps, blower, lights, heating state |
| `arctic/spa/<spaGuid>/telemetry/spaboy` | **Spa Boy chemistry: pH, Cl, ORP** |
| `arctic/spa/<spaGuid>/telemetry/errors` | Error codes |
| `arctic/spa/<spaGuid>/telemetry/filters` | Filter cycle state |
| `arctic/spa/<spaGuid>/telemetry/heartbeat` | Connection liveness |
| `arctic/spa/<spaGuid>/telemetry/rfid` | RFID events |
| `arctic/spa/<spaGuid>/settings/spa` | Current spa settings |
| `arctic/spa/<spaGuid>/settings/spaboy` | Chemistry thresholds, sanitiser settings |
| `arctic/spa/<spaGuid>/settings/peak` | Peak-energy schedule |
| `arctic/spa/<spaGuid>/information/spa` | Static device info |
| `arctic/spa/<spaGuid>/config/spa` | Configuration |

**MQTT topics — publish (Phase 2 commands):**

- `arctic/spa/<spaGuid>/command` — JSON command bodies. Shapes already modelled in app classes `UpdateSpaCommand`, `UpdateSpaboySettingsCommand`, `UpdateSpaSettingsCommand`, `UpdatePeakSettingsCommand`, `FirmwareUpgradeCommand`.

**Why the web-portal probe was so locked down (mystery resolved):** the web portal connects with `username=UUID, password=empty` → broker grants minimum ACL (only the `UpdateWebClient` ping topic). The mobile app connects with `username=JWT, password="anything"` → broker grants full ACL on `arctic/spa/<UUID>/...`. Same broker, two doors, gated by auth strength.

## Architecture

```
┌──────────────────────────────────────────┐                ┌───────────────────────────┐
│  Fly.io backend (SvelteKit + Node)       │ ────TCP/MQTT──▶│  broker.myarcticspa.com   │
│                                          │   :1884        │  (self-hosted; same       │
│  • Holds passwordHash + refresh_token    │  user=JWT      │  broker the web uses on   │
│  • Refreshes JWT before expiry           │  pass="anything"│  port 8081)              │
│  • Subscribes arctic/spa/<UUID>/#        │                └───────────────────────────┘
│  • Writes raw events → SQLite            │                            ▲
│  • Computes 5-min metric rollups         │                            │ publishes
│  • Evaluates alert rules → Web Push      │                ┌───────────┴───────────────┐
│  • Exposes /api/state, /api/state/stream │                │  User's Arctic Spa        │
│    (SSE), /api/history                   │                └───────────────────────────┘
│  • Serves the SPA                        │
└──────────────────┬───────────────────────┘
                   │ HTTPS / SSE
                   ▼
┌──────────────────────────────────────────┐
│  SvelteKit SPA (PWA, mobile-first)       │
└──────────────────────────────────────────┘
```

**One process, monolithic.** SvelteKit handles the SPA, the API endpoints, and serves itself. The MQTT subscriber and JWT refresh loop run as a SvelteKit `hooks.server.ts` startup hook — single Node process, single deployment, simple to reason about.

## Auth & credential handling

### Initial setup (one-time, from a single SPA screen)

1. User opens the SPA, sees a setup screen if `ARCTIC_PASSWORD_HASH` is unset.
2. User types email + raw password.
3. Backend executes the full flow once, in-memory:
   - `POST /api/auth` → salt, UserId, Spas[]
   - User picks which spa (if multiple); for now, single-spa is the assumed case.
   - Compute `passwordHash`.
   - `POST /access_token` → JWT, refresh_token, expires_in.
   - Connect MQTT to confirm credentials work.
4. Backend persists as Fly secrets (encrypted at rest, only readable inside the running machine):
   - `ARCTIC_USERNAME` — the email
   - `ARCTIC_USER_ID` — server-assigned UserId
   - `ARCTIC_SPA_UUID` — extracted from JWT `sub` claim
   - `ARCTIC_PASSWORD_HASH` — the computed passwordHash
   - `ARCTIC_REFRESH_TOKEN` — current refresh token (rotated as it refreshes)
5. **Raw password is never persisted.** It exists only in process memory during step 3, then is dropped. The SPA POST that submitted it does not log the body.

### Steady state

- Backend caches the current `access_token` in memory.
- A refresh loop runs at 75 % of `expires_in` to obtain a new pair before expiry.
- If refresh returns 4xx (token revoked, server-side logout, etc.), backend re-runs step 3 with the stored `passwordHash` — fully unattended.
- If `passwordHash` is rejected (user changed their password elsewhere): backend transitions to `NEEDS_REAUTH` state, SPA shows the setup screen again.

### Trust model

- The backend holds `passwordHash` + `refresh_token`. With these, an attacker can read the user's spa data and (Phase 2) send commands. They CANNOT log into the web portal, change account email/password, or escalate to other accounts — those require the raw password.
- A Fly compromise: bad but bounded — your hot tub gets monitored / commands sent. Not a full account takeover.
- Personal-use scope makes this acceptable. A public deploy of the same code would not.

## Read path

```
1. SvelteKit hook starts on app boot.
2. Reads ARCTIC_* secrets from environment.
3. If no JWT or expired: refresh / re-auth; on failure, mark NEEDS_REAUTH.
4. mqtt.connect("tcp://broker.myarcticspa.com:1884", { username: JWT, password: "anything" }).
5. Subscribe to `arctic/spa/<UUID>/#` (everything under the spa's prefix). Forward-compatible if Arctic Spa adds new subtopics.
6. On message:
     - Append raw event to events(ts, topic, payload_json).
     - Update in-memory current-state snapshot.
     - Push delta to SSE stream subscribers.
     - Evaluate active alert rules → enqueue Web Push if triggered.
7. Periodic 5-minute rollup job writes metric_5m table.
8. JWT refresh loop runs at 0.75 × expires_in.
```

The SPA opens a single SSE stream `/api/state/stream`, receives the current snapshot on connect, then deltas as they arrive. UI renders from one Svelte store fed by that stream.

## v1 feature set

1. **Real-time dashboard.** Current temperature (°F + °C toggle), target temperature, heating/cooling state, pumps 1–5, blower, lights, error codes, **chemistry tile (pH / Cl / ORP — confirmed shipping in v1)**. Mobile-first, big touch targets, dark mode, installable as PWA.

2. **History graphs.** Temperature over 24 h / 7 d / 30 d. Pump runtime per day. Chemistry trends (pH / Cl / ORP) over time. Simple line charts; no anomaly detection in v1.

3. **Alerts via Web Push.** Triggers: error code present, temperature outside user-set range, filter cycle missed, chemistry outside user-set thresholds. VAPID keys generated once and stored as Fly secrets. Subscriptions stored in SQLite per device.

**Out of v1:** sending commands, multi-spa support, multi-user, public deploy, AWS IoT path.

## Tech stack

- **SvelteKit** (TypeScript), Tailwind for styling, Chart.js or Layer Cake for graphs.
- **Node.js** runtime. `mqtt` npm package for the broker subscription. `better-sqlite3` for persistence. `web-push` for Web Push. Hashing via Node `crypto` (SHA-1 + manual UTF-16-LE encode); JWT inspection via `Buffer.from(b64, 'base64url')`.
- **Fly.io** single shared-cpu-1x machine (free tier). Persistent volume for SQLite. Health checks via `/api/health`.
- **PWA** via `@vite-pwa/sveltekit`. Service worker for offline last-known-state and Web Push notifications.

## Component & data model sketch

### Backend modules

- `src/lib/server/arctic-auth.ts` — `/api/auth` + `/access_token` calls, password hashing, refresh loop, JWT inspection, secret persistence.
- `src/lib/server/mqtt.ts` — long-lived broker connection, subscribes to all `arctic/spa/<UUID>/...` topic groups, normalises payloads to a unified `SpaState` type, fans out to listeners.
- `src/lib/server/state.ts` — in-memory current `SpaState`, computes deltas, exposes SSE streams.
- `src/lib/server/history.ts` — writes raw events to SQLite, runs the 5-minute rollup job.
- `src/lib/server/alerts.ts` — evaluates rules on every state change, sends Web Push when triggered.
- `src/routes/api/...` — SvelteKit `+server.ts` endpoints: `/state`, `/state/stream` (SSE), `/history`, `/alerts/rules`, `/alerts/subscribe`, `/setup` (initial credential entry).

### SQLite schema (initial)

- `events(id, ts, topic, payload_json)` — raw MQTT capture, append-only.
- `metric_5m(metric, ts_bucket, avg, min, max, sample_count)` — 5-min rollups.
- `accessory_runtime(accessory, day, seconds_on)` — pump/blower runtime per day.
- `alert_rule(id, kind, threshold_json, enabled)` — user-defined alert rules.
- `alert_event(id, rule_id, ts, payload_json, delivered)` — alert fire log.
- `push_subscription(id, endpoint, p256dh, auth, created_at)` — Web Push subscriptions.

### SPA components

- `Dashboard.svelte` — main view, subscribes to SSE.
- `TemperatureCard.svelte` — current + target temperature + heating indicator.
- `AccessoryGrid.svelte` — pumps, blower, lights state.
- `ChemistryCard.svelte` — pH / Cl / ORP, contextual colour for in/out of range.
- `HistoryView.svelte` — graphs page.
- `AlertsView.svelte` — rules + push subscription management.
- `SetupView.svelte` — initial credential entry, only shown if `NEEDS_REAUTH`.

## Risks & open questions

1. **Mobile-API stability.** Arctic Spa could change auth, hash algorithm, or topic structure in a future app update. Mitigation: pin to v5.0.41 behaviour for now; if it breaks, re-decompile a newer APK and update accordingly. Bus-factor risk for the project.

2. **Hash reproducibility.** SHA-1 + UTF-16-LE + trailing-byte trim is non-standard. Need an integration test that verifies a known password yields a server-accepted hash on first build.

3. **JWT lifetime unknown.** Likely 15–60 min based on OAuth2 conventions. The first auth response will tell us via `expires_in`.

4. **Trust commitment.** `passwordHash` and `refresh_token` on a Fly machine. Acceptable for personal use, not for public deploy. Documented in the trust-model section.

5. **Single point of failure.** Fly free machine going down = no history capture during downtime. Acceptable; revisit if it becomes a pattern.

6. **Cert pinning / future hardening.** None observed in current APK (regular OkHttp + Paho, no `CertificatePinner`, no `NetworkSecurityConfig` overrides). Could be added in a future app version; would force a TLS proxy locally to recover. Not a v1 risk.

7. **AWS IoT alternative path.** Newer spa generations may use the AWS IoT broker (`a2t84nz00o45m2-ats.iot.ca-central-1.amazonaws.com`) with a custom authorizer. The user's spa works with the self-hosted broker today (confirmed by the current web portal connection going to `broker.myarcticspa.com`). If that changes, we'd switch to MQTT-over-WebSockets with AWS SigV4 — meaningful but bounded refactor.

## Open questions to resolve during implementation

- [ ] Confirm `passwordHash` reproducibility against the live API (integration test on first build, using your real credentials).
- [ ] Read `expires_in` from a real OAuth2 response to learn the actual JWT lifetime.
- [ ] Confirm the topic namespace your specific spa publishes to (we expect `arctic/spa/<UUID>/...` based on the self-hosted broker; verify with a one-time wildcard subscribe-test as soon as we have a JWT).
- [ ] Inspect actual payload shapes on `telemetry/spa` and `telemetry/spaboy` — the app's `SpaboyLive`, `SpaSettings`, etc. classes give the expected shape, but real bytes need confirmation before we lock in a `SpaState` type.

These are "prove during build" items, not blockers.

## Implementation phasing (preview — full plan in writing-plans step)

**Phase 1 (v1):** Auth + MQTT subscriber + dashboard + history + alerts. Single Fly machine, SQLite, PWA. No commands. Estimated ~1 week of focused work.

**Phase 2:** Commands. Publish to `arctic/spa/<UUID>/command` with the JSON shapes already modelled in the app's `*Command.java` classes. Significantly less work than originally feared because the data path is unchanged — Phase 2 is just adding `publish()` calls and confirmation feedback in the UI.

**Phase 3 (maybe never):** Anomaly detection, energy estimates, automation rules ("if outside temperature drops below 3 °C, set spa to 38 °C 90 minutes before sunset"), AWS IoT support.
