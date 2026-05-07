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
- Replacing the spa's local control panel or the official mobile app's setup flows (e.g. WiFi onboarding stays on the mobile app).

## Discovered architecture of myarcticspa.com

- ASP.NET WebForms portal at `https://www.myarcticspa.com/`. Page version label "V2.0.3", 2025 copyright.
- Browser opens an MQTT-over-WebSockets connection on every authenticated page:
  - Broker: `wss://broker.myarcticspa.com:8081`
  - Auth: `username` only — a UUID. No password observed. Demo UUID is `99999999-9999-9999-9999-999999999999`.
- Browser subscribes to:
  - `web/spa/<UUID>/UpdateWebClient` — change-notification pings (no state payload observed).
  - `web/spa/<UUID>/UpdateWebClient_Error` — error notifications.
- On each ping, the page triggers an ASP.NET UpdatePanel partial postback to re-render — i.e. the actual current state values are delivered as server-rendered HTML fragments, not via MQTT.
- Commands are sent via ASP.NET PageMethod AJAX endpoints, e.g. `POST /spa/MySpa.aspx/Button_Click` with body `{ ButtonID: <id> }`. Requires the ASP.NET session cookie (not the MQTT UUID).
- Probe with the demo UUID: broker grants subscriptions on every wildcard pattern (`#`, `$SYS/#`, `spa/#`, `device/#`, `web/#`, etc. — all return `qos=0`). Zero messages were delivered during a 25-second listen, including after triggering `ButtonClicked(1)`. Demo mode appears to short-circuit the publish path server-side; broker delivery-time ACL behaviour for non-demo accounts is unresolved.

## Architecture

```
   ┌────────────────────────────┐                  ┌──────────────────────────┐
   │  Tiny always-on backend    │ ◄──── MQTT ────  │  broker.myarcticspa.com  │
   │  (Fly.io machine, Node)    │                  └──────────────────────────┘
   │  • subscribes 24/7         │                              ▲
   │  • writes history → SQLite │                              │ publishes
   │  • sends Web Push          │                  ┌───────────┴──────────────┐
   │  • exposes /state, /history│                  │ User's Arctic Spa        │
   │  • serves the SPA          │                  └──────────────────────────┘
   └─────────────┬──────────────┘
                 │ HTTPS / SSE
                 ▼
   ┌────────────────────────────┐
   │  SvelteKit SPA (PWA)       │
   │  • mobile-first            │
   │  • UUID in localStorage    │
   │  • optionally talks MQTT   │
   │    directly when on        │
   │    network (low latency)   │
   └────────────────────────────┘
```

**One MQTT subscriber for v1:** the Fly.io backend stays connected 24/7. Its job is durable capture (history, alerts) — independent of whether any browser is open. The SPA consumes a Server-Sent Events stream from the backend (`/api/state/stream`). Direct MQTT-from-browser is a possible future optimization for sub-second latency but is **not in v1** — keeps the architecture single-source-of-truth and avoids two MQTT clients accidentally racing.

**One project, monolithic:** SvelteKit handles the SPA, the API endpoints, and serves itself. The MQTT subscriber runs as a SvelteKit hook started at app boot — single Node process, single deployment.

## Auth & credential handling

### Phase 1 (read-only)

**Setup, one time:**

1. User logs in to `myarcticspa.com` in their normal browser (their password, never automated).
2. User clicks a bookmarklet we ship. It reads the UUID from inline JS on the page (`mqtt.connect(... { username: "<UUID>" }...)`) and copies it to clipboard.
3. User pastes the UUID into the new SPA's settings screen.
4. SPA persists UUID in `localStorage` and POSTs it once to the backend, which stores it as a Fly secret (`SPA_UUID`).

**Steady state:** UUID is the only credential needed for read-side. Both the SPA's MQTT client and the Fly backend's MQTT client connect with `{ username: <UUID> }`. UUID is treated as a per-device secret with the same sensitivity as a long-lived bearer token.

