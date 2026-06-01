import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { toggleSubTask } from '$lib/server/maintenance';

export const POST: RequestHandler = ({ params }) => {
  return json(toggleSubTask(openDb(), params.subId!, Date.now()));
};
