import webpush from 'web-push';
import { defaultSecrets } from './secrets';
import { openDb } from './db';

let configured = false;

function configure() {
  if (configured) return;
  const pub = defaultSecrets.get('VAPID_PUBLIC_KEY');
  const priv = defaultSecrets.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) {
    console.warn('[push] VAPID keys missing');
    return;
  }
  webpush.setVapidDetails('mailto:emil.staurset@miles.no', pub, priv);
  configured = true;
}

export function getPublicKey(): string | null {
  return defaultSecrets.get('VAPID_PUBLIC_KEY');
}

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function saveSubscription(sub: PushSubscriptionPayload) {
  const db = openDb();
  db.prepare(
    'INSERT OR IGNORE INTO push_subscription (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)',
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

export async function sendToAll(payload: { title: string; body: string; tag?: string }) {
  configure();
  if (!configured) return;
  const db = openDb();
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscription').all() as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const e = err as { statusCode?: number };
      if (e.statusCode === 410 || e.statusCode === 404) {
        db.prepare('DELETE FROM push_subscription WHERE id = ?').run(s.id);
      } else {
        console.error('[push]', err);
      }
    }
  }
}
