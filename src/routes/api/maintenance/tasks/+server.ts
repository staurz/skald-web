import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { createTask, listTasks } from '$lib/server/maintenance';
import type { TaskInput } from '$lib/server/maintenance-types';

export const GET: RequestHandler = () => {
  return json({ tasks: listTasks(openDb()) });
};

export const POST: RequestHandler = async ({ request }) => {
  const input = (await request.json()) as TaskInput;
  if (!input?.title || !input.recurrenceKind) throw error(400, 'title and recurrenceKind required');
  const task = createTask(openDb(), input, Date.now());
  return json({ task }, { status: 201 });
};
