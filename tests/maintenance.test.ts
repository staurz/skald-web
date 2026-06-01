import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import {
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  completeTask,
  selectDueTasks,
  TZ,
} from '../src/lib/server/maintenance';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'maint-'));
  return openDb(join(dir, 'test.db'));
}

describe('maintenance_task schema', () => {
  it('creates the table with the expected columns', () => {
    const db = tempDb();
    const cols = db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'annual_day',
        'annual_month',
        'due_ts',
        'enabled',
        'id',
        'interval_unit',
        'interval_value',
        'last_completed_ts',
        'last_reminded_ts',
        'notes',
        'recurrence_kind',
        'title',
      ].sort(),
    );
  });
});

describe('task store', () => {
  it('creates and lists a dated one-off', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'Fix gate', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    expect(t.title).toBe('Fix gate');
    expect(t.dueTs).not.toBeNull();
    const all = listTasks(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
  });

  it('creates an undated todo with null due', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'Buy bulbs', recurrenceKind: 'once' }, Date.now());
    expect(t.dueTs).toBeNull();
  });

  it('updates a task title', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'old', recurrenceKind: 'once' }, Date.now());
    updateTask(db, t.id, { title: 'new', recurrenceKind: 'once' }, Date.now());
    expect(listTasks(db)[0].title).toBe('new');
  });

  it('deletes a task', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'x', recurrenceKind: 'once' }, Date.now());
    deleteTask(db, t.id);
    expect(listTasks(db)).toHaveLength(0);
  });

  it('archives a once task on completion (drops from active list)', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'one off', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    completeTask(db, t.id, Date.parse('2025-09-01T12:00:00Z'));
    expect(listTasks(db)).toHaveLength(0); // active list excludes archived
  });

  it('reschedules an interval task on completion', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'filter', recurrenceKind: 'interval', intervalValue: 3, intervalUnit: 'month', firstDueDate: '2025-06-01' },
      Date.parse('2025-05-01T10:00:00Z'),
    );
    completeTask(db, t.id, Date.parse('2025-06-02T10:00:00Z'));
    const after = listTasks(db)[0];
    expect(after.dueTs).toBeGreaterThan(Date.parse('2025-09-01T00:00:00Z')); // ~3 months out
    expect(after.lastCompletedTs).toBe(Date.parse('2025-06-02T10:00:00Z'));
  });
});

describe('selectDueTasks', () => {
  it('returns enabled, dated tasks at/after due that have not been reminded this cycle', () => {
    const db = tempDb();
    const due = createTask(db, { title: 'due', recurrenceKind: 'once', firstDueDate: '2025-06-01' }, Date.parse('2025-05-01T10:00:00Z'));
    createTask(db, { title: 'todo', recurrenceKind: 'once' }, Date.now()); // undated, excluded
    createTask(db, { title: 'future', recurrenceKind: 'once', firstDueDate: '2030-01-01' }, Date.now()); // not due
    const now = Date.parse('2025-06-01T09:30:00Z');
    const picked = selectDueTasks(db, now);
    expect(picked.map((t) => t.id)).toEqual([due.id]);
  });

  it('excludes a task already reminded for its current due cycle', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'due', recurrenceKind: 'once', firstDueDate: '2025-06-01' }, Date.parse('2025-05-01T10:00:00Z'));
    const now = Date.parse('2025-06-01T09:30:00Z');
    db.prepare('UPDATE maintenance_task SET last_reminded_ts = ? WHERE id = ?').run(now, t.id);
    expect(selectDueTasks(db, now)).toHaveLength(0);
  });
});