**Recovery:** if the UUID rotates (unlikely; it identifies the device), redo the bookmarklet flow.

### Phase 2 (commands — separate spec)

Out of scope for v1. End goal is reverse-engineering the iOS/Android app's REST API for a long-lived auth token; interim fallback is the Fly backend holding the user's ASP.NET session cookie and proxying `Button_Click` requests. Will be specified in its own design doc when v1 is in steady use.

### Where credentials live

- **UUID:** `localStorage` on SPA, Fly secret on backend. Treated as a secret; not logged.
- **Web password (only if Phase 2 fallback is needed):** Fly secret only, never on the client.

## Read path

### Resolution required: Branch A vs. Branch B

The architecture forks based on what the broker actually delivers to authenticated subscribers using a real account UUID:

- **Branch A — broker delivers raw spa telemetry on subscribable topics.** SPA and backend both decode MQTT payloads directly. No HTML scraping. **Preferred outcome.**
- **Branch B — broker only delivers `UpdateWebClient` pings.** Backend additionally holds the user's ASP.NET session cookie and fetches `MySpa.aspx` over HTTPS on every ping, parses the HTML for current values, and exposes JSON to the SPA. SPA never talks to ASP.NET directly.

Both branches are designed for; the codebase keeps an `MqttSource` and an `HtmlScrapeSource` behind a common `StateSource` interface. Once the real-account probe runs (see Open Questions), one source is deleted.

### Steady-state read flow

1. Backend boots, subscribes to `web/spa/<UUID>/#` and an exploratory wildcard set, writes incoming MQTT messages to SQLite as time-stamped events.
2. Backend exposes `GET /api/state` (current snapshot) and `GET /api/state/stream` (Server-Sent Events).
3. SPA subscribes to the SSE stream while open. Optionally also opens its own MQTT connection for sub-second latency on hot paths (temperature change, button toggle).
4. SPA renders from a single Svelte store fed by SSE messages.

### History

- All MQTT messages persisted to SQLite with `(timestamp, topic, payload_json)`.
- Derived rollups computed on a 5-minute interval and stored in `metric_5m` (avg/min/max temp, total pump runtime, water chemistry sample, etc.).
- `GET /api/history?metric=...&from=...&to=...` returns rollup or raw data depending on time range.

### Water chemistry (pH / Cl / ORP)

Contingent on user's spa having Spa Boy hardware. If Spa Boy publishes those values to the broker, they appear in the captured payloads automatically and the dashboard shows them. If absent, the dashboard hides the chemistry tile gracefully. No manual entry in v1.

## v1 feature set

1. **Real-time dashboard.** Current temp (°F + °C toggle), target temp, heating/cooling indicator, pumps 1–5, blower, lights, error codes, water chemistry tile (Spa Boy if present). Big touch targets, mobile-first, dark mode, installable as PWA.
2. **History graphs.** Temperature over last 24h / 7d / 30d. Pump runtime per day. Water chemistry trend (pH, Cl, ORP) over time. Simple line charts, no anomaly detection in v1.
3. **Alerts via Web Push.** Triggers: error code present, temperature outside user-set range, filter cycle missed, water chemistry outside thresholds (if Spa Boy). VAPID keys generated once and stored as Fly secrets. Subscription stored in SQLite per-device.

**Explicitly out of v1:** sending commands, multi-spa support, multi-user, public deploy, mobile-app reverse engineering.

## Tech stack

- **SvelteKit** (TypeScript), Tailwind for styling, Chart.js or Svelte-friendly charting for graphs.
- **Node.js** runtime. `mqtt` npm package (same library the portal uses) for the broker subscription. `better-sqlite3` for persistence. `web-push` for Web Push.
- **Fly.io** single shared-cpu-1x machine (free tier). Persistent volume for SQLite file. Health checks via `/api/health`.
- **PWA** via `@vite-pwa/sveltekit` plugin. Service worker for offline last-known-state and push notifications.
- **No CMS, no auth library, no backend framework beyond SvelteKit.**

