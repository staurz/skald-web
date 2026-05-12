import { defaultSecrets } from './secrets';
import { grantToken, refreshAccessToken } from './arctic-auth';
import { createAuthManager } from './auth-manager';
import { createMqttPipeline } from './mqtt';
import { createStateStore } from './state';
import { openDb } from './db';
import { startRollupLoop } from './history';
import { evaluateRules } from './alerts';
import { sendToAll } from './push';
import type { AlertRule, AuthenticationSpa } from './types';

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
  const installationId = defaultSecrets.get('INSTALLATION_ID');
  const userId = defaultSecrets.get('ARCTIC_USER_ID');

  const db = openDb();
  const state = createStateStore(uuid ?? 'unconfigured');
  let ready = false;

  bootResult = { state, isReady: () => ready };

  if (!uuid || !username || !passwordHash || !installationId) {
    console.warn('[boot] secrets missing — skipping MQTT until /setup is completed');
    return bootResult;
  }

  // Single-spa v1 assumption: reconstruct the AuthenticationSpa for re-auth from
  // stored UUID. IsMoved=false matches the legacy-tcp path resolved at setup.
  const spa: AuthenticationSpa = {
    Id: uuid,
    NickName: null,
    IsConnected: true,
    IsMoved: false,
    DealerId: null,
  };

  const auth = createAuthManager({
    refresh: (refreshToken) => refreshAccessToken({ refreshToken, installationId, spa }),
    reauth: () => grantToken({ username, passwordHash, spa, installationId, userId }),
    persist: ({ refreshToken }) => defaultSecrets.set('ARCTIC_REFRESH_TOKEN', refreshToken),
    getStored: () => ({ refreshToken: defaultSecrets.get('ARCTIC_REFRESH_TOKEN') }),
  });

  const insertEvent = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
  const insertAlert = db.prepare(
    'INSERT INTO alert_event (rule_id, ts, payload_json, delivered) VALUES (?, ?, ?, 0)',
  );
  const fetchEnabledRules = db.prepare(
    'SELECT id, kind, threshold_json, enabled FROM alert_rule WHERE enabled = 1',
  );

  // Per-rule last-fire timestamp; suppress re-fire within 5 minutes.
  const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
  const lastFireByRule = new Map<string, number>();

  state.onChange((s) => {
    const rows = fetchEnabledRules.all() as {
      id: string;
      kind: string;
      threshold_json: string;
    }[];
    if (rows.length === 0) return;
    const rules: AlertRule[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind as AlertRule['kind'],
      threshold: JSON.parse(r.threshold_json),
      enabled: true,
    }));
    const fires = evaluateRules(rules, s);
    const now = Date.now();
    for (const f of fires) {
      const last = lastFireByRule.get(f.ruleId) ?? 0;
      if (now - last < ALERT_COOLDOWN_MS) continue;
      lastFireByRule.set(f.ruleId, now);
      try {
        insertAlert.run(f.ruleId, now, JSON.stringify(f.payload));
      } catch (err) {
        console.error('[boot] alert insert failed', err);
      }
      sendToAll({
        title: 'Spa alert',
        body: `${f.ruleId}: ${JSON.stringify(f.payload)}`,
        tag: f.ruleId,
      }).catch((err) => console.error('[push]', err));
    }
  });

  const pipe = createMqttPipeline({
    uuid,
    onEvent: (e) => {
      try { insertEvent.run(e.ts, e.topic, JSON.stringify(e.payload)); }
      catch (err) { console.error('[boot] db write failed', err); }
      state.ingest(e);
    },
    onError: (err) => console.error('[mqtt]', err),
  });

  (async () => {
    try {
      let lastJwt = await auth.getValidToken();
      pipe.setJwt(lastJwt);
      pipe.start();
      startRollupLoop(db);
      ready = true;
      console.log('[boot] MQTT started');

      // Poll often so the auth manager's natural caching (75% of expires_in)
      // controls rotation; without this, an expired JWT triggers an MQTT
      // auto-reconnect storm every 2 s until the next tick.
      setInterval(async () => {
        try {
          const fresh = await auth.getValidToken();
          if (fresh !== lastJwt) {
            lastJwt = fresh;
            pipe.setJwt(fresh);
          }
        } catch (err) {
          console.error('[boot] token refresh failed', err);
        }
      }, 60 * 1000);
    } catch (err) {
      console.error('[boot] failed to start MQTT', err);
    }
  })();

  return bootResult;
}
