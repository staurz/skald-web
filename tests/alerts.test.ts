import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../src/lib/server/alerts';
import type { AlertRule, SpaState } from '../src/lib/server/types';

const t0 = 1_700_000_000_000;
const baseState = (over: Partial<SpaState> = {}): SpaState => ({ ts: t0, ...over });

describe('evaluateRules', () => {
  it('fires error_present when errors is non-empty', () => {
    const rules: AlertRule[] = [{ id: 'r1', kind: 'error_present', threshold: {}, enabled: true }];
    const fires = evaluateRules(rules, baseState({ errors: ['noFlow'] }));
    expect(fires).toEqual([{ ruleId: 'r1', payload: { errors: ['noFlow'] } }]);
  });

  it('does not fire error_present when errors is empty array', () => {
    const rules: AlertRule[] = [{ id: 'r1', kind: 'error_present', threshold: {}, enabled: true }];
    expect(evaluateRules(rules, baseState({ errors: [] }))).toEqual([]);
  });

  it('fires temperature_outside below minF', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true }];
    const fires = evaluateRules(rules, baseState({ temperatureF: 99 }));
    expect(fires).toHaveLength(1);
    expect(fires[0].ruleId).toBe('r2');
    expect(fires[0].payload).toMatchObject({ temperatureF: 99, min: 100, max: 105 });
  });

  it('fires temperature_outside above maxF', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true }];
    expect(evaluateRules(rules, baseState({ temperatureF: 110 }))).toHaveLength(1);
  });

  it('does not fire temperature_outside in range', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true }];
    expect(evaluateRules(rules, baseState({ temperatureF: 102 }))).toEqual([]);
  });

  it('skips disabled rules entirely', () => {
    const rules: AlertRule[] = [{ id: 'r3', kind: 'error_present', threshold: {}, enabled: false }];
    expect(evaluateRules(rules, baseState({ errors: ['noFlow'] }))).toEqual([]);
  });

  it('fires chemistry_outside when ph drifts above max', () => {
    const rules: AlertRule[] = [{ id: 'r4', kind: 'chemistry_outside', threshold: { phMin: 7.2, phMax: 7.8 }, enabled: true }];
    const fires = evaluateRules(rules, baseState({ chemistry: { ph: 8.3 } }));
    expect(fires).toHaveLength(1);
    expect(fires[0].payload).toEqual({ ph: 8.3 });
  });

  it('fires chemistry_outside on ORP below min', () => {
    const rules: AlertRule[] = [{ id: 'r5', kind: 'chemistry_outside', threshold: { orpMin: 600, orpMax: 800 }, enabled: true }];
    const fires = evaluateRules(rules, baseState({ chemistry: { orp: 500 } }));
    expect(fires).toHaveLength(1);
    expect(fires[0].payload).toEqual({ orp: 500 });
  });

  it('only reports out-of-range chemistry fields, not in-range ones', () => {
    const rules: AlertRule[] = [{
      id: 'r6',
      kind: 'chemistry_outside',
      threshold: { phMin: 7.2, phMax: 7.8, orpMin: 600, orpMax: 800 },
      enabled: true,
    }];
    const fires = evaluateRules(rules, baseState({ chemistry: { ph: 7.5, orp: 500 } }));
    expect(fires[0].payload).toEqual({ orp: 500 });
  });

  it('fires filter_cycle_missed when nextStartTs is overdue', () => {
    const past = Date.now() - 60 * 60 * 1000; // 1h ago
    const rules: AlertRule[] = [{ id: 'r7', kind: 'filter_cycle_missed', threshold: { overdueMs: 30 * 60 * 1000 }, enabled: true }];
    const fires = evaluateRules(rules, baseState({ filterCycle: { active: false, nextStartTs: past } }));
    expect(fires).toHaveLength(1);
  });

  it('returns multiple fires when multiple rules match', () => {
    const rules: AlertRule[] = [
      { id: 'a', kind: 'error_present', threshold: {}, enabled: true },
      { id: 'b', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true },
    ];
    const fires = evaluateRules(rules, baseState({ errors: ['noFlow'], temperatureF: 99 }));
    expect(fires.map((f) => f.ruleId)).toEqual(['a', 'b']);
  });
});