## Component & data model sketch

### Backend modules

- `mqtt-subscriber.ts` — long-lived broker connection, normalises payloads, fans out to listeners.
- `state-source.ts` — `MqttStateSource | HtmlScrapeStateSource` behind a single interface; resolved at startup based on a config flag (`USE_HTML_FALLBACK=true|false`).
- `history.ts` — writes raw events, runs the 5-minute rollup job.
- `alerts.ts` — evaluates rules on every state change, sends Web Push when triggered.
- `api/` — SvelteKit `+server.ts` endpoints for `/state`, `/state/stream` (SSE), `/history`, `/alerts/rules`, `/alerts/subscribe`.

### SQLite schema (initial)

- `events(id, ts, topic, payload_json)` — raw MQTT capture.
- `metric_5m(metric, ts_bucket, avg, min, max, sample_count)` — rollups.
- `accessory_runtime(accessory, day, seconds_on)` — pump/blower runtime by day.
- `alert_rule(id, kind, threshold_json, enabled)` — user-defined alert rules.
- `alert_event(id, rule_id, ts, payload_json, delivered)` — fire log.
- `push_subscription(id, endpoint, p256dh, auth, created_at)` — Web Push subs.

### SPA components

- `Dashboard.svelte` — main view. Subscribes to SSE.
- `TemperatureCard.svelte` — current + target temp + heating indicator.
- `AccessoryGrid.svelte` — pumps, blower, lights state.
- `ChemistryCard.svelte` — pH/Cl/ORP if available; hidden otherwise.
- `HistoryView.svelte` — graphs page.
- `AlertsView.svelte` — rules + subscription management.
- `Settings.svelte` — UUID setup, °F/°C, theme, push-permission button.

## Risks & open questions

1. **Branch A vs. Branch B unresolved.** Real-account probe required before implementation starts. Mitigation: design supports both; switching is a config flag.
2. **Broker ACL at delivery time may differ from subscribe-time grants.** Demo mode delivered nothing despite granting all wildcards. Real-account probe will tell us whether `web/spa/<UUID>/#` (and related) actually deliver payloads.
3. **No history endpoint exists yet for backfill.** v1 history starts at deploy time. Past data not recoverable unless the portal exposes a diagnostics endpoint we can scrape (TBD).
4. **MQTT credential rotation.** If Arctic Spa starts rotating UUIDs or adds password auth, we re-do the bookmarklet flow. If they switch brokers entirely, the project breaks until we re-investigate.
5. **ToS posture.** Personal use, own credentials, own spa, no redistribution. Should still skim Arctic Spa's ToS before Phase 2 (commands), since automated control might trip clauses around third-party clients.
6. **Cert pinning / mobile-app obfuscation (Phase 2 risk).** Not v1, but worth flagging that the Phase 2 plan has unknowns.
7. **Single point of failure.** Fly free machine going down = no history capture during downtime. Acceptable for personal use; revisit if it happens often.

## Open questions to resolve before implementation

- [ ] Run the wildcard MQTT probe with the user's real-account UUID to determine Branch A vs. Branch B.
- [ ] Confirm the user's spa has Spa Boy hardware (decides whether the chemistry tile ships in v1 or is hidden).
- [ ] Confirm where `myarcticspa.com` exposes the UUID in the page after a real login (the bookmarklet needs the exact selector).
- [ ] Skim Arctic Spa ToS for any clause restricting third-party clients.

## Implementation phasing (preview — full plan in writing-plans step)

**Phase 1 (v1):** Backend + SQLite + MQTT subscriber + dashboard + history + alerts.

**Phase 2 (separate spec):** Commands, mobile-app API reverse engineering or session-cookie fallback.

**Phase 3 (separate spec, maybe never):** Anomaly detection, energy estimates, automation rules ("if outside 3°C set spa to 38°C 90 minutes before sunset").
