import type { Handle } from '@sveltejs/kit';
import { startBackend } from '$lib/server/boot';

startBackend();

export const handle: Handle = async ({ event, resolve }) => resolve(event);
