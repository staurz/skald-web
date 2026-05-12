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

  it('fires temperature_outside below minC (Celsius threshold)', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minC: 38, maxC: 41 }, enabled: true }];
    // 99 °F = 37.2 °C, below 38 °C
    const fires = evaluateRules(rules, baseState({ temperatureF: 99 }));
    expect(fires).toHaveLength(1);
    expect(fires[0].ruleId).toBe('r2');
    expect(fires[0].payload).toMatchObject({ minC: 38, maxC: 41 });
  });

  it('fires temperature_outside above maxC', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minC: 38, maxC: 41 }, enabled: true }];
    // 110 °F = 43.3 °C, above 41 °C
    expect(evaluateRules(rules, baseState({ temperatureF: 110 }))).toHaveLength(1);
  });

  it('does not fire temperature_outside when Celsius is in range', () => {
    const rules: AlertRule[] = [{ id: 'r2', kind: 'temperature_outside', threshold: { minC: 38, maxC: 41 }, enabled: true }];
    // 104 °F = 40 °C, in [38, 41]
    expect(evaluateRules(rules, baseState({ temperatureF: 104 }))).toEqual([]);
  });

  it('still supports legacy minF/maxF thresholds (back-compat)', () => {
    const rules: AlertRule[] = [{ id: 'rL', kind: 'temperature_outside', threshold: { minF: 100, maxF: 105 }, enabled: true }];
    const fires = evaluateRules(rules, baseState({ temperatureF: 99 }));
    expect(fires).toHaveLength(1);
    expect(fires[0].payload).toMatchObject({ temperatureF: 99, minF: 100, maxF: 105 });
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
