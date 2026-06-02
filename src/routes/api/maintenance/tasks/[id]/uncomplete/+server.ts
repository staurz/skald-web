import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { restoreTask } from '$lib/server/maintenance';
import type { CompletionSnapshot } from '$lib/server/maintenance-types';

export const POST: RequestHandler = async ({ params, request }) => {
  const snap = (await request.json()) as CompletionSnapshot;
  const task = restoreTask(openDb(), params.id!, snap);
  if (!task) throw error(404, 'not found');
  return json({ task });
};
