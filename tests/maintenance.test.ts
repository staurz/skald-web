import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
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
  // Regression: openDb must migrate a database created BEFORE the descriptive
  // columns existed. The old-shape table makes CREATE TABLE IF NOT EXISTS a
  // no-op, so the seed_key column (and its unique index) must be added by
  // migrate() — never indexed inside SCHEMA, or openDb throws
  // "no such column: seed_key" on every existing install.
  it('migrates a pre-existing old-shape database without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maint-old-'));
    const path = join(dir, 'old.db');
    const raw = new Database(path);
    raw.exec(`CREATE TABLE maintenance_task (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, recurrence_kind TEXT NOT NULL,
      interval_value INTEGER, interval_unit TEXT, annual_month INTEGER, annual_day INTEGER,
      due_ts INTEGER, last_completed_ts INTEGER, last_reminded_ts INTEGER, enabled INTEGER NOT NULL DEFAULT 1
    )`);
    raw.prepare(`INSERT INTO maintenance_task (id, title, recurrence_kind, enabled) VALUES (?, ?, ?, 1)`).run(
      'legacy-1',
      'Gammel oppgave',
      'once',
    );
    raw.close();

    // Must not throw, and must end up with the new columns + the unique index.
    const db = openDb(path);
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('seed_key');
    expect(cols).toContain('source');
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_seed_key'`)
      .get();
    expect(idx).toBeTruthy();
    // The legacy row survives and listing works.
    expect(listTasks(db)).toHaveLength(1);
  });

  it('creates the table with the expected columns', () => {
    const db = tempDb();
    const cols = db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'annual_day',
        'annual_month',
        'category',
        'cost_estimate',
        'description',
        'due_ts',
        'enabled',
        'estimated_minutes',
        'id',
        'interval_unit',
        'interval_value',
        'last_completed_ts',
        'last_reminded_ts',
        'notes',
        'priority',
        'recurrence_kind',
        'season',
        'seed_key',
        'sort_order',
        'source',
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
