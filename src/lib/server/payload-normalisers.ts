import type { RawMqttEvent, SpaState } from './types';

export function normalise(event: RawMqttEvent): Partial<SpaState> | null {
  const t = event.topic;
  if (!t.includes('/telemetry/') && !t.includes('/settings/') && !t.includes('/information/')) return null;
  const p = event.payload as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null) return null;

  if (t.endsWith('/telemetry/spa')) {
    const out: Partial<SpaState> = {};
    if (typeof p.currentTempF === 'number') out.temperatureF = p.currentTempF;
    if (typeof p.setpointF === 'number') out.targetTemperatureF = p.setpointF;
    if (typeof p.heating === 'boolean') out.heating = p.heating;
    const pumps: { id: number; speed: 0 | 1 | 2 }[] = [];
    for (let i = 1; i <= 5; i++) {
      const v = p[`pump${i}`];
      if (typeof v === 'number' && v >= 0 && v <= 2) pumps.push({ id: i, speed: v as 0 | 1 | 2 });
    }
    if (pumps.length) out.pumps = pumps;
    if (typeof p.blower === 'boolean') out.blower = p.blower;
    if (typeof p.lights === 'boolean') out.lights = p.lights;
    return Object.keys(out).length ? out : null;
  }

  if (t.endsWith('/telemetry/spaboy')) {
    const c: { ph?: number; chlorine?: number; orp?: number } = {};
    if (typeof p.ph === 'number') c.ph = p.ph;
    if (typeof p.chlorine === 'number') c.chlorine = p.chlorine;
    if (typeof p.orp === 'number') c.orp = p.orp;
    return Object.keys(c).length ? { chemistry: c } : null;
  }

  if (t.endsWith('/telemetry/errors')) {
    if (Array.isArray(p.errors)) return { errors: p.errors.filter((x: unknown): x is string => typeof x === 'string') };
    return null;
  }

  return null;
}
