import { zonedParts, wallTimeToUtc, lastDayOfMonth } from './clock';
import { REMINDER_HOUR, type IntervalUnit, type TaskInput } from './maintenance-types';

function atNine(year: number, month: number, day: number, tz: string): number {
  const d = Math.min(day, lastDayOfMonth(year, month));
  return wallTimeToUtc(year, month, d, REMINDER_HOUR, 0, 0, tz);
}

// Parse a YYYY-MM-DD string into a dueTs at 09:00 local.
export function resolveDateAtNine(isoDate: string, tz: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return atNine(y, m, d, tz);
}

export function nextIntervalDue(fromTs: number, value: number, unit: IntervalUnit, tz: string): number {
  const p = zonedParts(fromTs, tz);
  if (unit === 'day') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  if (unit === 'week') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value * 7));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  // month
  const totalMonths = p.month - 1 + value;
  const year = p.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return atNine(year, month, p.day, tz); // atNine clamps the day
}

export function nextAnnualDue(fromTs: number, month: number, day: number, tz: string): number {
  const p = zonedParts(fromTs, tz);
  let year = p.year;
  let candidate = atNine(year, month, day, tz);
  if (candidate <= fromTs) {
    year += 1;
    candidate = atNine(year, month, day, tz);
  }
  return candidate;
}

// The due_ts a task should have at creation time.
export function computeInitialDue(input: TaskInput, now: number, tz: string): number | null {
  switch (input.recurrenceKind) {
    case 'once':
      return input.firstDueDate ? resolveDateAtNine(input.firstDueDate, tz) : null;
    case 'interval':
      if (input.firstDueDate) return resolveDateAtNine(input.firstDueDate, tz);
      return nextIntervalDue(now, input.intervalValue ?? 1, input.intervalUnit ?? 'day', tz);
    case 'annual':
      return nextAnnualDue(now, input.annualMonth ?? 1, input.annualDay ?? 1, tz);
  }
}

// The due_ts after completing a recurring task. null means "archive" (once).
export function nextDueAfterComplete(
  task: { recurrenceKind: string; intervalValue: number | null; intervalUnit: IntervalUnit | null; annualMonth: number | null; annualDay: number | null },
  completedTs: number,
  tz: string,
): number | null {
  if (task.recurrenceKind === 'interval') {
    return nextIntervalDue(completedTs, task.intervalValue ?? 1, task.intervalUnit ?? 'day', tz);
  }
  if (task.recurrenceKind === 'annual') {
    return nextAnnualDue(completedTs, task.annualMonth ?? 1, task.annualDay ?? 1, tz);
  }
  return null; // once
}
