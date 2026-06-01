export type RecurrenceKind = 'once' | 'interval' | 'annual';
export type IntervalUnit = 'day' | 'week' | 'month';

export interface MaintenanceTask {
  id: string;
  title: string;
  notes: string | null;
  recurrenceKind: RecurrenceKind;
  intervalValue: number | null;
  intervalUnit: IntervalUnit | null;
  annualMonth: number | null; // 1-12
  annualDay: number | null; // 1-31
  dueTs: number | null; // epoch ms; null = undated todo
  lastCompletedTs: number | null;
  lastRemindedTs: number | null;
  enabled: boolean;
}

// Fields accepted when creating/editing a task. dueTs is derived server-side.
export interface TaskInput {
  title: string;
  notes?: string | null;
  recurrenceKind: RecurrenceKind;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  annualMonth?: number | null;
  annualDay?: number | null;
  // For 'once' (dated) and 'interval' start: an explicit first date, YYYY-MM-DD.
  // Omit for an undated todo.
  firstDueDate?: string | null;
}

export const REMINDER_HOUR = 9;
