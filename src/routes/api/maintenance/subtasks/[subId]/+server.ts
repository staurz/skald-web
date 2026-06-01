import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { deleteSubTask } from '$lib/server/maintenance';

export const DELETE: RequestHandler = ({ params }) => {
  deleteSubTask(openDb(), params.subId!);
  return json({ ok: true });
};
