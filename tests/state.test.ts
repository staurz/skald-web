import { describe, it, expect } from 'vitest';
import { createStateStore } from '../src/lib/server/state';
import type { RawMqttEvent, SpaState } from '../src/lib/server/types';
import { TELEMETRY_SPA, TELEMETRY_SPABOY, TELEMETRY_ERRORS, TELEMETRY_ERRORS_ACTIVE } from './fixtures/spa-payloads';

const ev = (topic: string, payload: unknown): RawMqttEvent => ({ ts: 1000, topic, payload });

describe('state store — real payload shapes', () => {
  it('normalises telemetry/spa: tempF/tempSetPointF, heater1|2, pump1..5, blower1|2, lights', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', {
      ...TELEMETRY_SPA,
      tempF: 102, tempSetPointF: 104,
      heater1: 1, heater2: 0,
      pump1: 1, pump2: 0, pump3: 2,
      blower1: 0, blower2: 1,
      lights: true,
    }));
    const st = s.snapshot();
    expect(st.temperatureF).toBe(102);
    expect(st.targetTemperatureF).toBe(104);
    expect(st.heating).toBe(true);
    expect(st.pumps).toEqual([
      { id: 1, speed: 1 }, { id: 2, speed: 0 }, { id: 3, speed: 2 },
      { id: 4, speed: 0 }, { id: 5, speed: 0 },
    ]);
    expect(st.blower).toBe(true);
    expect(st.lights).toBe(true);
  });

  it('telemetry/spa with all heaters off → heating=false', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', TELEMETRY_SPA));
    expect(s.snapshot().heating).toBe(false);
    expect(s.snapshot().blower).toBe(false);
  });

  it('normalises telemetry/spaboy: ph is centi-pH (divide by 100), orp is mV integer', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spaboy', TELEMETRY_SPABOY));
    expect(s.snapshot().chemistry).toEqual({ ph: 7.67, orp: 587 });
  });

  it('normalises telemetry/errors: collects truthy named-boolean keys', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/errors', TELEMETRY_ERRORS_ACTIVE));
    expect(s.snapshot().errors).toEqual(['noFlow', 'heaterOverTemperature']);
  });

  it('telemetry/errors with all-false → empty errors array', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/errors', TELEMETRY_ERRORS));
    expect(s.snapshot().errors).toEqual([]);
  });

  it('encodes telemetry/errors `other: <int>` as "other:<n>"', () => {
    const s = createStateStore('uuid-1');
    s.ingest(ev('arctic/spa/uuid-1/telemetry/errors', { ...TELEMETRY_ERRORS, other: 7 }));
    expect(s.snapshot().errors).toEqual(['other:7']);
  });

  it('ignores unknown topics and non-object payloads', () => {
    const s = createStateStore('uuid-1');
    const before = s.snapshot();
    s.ingest(ev('arctic/spa/uuid-1/something/else', { tempF: 99 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', 'not-an-object'));
    expect(s.snapshot()).toEqual(before);
  });

  it('emits change events with deltas and skips no-op merges', () => {
    const s = createStateStore('uuid-1');
    const seen: SpaState[] = [];
    s.onChange((p: SpaState) => seen.push(p));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { tempF: 100 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { tempF: 100 }));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { tempF: 101 }));
    expect(seen).toHaveLength(2);
    expect(seen[0].temperatureF).toBe(100);
    expect(seen[1].temperatureF).toBe(101);
  });

  it('onChange returns an unsubscribe function', () => {
    const s = createStateStore('uuid-1');
    const seen: SpaState[] = [];
    const off = s.onChange((p: SpaState) => seen.push(p));
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { tempF: 100 }));
    off();
    s.ingest(ev('arctic/spa/uuid-1/telemetry/spa', { tempF: 101 }));
    expect(seen).toHaveLength(1);
  });
});
