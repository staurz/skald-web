import type { RawMqttEvent, SpaState } from './types';

// Field names match the real telemetry payloads captured from a legacy-tcp spa
// (see tests/fixtures/spa-payloads.ts). Notable encodings:
//   - tempF / tempSetPointF: integer °F
//   - heater1, heater2, blower1, blower2: integers (0 = off, >0 = on/level)
//   - spaboy.ph: centi-pH (divide by 100 for actual pH)
//   - spaboy.orp: raw mV integer
//   - telemetry/errors: object of named booleans; truthy entries are active error codes

const ERROR_CODE_KEYS = [
  'noFlow', 'flowSwitch', 'heaterOverTemperature', 'spaOverTemperature',
  'spaTemperatureProbe', 'spaHighLimit', 'eeprom', 'freezeProtect',
  'phHigh', 'hd', 'hpt', 'spaboyComm',
] as const;

export function normalise(event: RawMqttEvent): Partial<SpaState> | null {
  const t = event.topic;
  if (!t.includes('/telemetry/') && !t.includes('/settings/') && !t.includes('/information/')) return null;
  const p = event.payload as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null) return null;

  if (t.endsWith('/telemetry/spa')) {
    const out: Partial<SpaState> = {};
    if (typeof p.tempF === 'number') out.temperatureF = p.tempF;
    if (typeof p.tempSetPointF === 'number') out.targetTemperatureF = p.tempSetPointF;

    const heater1 = typeof p.heater1 === 'number' ? p.heater1 : 0;
    const heater2 = typeof p.heater2 === 'number' ? p.heater2 : 0;
    if (typeof p.heater1 === 'number' || typeof p.heater2 === 'number') {
      out.heating = heater1 > 0 || heater2 > 0;
    }

    const pumps: { id: number; speed: 0 | 1 | 2 }[] = [];
    for (let i = 1; i <= 5; i++) {
      const v = p[`pump${i}`];
      if (typeof v === 'number' && v >= 0 && v <= 2) pumps.push({ id: i, speed: v as 0 | 1 | 2 });
    }
    if (pumps.length) out.pumps = pumps;

    const blower1 = typeof p.blower1 === 'number' ? p.blower1 : 0;
    const blower2 = typeof p.blower2 === 'number' ? p.blower2 : 0;
    if (typeof p.blower1 === 'number' || typeof p.blower2 === 'number') {
      out.blower = blower1 > 0 || blower2 > 0;
    }

    if (typeof p.lights === 'boolean') out.lights = p.lights;

    return Object.keys(out).length ? out : null;
  }

  if (t.endsWith('/telemetry/spaboy')) {
    const c: { ph?: number; orp?: number } = {};
    if (typeof p.ph === 'number') c.ph = p.ph / 100;
    if (typeof p.orp === 'number') c.orp = p.orp;
    return Object.keys(c).length ? { chemistry: c } : null;
  }

  if (t.endsWith('/telemetry/errors')) {
    const active: string[] = [];
    for (const k of ERROR_CODE_KEYS) {
      if (p[k] === true) active.push(k);
    }
    if (typeof p.other === 'number' && p.other > 0) active.push(`other:${p.other}`);
    return { errors: active };
  }

  return null;
}
