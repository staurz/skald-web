import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { reorderTasks } from '$lib/server/maintenance';

export const PUT: RequestHandler = async ({ request }) => {
  const { ids } = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(ids)) throw error(400, 'ids array required');
  reorderTasks(openDb(), ids);
  return json({ ok: true });
};
