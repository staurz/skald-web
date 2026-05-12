import type { AlertRule, SpaState } from './types';

export type AlertFire = { ruleId: string; payload: Record<string, unknown> };

export function evaluateRules(rules: AlertRule[], state: SpaState): AlertFire[] {
  const fires: AlertFire[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const f = evaluateOne(r, state);
    if (f) fires.push(f);
  }
  return fires;
}

function evaluateOne(r: AlertRule, state: SpaState): AlertFire | null {
  switch (r.kind) {
    case 'error_present': {
      if (state.errors && state.errors.length > 0) {
        return { ruleId: r.id, payload: { errors: state.errors } };
      }
      return null;
    }
    case 'temperature_outside': {
      const t = state.temperatureF;
      if (t == null) return null;
      const min = Number(r.threshold.minF);
      const max = Number(r.threshold.maxF);
      if (t < min || t > max) return { ruleId: r.id, payload: { temperatureF: t, min, max } };
      return null;
    }
    case 'filter_cycle_missed': {
      const next = state.filterCycle?.nextStartTs;
      if (!next) return null;
      const overdueMs = Number(r.threshold.overdueMs ?? 30 * 60 * 1000);
      if (Date.now() - next > overdueMs) return { ruleId: r.id, payload: { nextStartTs: next, overdueMs } };
      return null;
    }
    case 'chemistry_outside': {
      const c = state.chemistry;
      if (!c) return null;
      const out: Record<string, number> = {};
      const checks: [keyof typeof c, string, string][] = [
        ['ph', 'phMin', 'phMax'],
        ['orp', 'orpMin', 'orpMax'],
      ];
      for (const [field, lo, hi] of checks) {
        const v = c[field];
        if (typeof v !== 'number') continue;
        const min = r.threshold[lo] != null ? Number(r.threshold[lo]) : -Infinity;
        const max = r.threshold[hi] != null ? Number(r.threshold[hi]) : Infinity;
        if (v < min || v > max) out[field] = v;
      }
      return Object.keys(out).length ? { ruleId: r.id, payload: out } : null;
    }
  }
}
