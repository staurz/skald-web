import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { addSubTask } from '$lib/server/maintenance';

export const POST: RequestHandler = async ({ params, request }) => {
  const { title } = (await request.json()) as { title?: string };
  if (!title || !title.trim()) throw error(400, 'title required');
  const sub = addSubTask(openDb(), params.id!, title.trim());
  if (!sub) throw error(404, 'parent not found');
  return json({ subTask: sub }, { status: 201 });
};
