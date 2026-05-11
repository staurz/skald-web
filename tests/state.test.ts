import { describe, it, expect } from 'vitest';
import { createStateStore } from '../src/lib/server/state';
import type { RawMqttEvent, SpaState } from '../src/lib/server/types';

const ev = (topic: string, payload: unknown): RawMqttEvent => ({ ts: 1000, topic, payload });

describe('state store', () => {
  it('normalises telemetry/spa into temperature + accessories', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', {
      currentTempF: 102, setpointF: 104, heating: true,
      pump1: 1, pump2: 0, pump3: 2, blower: false, lights: true,
    }));
    const st = s.snapshot();
    expect(st.temperatureF).toBe(102);
    expect(st.targetTemperatureF).toBe(104);
    expect(st.heating).toBe(true);
    expect(st.pumps).toEqual([{ id: 1, speed: 1 }, { id: 2, speed: 0 }, { id: 3, speed: 2 }]);
    expect(st.blower).toBe(false);
    expect(st.lights).toBe(true);
  });

  it('normalises telemetry/spaboy into chemistry', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spaboy', { ph: 7.4, chlorine: 1.2, orp: 650 }));
    expect(s.snapshot().chemistry).toEqual({ ph: 7.4, chlorine: 1.2, orp: 650 });
  });

  it('normalises telemetry/errors into errors array', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/errors', { errors: ['ERR_OVERHEAT', 42, 'ERR_FLOW'] }));
    expect(s.snapshot().errors).toEqual(['ERR_OVERHEAT', 'ERR_FLOW']);
  });

  it('ignores unknown topics and non-object payloads', () => {
    const s = createStateStore('uuid-1');
    const before = s.snapshot();
    s.ingest(ev('arctic/spa/uuid-1/something/else', { currentTempF: 99 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', 'not-an-object'));
    expect(s.snapshot()).toEqual(before);
  });

  it('emits change events with deltas and skips no-op merges', () => {
    const s = createStateStore('uuid-1');
    const seen: SpaState[] = [];
    s.onChange((p: SpaState) => seen.push(p));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 100 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 100 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 101 }));
    expect(seen).toHaveLength(2);
    expect(seen[0].temperatureF).toBe(100);
    expect(seen[1].temperatureF).toBe(101);
  });

  it('onChange returns an unsubscribe function', () => {
    const s = createStateStore('uuid-1');
    const seen: SpaState[] = [];
    const off = s.onChange((p: SpaState) => seen.push(p));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 100 }));
    off();
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { currentTempF: 101 }));
    expect(seen).toHaveLength(1);
  });
});
