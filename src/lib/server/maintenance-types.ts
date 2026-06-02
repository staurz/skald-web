export type RecurrenceKind = 'once' | 'interval' | 'annual';
export type IntervalUnit = 'day' | 'week' | 'month';

// Provenance of a task — lets the user distinguish documented findings from
// reasoned inferences and generic best practice. See seed-maintenance.mjs.
export type TaskSource = 'from-report' | 'inferred' | 'general' | 'gardening' | 'manual';
export type TaskPriority = 'high' | 'medium' | 'low';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'year-round';
export type TaskCategory =
  | 'roof'
  | 'exterior'
  | 'windows-doors'
  | 'wetroom'
  | 'plumbing'
  | 'electrical'
  | 'heating'
  | 'ventilation'
  | 'drainage'
  | 'foundation'
  | 'fire-safety'
  | 'pest'
  | 'garden'
  | 'lawn'
  | 'general'
  | 'documentation';

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
  // Descriptive metadata.
  description: string | null; // what to do + why (stable explainer, distinct from notes)
  category: TaskCategory | null;
  source: TaskSource;
  priority: TaskPriority | null;
  season: Season | null; // informational grouping; scheduling still uses recurrence
  estimatedMinutes: number | null;
  costEstimate: string | null; // e.g. takst band '10 000–50 000'
  seedKey: string | null; // stable id for idempotent seeding; null for manual tasks
  subTasks: SubTask[];
}

export interface SubTask {
  id: string;
  parentId: string;
  title: string;
  done: boolean;
  sortOrder: number;
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
  // Descriptive metadata (all optional; default to null / 'manual').
  description?: string | null;
  category?: TaskCategory | null;
  source?: TaskSource;
  priority?: TaskPriority | null;
  season?: Season | null;
  estimatedMinutes?: number | null;
  costEstimate?: string | null;
}

// The pre-completion state the client holds so an Undo can restore it.
export interface CompletionSnapshot {
  dueTs: number | null;
  lastCompletedTs: number | null;
  lastRemindedTs: number | null;
  enabled: boolean;
  subTasks: { id: string; done: boolean }[];
}

export const REMINDER_HOUR = 9;
