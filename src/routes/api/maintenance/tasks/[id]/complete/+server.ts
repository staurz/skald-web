import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { completeTask } from '$lib/server/maintenance';

export const POST: RequestHandler = ({ params }) => {
  const task = completeTask(openDb(), params.id!, Date.now());
  if (!task) throw error(404, 'not found');
  return json({ task });
};
