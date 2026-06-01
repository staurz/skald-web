import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { computeInitialDue, nextDueAfterComplete } from './recurrence';
import type { MaintenanceTask, TaskInput } from './maintenance-types';

export const TZ = process.env.TIMEZONE ?? 'Europe/Oslo';

interface Row {
  id: string;
  title: string;
  notes: string | null;
  recurrence_kind: string;
  interval_value: number | null;
  interval_unit: string | null;
  annual_month: number | null;
  annual_day: number | null;
  due_ts: number | null;
  last_completed_ts: number | null;
  last_reminded_ts: number | null;
  enabled: number;
}

function toTask(r: Row): MaintenanceTask {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    recurrenceKind: r.recurrence_kind as MaintenanceTask['recurrenceKind'],
    intervalValue: r.interval_value,
    intervalUnit: r.interval_unit as MaintenanceTask['intervalUnit'],
    annualMonth: r.annual_month,
    annualDay: r.annual_day,
    dueTs: r.due_ts,
    lastCompletedTs: r.last_completed_ts,
    lastRemindedTs: r.last_reminded_ts,
    enabled: !!r.enabled,
  };
}

const SELECT = `SELECT id, title, notes, recurrence_kind, interval_value, interval_unit,
  annual_month, annual_day, due_ts, last_completed_ts, last_reminded_ts, enabled
  FROM maintenance_task`;

export function createTask(db: Database.Database, input: TaskInput, now: number): MaintenanceTask {
  const id = randomUUID();
  const due = computeInitialDue(input, now, TZ);
  db.prepare(
    `INSERT INTO maintenance_task
      (id, title, notes, recurrence_kind, interval_value, interval_unit, annual_month, annual_day, due_ts, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
  );
  return getTask(db, id)!;
}

export function getTask(db: Database.Database, id: string): MaintenanceTask | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? toTask(r) : null;
}

// Active list: enabled tasks only (completed once-tasks are disabled = archived).
export function listTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY due_ts IS NULL, due_ts ASC`).all() as Row[];
  return rows.map(toTask);
}

export function updateTask(db: Database.Database, id: string, input: TaskInput, now: number): MaintenanceTask | null {
  if (!getTask(db, id)) return null;
  const due = computeInitialDue(input, now, TZ);
  db.prepare(
    `UPDATE maintenance_task SET title = ?, notes = ?, recurrence_kind = ?, interval_value = ?,
      interval_unit = ?, annual_month = ?, annual_day = ?, due_ts = ? WHERE id = ?`,
  ).run(
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
    id,
  );
  return getTask(db, id);
}

export function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM maintenance_task WHERE id = ?').run(id);
}

export function completeTask(db: Database.Database, id: string, now: number): MaintenanceTask | null {
  const task = getTask(db, id);
  if (!task) return null;
  const next = nextDueAfterComplete(task, now, TZ);
  if (next === null) {
    // once: archive
    db.prepare('UPDATE maintenance_task SET last_completed_ts = ?, enabled = 0 WHERE id = ?').run(now, id);
  } else {
    db.prepare(
      'UPDATE maintenance_task SET last_completed_ts = ?, due_ts = ?, last_reminded_ts = NULL WHERE id = ?',
    ).run(now, next, id);
  }
  return getTask(db, id);
}

// Tasks that should fire a reminder right now.
export function selectDueTasks(db: Database.Database, now: number): MaintenanceTask[] {
  const rows = db
    .prepare(
      `${SELECT} WHERE enabled = 1 AND due_ts IS NOT NULL AND due_ts <= ?
        AND (last_reminded_ts IS NULL OR last_reminded_ts < due_ts)`,
    )
    .all(now) as Row[];
  return rows.map(toTask);
}

export function markReminded(db: Database.Database, id: string, now: number): void {
  db.prepare('UPDATE maintenance_task SET last_reminded_ts = ? WHERE id = ?').run(now, id);
}
