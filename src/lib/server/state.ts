import type { RawMqttEvent, SpaState } from './types';
import { normalise } from './payload-normalisers';

export function createStateStore(_uuid: string) {
  let snapshot: SpaState = { ts: 0 };
  const listeners: ((state: SpaState) => void)[] = [];

  function ingest(event: RawMqttEvent) {
    const patch = normalise(event);
    if (!patch) return;

    const merged: SpaState = { ...snapshot, ...patch, ts: event.ts };
    if (sameShallow(snapshot, merged)) return;
    snapshot = merged;
    for (const l of listeners) l(snapshot);
  }

  function sameShallow(a: SpaState, b: SpaState): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SpaState>;
    keys.delete('ts');
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    }
    return true;
  }

  return {
    ingest,
    snapshot: () => snapshot,
    onChange(cb: (s: SpaState) => void) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };
}
