import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { computeInitialDue, nextDueAfterComplete } from './recurrence';
import type { MaintenanceTask, SubTask, TaskInput, CompletionSnapshot } from './maintenance-types';

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
  description: string | null;
  category: string | null;
  source: string;
  priority: string | null;
  season: string | null;
  estimated_minutes: number | null;
  cost_estimate: string | null;
  seed_key: string | null;
  weather_trigger: number;
  last_weather_fired_ts: number | null;
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
    description: r.description,
    category: r.category as MaintenanceTask['category'],
    source: (r.source ?? 'manual') as MaintenanceTask['source'],
    priority: r.priority as MaintenanceTask['priority'],
    season: r.season as MaintenanceTask['season'],
    estimatedMinutes: r.estimated_minutes,
    costEstimate: r.cost_estimate,
    seedKey: r.seed_key,
    weatherTrigger: !!r.weather_trigger,
    lastWeatherFiredTs: r.last_weather_fired_ts,
    subTasks: [],
  };
}

const SELECT = `SELECT id, title, notes, recurrence_kind, interval_value, interval_unit,
  annual_month, annual_day, due_ts, last_completed_ts, last_reminded_ts, enabled,
  description, category, source, priority, season, estimated_minutes, cost_estimate, seed_key,
  weather_trigger, last_weather_fired_ts
  FROM maintenance_task`;

interface SubRow {
  id: string;
  parent_id: string;
  title: string;
  done: number;
  sort_order: number;
}

function toSub(r: SubRow): SubTask {
  return { id: r.id, parentId: r.parent_id, title: r.title, done: !!r.done, sortOrder: r.sort_order };
}

const SUB_SELECT = 'SELECT id, parent_id, title, done, sort_order FROM sub_task';

export function getSubTask(db: Database.Database, id: string): SubTask | null {
  const r = db.prepare(`${SUB_SELECT} WHERE id = ?`).get(id) as SubRow | undefined;
  return r ? toSub(r) : null;
}

export function createTask(db: Database.Database, input: TaskInput, now: number): MaintenanceTask {
  const id = randomUUID();
  const due = computeInitialDue(input, now, TZ);
  const { n } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM maintenance_task`)
    .get() as { n: number };
  db.prepare(
    `INSERT INTO maintenance_task
      (id, title, notes, recurrence_kind, interval_value, interval_unit, annual_month, annual_day, due_ts, enabled,
       description, category, source, priority, season, estimated_minutes, cost_estimate, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.description ?? null,
    input.category ?? null,
    input.source ?? 'manual',
    input.priority ?? null,
    input.season ?? null,
    input.estimatedMinutes ?? null,
    input.costEstimate ?? null,
    n,
  );
  return getTask(db, id)!;
}

export function getTask(db: Database.Database, id: string): MaintenanceTask | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? toTask(r) : null;
}

