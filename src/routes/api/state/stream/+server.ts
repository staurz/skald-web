import { getBoot } from '$lib/server/boot';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const b = getBoot();
  if (!b) return new Response('boot not started', { status: 503 });

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

      send({ kind: 'snapshot', state: b.state.snapshot() });

      const unsubscribe = b.state.onChange((s) => send({ kind: 'snapshot', state: s }));
      const heartbeat = setInterval(() => controller.enqueue(': ping\n\n'), 25_000);

      return () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      /* teardown handled by start's returned function */
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
    },
  });
};
