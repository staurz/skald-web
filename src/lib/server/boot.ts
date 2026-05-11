import { defaultSecrets } from './secrets';
import { grantToken, refreshAccessToken } from './arctic-auth';
import { createAuthManager } from './auth-manager';
import { createMqttPipeline } from './mqtt';
import { createStateStore } from './state';
import { openDb } from './db';
import type { AuthenticationSpa } from './types';

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
      ready = true;
      console.log('[boot] MQTT started');

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
      }, 10 * 60 * 1000);
    } catch (err) {
      console.error('[boot] failed to start MQTT', err);
    }
  })();

  return bootResult;
}
