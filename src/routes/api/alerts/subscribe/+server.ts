import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSubscription, getPublicKey, type PushSubscriptionPayload } from '$lib/server/push';

export const GET: RequestHandler = () => json({ publicKey: getPublicKey() });

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as PushSubscriptionPayload;
  saveSubscription(body);
  return json({ ok: true });
};