// Active list: enabled tasks only (completed once-tasks are disabled = archived).
// Each task carries its checklist of sub-tasks (empty for plain tasks).
export function listTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY sort_order ASC, rowid ASC`).all() as Row[];
  const tasks = rows.map(toTask);
  const subs = db.prepare(`${SUB_SELECT} ORDER BY sort_order ASC, rowid ASC`).all() as SubRow[];
  const byParent = new Map<string, SubTask[]>();
  for (const s of subs) {
    const arr = byParent.get(s.parent_id) ?? [];
    arr.push(toSub(s));
    byParent.set(s.parent_id, arr);
  }
  for (const t of tasks) t.subTasks = byParent.get(t.id) ?? [];
  return tasks;
}

export function updateTask(db: Database.Database, id: string, input: TaskInput, now: number): MaintenanceTask | null {
  if (!getTask(db, id)) return null;
  const due = computeInitialDue(input, now, TZ);
  db.prepare(
    `UPDATE maintenance_task SET title = ?, notes = ?, recurrence_kind = ?, interval_value = ?,
      interval_unit = ?, annual_month = ?, annual_day = ?, due_ts = ?,
      description = ?, category = ?, source = ?, priority = ?, season = ?,
      estimated_minutes = ?, cost_estimate = ? WHERE id = ?`,
  ).run(
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
    input.description ?? null,
    input.category ?? null,
    input.source ?? 'manual',
    input.priority ?? null,
    input.season ?? null,
    input.estimatedMinutes ?? null,
    input.costEstimate ?? null,
    id,
  );
  return getTask(db, id);
}

export function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM sub_task WHERE parent_id = ?').run(id);
  db.prepare('DELETE FROM maintenance_task WHERE id = ?').run(id);
}

// Rewrite the manual order of tasks. `ids` is the complete top-to-bottom list;
// each task's sort_order becomes its index. Unknown ids are ignored.
export function reorderTasks(db: Database.Database, ids: string[]): void {
  const upd = db.prepare('UPDATE maintenance_task SET sort_order = ? WHERE id = ?');
  const tx = db.transaction((list: string[]) => {
    list.forEach((id, i) => upd.run(i, id));
  });
  tx(ids);
}

export function addSubTask(db: Database.Database, parentId: string, title: string): SubTask | null {
  if (!getTask(db, parentId)) return null;
  const id = randomUUID();
  const { n } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sub_task WHERE parent_id = ?')
    .get(parentId) as { n: number };
  db.prepare('INSERT INTO sub_task (id, parent_id, title, done, sort_order) VALUES (?, ?, ?, 0, ?)').run(
    id,
    parentId,
    title,
    n,
  );
  return getSubTask(db, id);
}

export function deleteSubTask(db: Database.Database, subId: string): void {
  db.prepare('DELETE FROM sub_task WHERE id = ?').run(subId);
}

// Flip a sub-task's done state. When every sibling becomes done, the parent
// happening auto-completes (reschedule or archive); a still-active recurring
// parent gets its checklist reset for the next occurrence.
export function toggleSubTask(db: Database.Database, subId: string, now: number): { completed: boolean } {
  const sub = getSubTask(db, subId);
  if (!sub) return { completed: false };
  db.prepare('UPDATE sub_task SET done = ? WHERE id = ?').run(sub.done ? 0 : 1, subId);

  const { total, doneCount } = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS doneCount FROM sub_task WHERE parent_id = ?')
    .get(sub.parentId) as { total: number; doneCount: number };

  if (total > 0 && doneCount === total) {
    completeTask(db, sub.parentId, now);
    const parent = getTask(db, sub.parentId);
    if (parent && parent.enabled) {
      db.prepare('UPDATE sub_task SET done = 0 WHERE parent_id = ?').run(sub.parentId);
    }
    return { completed: true };
  }
  return { completed: false };
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

// Undo a completion: write the pre-completion snapshot back onto the task and
// restore each captured sub-item's done state (a recurring happening had them
// reset to 0 on completion).
export function restoreTask(
  db: Database.Database,
  id: string,
  snap: CompletionSnapshot,
): MaintenanceTask | null {
  if (!getTask(db, id)) return null;
  const updTask = db.prepare(
    'UPDATE maintenance_task SET due_ts = ?, last_completed_ts = ?, last_reminded_ts = ?, enabled = ? WHERE id = ?',
  );
  const updSub = db.prepare('UPDATE sub_task SET done = ? WHERE id = ?');
  const tx = db.transaction(() => {
    updTask.run(snap.dueTs, snap.lastCompletedTs, snap.lastRemindedTs, snap.enabled ? 1 : 0, id);
    for (const s of snap.subTasks) updSub.run(s.done ? 1 : 0, s.id);
  });
  tx();
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

// Enabled tasks opted into weather triggering. Ordered for stable iteration.
export function selectWeatherTriggerTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db
    .prepare(`${SELECT} WHERE enabled = 1 AND weather_trigger = 1 ORDER BY sort_order ASC, rowid ASC`)
    .all() as Row[];
  return rows.map(toTask);
}

// Pull a weather-triggered task forward to "due now". last_reminded_ts is set to
// now (= due_ts) so the hourly maintenance-reminder loop does NOT also send a
// generic "Task due" push — the weather loop sends its own cold-snap push.
export function markWeatherTriggered(db: Database.Database, id: string, now: number): void {
  db.prepare(
    'UPDATE maintenance_task SET due_ts = ?, last_weather_fired_ts = ?, last_reminded_ts = ? WHERE id = ?',
  ).run(now, now, now, id);
}
