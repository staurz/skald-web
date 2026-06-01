import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { updateTask, deleteTask } from '$lib/server/maintenance';
import type { TaskInput } from '$lib/server/maintenance-types';

export const PUT: RequestHandler = async ({ params, request }) => {
  const input = (await request.json()) as TaskInput;
  if (!input?.title || !input.recurrenceKind) throw error(400, 'title and recurrenceKind required');
  const task = updateTask(openDb(), params.id!, input, Date.now());
  if (!task) throw error(404, 'not found');
  return json({ task });
};

export const DELETE: RequestHandler = ({ params }) => {
  deleteTask(openDb(), params.id!);
  return json({ ok: true });
};
