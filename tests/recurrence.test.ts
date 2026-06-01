import { describe, it, expect } from 'vitest';
import { nextIntervalDue, nextAnnualDue, computeInitialDue } from '../src/lib/server/recurrence';
import type { TaskInput } from '../src/lib/server/maintenance-types';

const OSLO = 'Europe/Oslo';
const at = (iso: string) => Date.parse(iso);
const localDate = (ts: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: OSLO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
const localHour = (ts: number) =>
  +new Intl.DateTimeFormat('en-US', { timeZone: OSLO, hour12: false, hour: '2-digit' }).format(ts) % 24;

describe('nextIntervalDue', () => {
  it('advances by whole days at 09:00 local', () => {
    const next = nextIntervalDue(at('2025-03-10T14:00:00Z'), 10, 'day', OSLO);
    expect(localDate(next)).toBe('2025-03-20');
    expect(localHour(next)).toBe(9);
  });

  it('advances by weeks', () => {
    const next = nextIntervalDue(at('2025-03-10T14:00:00Z'), 2, 'week', OSLO);
    expect(localDate(next)).toBe('2025-03-24');
  });

  it('advances by months keeping the day-of-month', () => {
    const next = nextIntervalDue(at('2025-01-15T08:00:00Z'), 3, 'month', OSLO);
    expect(localDate(next)).toBe('2025-04-15');
  });

  it('clamps month overflow to the last valid day (Jan 31 + 3mo -> Apr 30)', () => {
    const next = nextIntervalDue(at('2025-01-31T08:00:00Z'), 3, 'month', OSLO);
    expect(localDate(next)).toBe('2025-04-30');
  });
});

describe('nextAnnualDue', () => {
  it('returns this year if the date is still ahead', () => {
    const next = nextAnnualDue(at('2025-03-01T00:00:00Z'), 10, 15, OSLO);
    expect(localDate(next)).toBe('2025-10-15');
    expect(localHour(next)).toBe(9);
  });

  it('rolls to next year if the date has passed', () => {
    const next = nextAnnualDue(at('2025-11-01T00:00:00Z'), 10, 15, OSLO);
    expect(localDate(next)).toBe('2026-10-15');
  });

  it('clamps Feb 29 to Feb 28 in a non-leap year', () => {
    const next = nextAnnualDue(at('2025-01-01T00:00:00Z'), 2, 29, OSLO);
    expect(localDate(next)).toBe('2025-02-28');
  });
});

describe('computeInitialDue', () => {
  const base: TaskInput = { title: 't', recurrenceKind: 'once' };
  const now = at('2025-06-01T10:00:00Z');

  it('is null for an undated todo', () => {
    expect(computeInitialDue({ ...base, recurrenceKind: 'once' }, now, OSLO)).toBeNull();
  });

  it('uses firstDueDate at 09:00 for a dated one-off', () => {
    const due = computeInitialDue({ ...base, recurrenceKind: 'once', firstDueDate: '2025-09-20' }, now, OSLO);
    expect(localDate(due!)).toBe('2025-09-20');
    expect(localHour(due!)).toBe(9);
  });

  it('uses firstDueDate when given for an interval task', () => {
    const due = computeInitialDue(
      { ...base, recurrenceKind: 'interval', intervalValue: 1, intervalUnit: 'month', firstDueDate: '2025-06-10' },
      now,
      OSLO,
    );
    expect(localDate(due!)).toBe('2025-06-10');
  });

  it('defaults an interval task with no firstDueDate to now + interval', () => {
    const due = computeInitialDue(
      { ...base, recurrenceKind: 'interval', intervalValue: 2, intervalUnit: 'week' },
      now,
      OSLO,
    );
    expect(localDate(due!)).toBe('2025-06-15');
  });

  it('computes the next annual occurrence', () => {
    const due = computeInitialDue({ ...base, recurrenceKind: 'annual', annualMonth: 10, annualDay: 15 }, now, OSLO);
    expect(localDate(due!)).toBe('2025-10-15');
  });
});
