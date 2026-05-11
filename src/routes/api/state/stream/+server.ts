import { getBoot } from '$lib/server/boot';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const b = getBoot();
  if (!b) return new Response('boot not started', { status: 503 });

  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(chunk); }
        catch { teardown(); }
      };
      const send = (data: unknown) => safeEnqueue(`data: ${JSON.stringify(data)}\n\n`);

      send({ kind: 'snapshot', state: b.state.snapshot() });
      unsubscribe = b.state.onChange((s) => send({ kind: 'snapshot', state: s }));
      heartbeat = setInterval(() => safeEnqueue(': ping\n\n'), 25_000);
    },
    cancel() { teardown(); },
  });

  function teardown() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
  }

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
    },
  });
};
