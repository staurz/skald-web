import { writable, type Writable } from 'svelte/store';
import type { SpaState } from '$lib/server/types';

export const spaState: Writable<SpaState | null> = writable(null);

let started = false;
let es: EventSource | null = null;

export function startStateStream() {
  if (started) return;
  started = true;
  es = new EventSource('/api/state/stream');
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'snapshot') spaState.set(msg.state);
    } catch {
      /* ignore malformed payloads */
    }
  };
  es.onerror = () => {
    es?.close();
    es = null;
    started = false;
    setTimeout(startStateStream, 3000);
  };
}

export function stopStateStream() {
  es?.close();
  es = null;
  started = false;
}
