import { json } from '@sveltejs/kit';
import { getBoot } from '$lib/server/boot';

export const GET = () => {
  const b = getBoot();
  if (!b) return json({ ready: false, state: null }, { status: 503 });
  return json({ ready: b.isReady(), state: b.state.snapshot() });
};
